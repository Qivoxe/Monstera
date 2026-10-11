import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import current_auth
from app.core.config import get_settings
from app.core.security import digest_secret, hash_password, issue_secret, verify_password
from app.db.session import get_db
from app.models import ActivitySegmentRecord, ExposureEstimate, Intervention, PollutionReading, SavedLocation, SavedRoutine, SimulationRun, User, UserLog, UserPreference, UserSession
from app.schemas import ActionLogRequest, AirQualityResponse, AuthResponse, Credentials, ExposureRequest, ExposureResponse, InterventionUpdate, LocationResponse, LocationSearchResponse, PlannerSummary, PreferenceResponse, PreferenceUpdate, RouteCompareRequest, RouteCompareResponse, RoutineCreate, RoutineResponse, SavedLocationCreate, SavedLocationResponse, SavedLocationUpdate, SimulationRequest, SimulationResponse
from app.services.air_quality import OpenMeteoGeocoder, OpenMeteoProvider
from app.services.exposure import estimate_exposure
from app.services.routing import OSRMRouter
from app.services.route_exposure import compare_exposure

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1")


def _start_session(db: Session, user: User, response: Response) -> AuthResponse:
    raw_token, csrf_token = issue_secret(), issue_secret()
    session_days = get_settings().session_days
    expires_at = datetime.now(timezone.utc) + timedelta(days=session_days)
    db.add(UserSession(user_id=user.id, token_hash=digest_secret(raw_token), csrf_token=csrf_token, expires_at=expires_at))
    db.commit()
    response.set_cookie(
        "monstera_session", raw_token, max_age=session_days * 86400,
        httponly=True, secure=get_settings().cookie_secure, samesite="lax", path="/api/v1",
    )
    return AuthResponse(id=str(user.id), display_name=user.display_name, email=user.email, csrf_token=csrf_token)


def _utc(value: datetime) -> datetime:
    return value.astimezone(timezone.utc)


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/ready")
def ready(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        logger.warning("Readiness check failed", exc_info=exc)
        raise HTTPException(status_code=503, detail="Database is unavailable") from exc
    return {"status": "ready", "database": "ok"}


@router.post("/auth/register", response_model=AuthResponse, status_code=201)
def register(payload: Credentials, response: Response, db: Session = Depends(get_db)):
    user = User(display_name=payload.display_name, email=payload.email, password_hash=hash_password(payload.password))
    db.add(user)
    try:
        db.flush()
        db.add(UserPreference(user_id=user.id))
        result = _start_session(db, user, response)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this email already exists") from exc
    return result


@router.post("/auth/login", response_model=AuthResponse)
def login(payload: Credentials, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    return _start_session(db, user, response)


@router.get("/auth/me", response_model=AuthResponse)
def me(auth=Depends(current_auth)):
    user, session = auth
    return AuthResponse(id=str(user.id), display_name=user.display_name, email=user.email, csrf_token=session.csrf_token)


@router.post("/auth/logout", status_code=204)
def logout(response: Response, auth=Depends(current_auth), db: Session = Depends(get_db)):
    _user, session = auth
    db.delete(session)
    db.commit()
    response.delete_cookie("monstera_session", path="/api/v1", secure=get_settings().cookie_secure, httponly=True, samesite="lax")
    response.status_code = 204
    return response


@router.delete("/auth/account", status_code=204)
def delete_account(response: Response, auth=Depends(current_auth), db: Session = Depends(get_db)):
    user, _session = auth
    db.delete(user)
    db.commit()
    response.delete_cookie("monstera_session", path="/api/v1", secure=get_settings().cookie_secure, httponly=True, samesite="lax")
    response.status_code = 204
    return response


@router.get("/preferences", response_model=PreferenceResponse)
def get_preferences(auth=Depends(current_auth), db: Session = Depends(get_db)):
    user, _session = auth
    preference = db.get(UserPreference, user.id)
    if preference is None:
        preference = UserPreference(user_id=user.id)
        db.add(preference)
        db.commit()
    return preference


@router.put("/preferences", response_model=PreferenceResponse)
def update_preferences(payload: PreferenceUpdate, auth=Depends(current_auth), db: Session = Depends(get_db)):
    user, _session = auth
    preference = db.get(UserPreference, user.id)
    if preference is None:
        preference = UserPreference(user_id=user.id)
        db.add(preference)
    preference.sensitivity = payload.sensitivity
    preference.commute_reminder = payload.commute_reminder
    preference.indoor_air_alert = payload.indoor_air_alert
    preference.home_location = payload.home_location
    preference.home_latitude = payload.home_latitude
    preference.home_longitude = payload.home_longitude
    db.commit()
    db.refresh(preference)
    return preference


@router.get("/air-quality/forecast", response_model=AirQualityResponse)
async def air_quality_forecast(
    latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180),
    hours: int = Query(default=24, ge=1, le=48), db: Session = Depends(get_db),
):
    provider = OpenMeteoProvider(get_settings().open_meteo_base_url)
    data = await provider.get_pm25(latitude, longitude, hours)
    now = datetime.fromisoformat(data.get("retrieved_at", datetime.now(timezone.utc).isoformat()))
    for item in data["items"]:
        reading = PollutionReading(
            pollutant="pm2_5", value=item["value"], unit="µg/m³", data_kind="forecast",
            latitude=data["grid_location"]["latitude"], longitude=data["grid_location"]["longitude"],
            valid_at=item["valid_at"], provider="Open-Meteo / CAMS",
            metadata_json={"retrieved_at": now.isoformat(), "requested_latitude": latitude, "requested_longitude": longitude},
        )
        existing = db.scalar(select(PollutionReading).where(
            PollutionReading.provider == reading.provider, PollutionReading.latitude == reading.latitude,
            PollutionReading.longitude == reading.longitude, PollutionReading.pollutant == reading.pollutant,
            PollutionReading.valid_at == reading.valid_at,
        ))
        if existing:
            existing.value, existing.metadata_json = reading.value, reading.metadata_json
        else:
            db.add(reading)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Could not persist provider forecast")
        raise HTTPException(status_code=503, detail="Forecast retrieved but could not be saved") from exc
    return {
        "requested_location": {"latitude": latitude, "longitude": longitude},
        "items": [{**item, "grid_location": data["grid_location"]} for item in data["items"]],
        "attribution": "Air-quality forecast: Open-Meteo using the Copernicus Atmosphere Monitoring Service (CAMS). Forecast grid resolution is regional and does not represent a local sensor measurement.",
        "source": "Open-Meteo / CAMS", "kind": "forecast", "retrieved_at": now.isoformat(),
        "freshness": "provider data retrieved or served from the application cache; forecast valid_at timestamps identify the model forecast hour",
    }


@router.get("/locations/search", response_model=LocationSearchResponse)
async def search_location(
    name: str = Query(min_length=2, max_length=120),
    country_code: str | None = Query(default=None, min_length=2, max_length=2, pattern="^[A-Za-z]{2}$"),
):
    return await OpenMeteoGeocoder().search(name, country_code)


def _saved_location(row: SavedLocation):
    return {"id": str(row.id), "name": row.name, "latitude": row.latitude, "longitude": row.longitude,
            "place_label": row.place_label, "created_at": row.created_at, "updated_at": row.updated_at}


@router.get("/locations/saved", response_model=list[SavedLocationResponse])
def list_saved_locations(auth=Depends(current_auth), db: Session = Depends(get_db)):
    user, _session = auth
    rows = db.scalars(select(SavedLocation).where(SavedLocation.user_id == user.id).order_by(SavedLocation.created_at))
    return [_saved_location(row) for row in rows]


@router.post("/locations/saved", response_model=SavedLocationResponse, status_code=201)
def create_saved_location(payload: SavedLocationCreate, auth=Depends(current_auth), db: Session = Depends(get_db)):
    user, _session = auth
    candidates = list(db.scalars(select(SavedLocation).where(SavedLocation.user_id == user.id)))
    if any(row.name.casefold() == payload.name.casefold() or (
        round(row.latitude, 5) == round(payload.latitude, 5) and round(row.longitude, 5) == round(payload.longitude, 5)
    ) for row in candidates):
        raise HTTPException(status_code=409, detail="A saved place with this name or location already exists")
    row = SavedLocation(user_id=user.id, name=payload.name.strip(), latitude=payload.latitude,
                        longitude=payload.longitude, place_label=payload.place_label)
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A saved place with this name already exists") from exc
    db.refresh(row)
    return _saved_location(row)


@router.patch("/locations/saved/{location_id}", response_model=SavedLocationResponse)
def update_saved_location(location_id: UUID, payload: SavedLocationUpdate, auth=Depends(current_auth), db: Session = Depends(get_db)):
    user, _session = auth
    row = db.scalar(select(SavedLocation).where(SavedLocation.id == location_id, SavedLocation.user_id == user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="Saved location not found")
    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"] is not None:
        duplicate = any(other.id != row.id and other.name.casefold() == updates["name"].strip().casefold()
                        for other in db.scalars(select(SavedLocation).where(SavedLocation.user_id == user.id)))
        if duplicate:
            raise HTTPException(status_code=409, detail="A saved place with this name already exists")
    for key, value in updates.items():
        setattr(row, key, value.strip() if key == "name" and value is not None else value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A saved place with this name already exists") from exc
    db.refresh(row)
    return _saved_location(row)


@router.delete("/locations/saved/{location_id}", status_code=204)
def delete_saved_location(location_id: UUID, auth=Depends(current_auth), db: Session = Depends(get_db)):
    user, _session = auth
    row = db.scalar(select(SavedLocation).where(SavedLocation.id == location_id, SavedLocation.user_id == user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="Saved location not found")
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.post("/routes/compare", response_model=RouteCompareResponse)
async def compare_routes(payload: RouteCompareRequest, auth=Depends(current_auth)):
    settings = get_settings()
    route_data = await OSRMRouter(settings.routing_provider_url, settings.routing_timeout_seconds,
                                  settings.routing_max_alternatives, settings.route_cache_ttl_seconds).route(
        payload.origin.model_dump(), payload.destination.model_dump())
    result = await compare_exposure(route_data, _utc(payload.departure_at),
                                    OpenMeteoProvider(settings.open_meteo_base_url),
                                    settings.routing_sample_interval_m, settings.routing_max_samples_per_route)
    return result


@router.post("/exposure/estimates", response_model=ExposureResponse)
def create_estimate(payload: ExposureRequest, auth=Depends(current_auth), db: Session = Depends(get_db)):
    user, _session = auth
    result = estimate_exposure(payload.segments)
    record = ExposureEstimate(
        user_id=user.id, period_start=_utc(result["period_start"]), period_end=_utc(result["period_end"]),
        dose_ug_h_m3=result["dose_ug_h_m3"], time_weighted_mean_ug_m3=result["time_weighted_mean_ug_m3"],
        coverage=result["coverage"], provenance=result["provenance"], assumptions=result["assumptions"],
    )
    db.add(record)
    for segment in payload.segments:
        db.add(ActivitySegmentRecord(
            user_id=user.id, started_at=_utc(segment.started_at), ended_at=_utc(segment.ended_at),
            concentration_ug_m3=segment.concentration_ug_m3, activity=segment.activity,
            source=segment.source, concentration_kind=segment.concentration_kind,
        ))
    db.commit()
    return result


@router.get("/exposure/history")
def exposure_history(limit: int = Query(default=30, ge=1, le=90), auth=Depends(current_auth), db: Session = Depends(get_db)):
    user, _session = auth
    rows = list(db.scalars(select(ExposureEstimate).where(ExposureEstimate.user_id == user.id).order_by(ExposureEstimate.period_start.desc()).limit(limit)))
    return {"items": [
        {"id": str(row.id), "period_start": row.period_start, "period_end": row.period_end,
         "dose_ug_h_m3": row.dose_ug_h_m3, "time_weighted_mean_ug_m3": row.time_weighted_mean_ug_m3,
         "coverage": row.coverage, "assumptions": row.assumptions}
        for row in rows
    ]}


def _calculate_simulation(payload: SimulationRequest) -> dict:
    baseline = payload.baseline.concentration_ug_m3 * payload.baseline.duration_minutes / 60
    alternative = payload.alternative.concentration_ug_m3 * payload.alternative.duration_minutes / 60
    delta = round(alternative - baseline, 4)
    result = {
        "baseline_dose_ug_h_m3": round(baseline, 4), "alternative_dose_ug_h_m3": round(alternative, 4),
        "delta_ug_h_m3": delta, "delta_percent": round(delta / baseline * 100, 2) if baseline > 0 else None,
        "assumptions": [
            "Concentration is constant for each supplied scenario duration.",
            f"Sources: baseline={payload.baseline.source} ({payload.baseline.concentration_kind}); alternative={payload.alternative.source} ({payload.alternative.concentration_kind}).",
            "This is a concentration-time comparison, not a prediction of health outcomes.",
            "No statistical uncertainty interval is calculated from the supplied point estimates.",
            "Route geometry and transit-mode filtration are not modeled unless supported by supplied concentration and duration inputs.",
        ],
    }
    return result


@router.post("/simulations", response_model=SimulationResponse)
def simulate(payload: SimulationRequest, auth=Depends(current_auth), db: Session = Depends(get_db)):
    user, _session = auth
    result = _calculate_simulation(payload)
    db.add(SimulationRun(user_id=user.id, request_json=payload.model_dump(mode="json"), result_json=result))
    db.commit()
    return result


@router.get("/routines", response_model=list[RoutineResponse])
def list_routines(auth=Depends(current_auth), db: Session = Depends(get_db)):
    user, _session = auth
    rows = list(db.scalars(select(SavedRoutine).where(SavedRoutine.user_id == user.id).order_by(SavedRoutine.created_at.desc()).limit(50)))
    return [{"id": str(row.id), "title": row.title, "corridor_id": row.corridor_id, "created_at": row.created_at, "simulation": row.routine_json} for row in rows]


@router.post("/routines", response_model=RoutineResponse, status_code=201)
def create_routine(payload: RoutineCreate, auth=Depends(current_auth), db: Session = Depends(get_db)):
    user, _session = auth
    simulation = _calculate_simulation(payload.simulation)
    request_data = payload.simulation.model_dump(mode="json")
    db.add(SimulationRun(user_id=user.id, request_json=request_data, result_json=simulation))
    routine = SavedRoutine(
        user_id=user.id, title=payload.title, corridor_id=payload.corridor_id,
        routine_json={"request": request_data, "result": simulation},
    )
    db.add(routine)
    db.commit()
    db.refresh(routine)
    return {"id": str(routine.id), "title": routine.title, "corridor_id": routine.corridor_id, "created_at": routine.created_at, "simulation": routine.routine_json}


@router.get("/planner/summary", response_model=PlannerSummary)
def planner_summary(auth=Depends(current_auth), db: Session = Depends(get_db)):
    user, _session = auth
    since = datetime.now(timezone.utc) - timedelta(days=7)
    estimates = list(db.scalars(select(ExposureEstimate).where(
        ExposureEstimate.user_id == user.id, ExposureEstimate.period_end >= since,
    ).order_by(ExposureEstimate.period_start)))
    segments = list(db.scalars(select(ActivitySegmentRecord).where(
        ActivitySegmentRecord.user_id == user.id, ActivitySegmentRecord.ended_at >= since,
    )))
    daily: dict[str, dict[str, float]] = {}
    hour_totals: dict[int, list[float]] = {}
    for seg in segments:
        start = seg.started_at if seg.started_at.tzinfo else seg.started_at.replace(tzinfo=timezone.utc)
        end = seg.ended_at if seg.ended_at.tzinfo else seg.ended_at.replace(tzinfo=timezone.utc)
        day = start.date().isoformat()
        hours = (end - start).total_seconds() / 3600
        agg = daily.setdefault(day, {"dose": 0.0, "hours": 0.0})
        agg["dose"] += seg.concentration_ug_m3 * hours
        agg["hours"] += hours
        bucket = hour_totals.setdefault(start.hour, [0.0, 0.0, 0.0])
        bucket[0] += seg.concentration_ug_m3
        bucket[1] += 1
        bucket[2] += hours
    daily_series = [
        {"date": day, "dose_ug_h_m3": round(v["dose"], 2),
         "time_weighted_mean_ug_m3": round(v["dose"] / v["hours"], 2) if v["hours"] else None,
         "covered_hours": round(v["hours"], 2)}
        for day, v in sorted(daily.items())
    ]
    recommendations = []
    repeated = [(hour, values) for hour, values in hour_totals.items() if values[1] >= 3]
    if repeated:
        peak_hour, values = max(repeated, key=lambda pair: pair[1][0] / pair[1][1])
        recommendations.append(f"Your {len(segments)} logged activity segments include at least three entries around {peak_hour:02d}:00. Compare this time window with another route or schedule; the current data does not establish a health effect.")
    return {
        "terminology_note": "Pollution Debt is a product metaphor, not a clinical measure.",
        "estimate_count": len(estimates),
        "total_dose_ug_h_m3": round(sum(row.dose_ug_h_m3 for row in estimates), 2),
        "daily_series": daily_series,
        "coverage_note": "Only logged segments are summarized. Unlogged time is missing data, not zero exposure.",
        "recommendations": recommendations,
    }


@router.get("/planner/interventions")
def list_interventions(auth=Depends(current_auth), db: Session = Depends(get_db)):
    user, _session = auth
    rows = {row.code: row.applied for row in db.scalars(select(Intervention).where(Intervention.user_id == user.id))}
    return {"items": [{"code": code, "applied": rows.get(code, default)} for code, default in [
        ("action-1", True), ("action-2", True), ("action-3", False),
    ]]}


@router.put("/planner/interventions/{code}")
def update_intervention(code: str, payload: InterventionUpdate, auth=Depends(current_auth), db: Session = Depends(get_db)):
    if code not in {"action-1", "action-2", "action-3"}:
        raise HTTPException(status_code=404, detail="Intervention not found")
    user, _session = auth
    record = db.scalar(select(Intervention).where(Intervention.user_id == user.id, Intervention.code == code))
    if record is None:
        record = Intervention(user_id=user.id, code=code, applied=payload.applied)
        db.add(record)
    else:
        record.applied = payload.applied
    db.commit()
    return {"code": code, "applied": record.applied}


@router.post("/dashboard/actions", status_code=201)
def log_dashboard_action(payload: ActionLogRequest, auth=Depends(current_auth), db: Session = Depends(get_db)):
    user, _session = auth
    db.add(UserLog(user_id=user.id, event_type=payload.event_type, payload=payload.payload))
    db.commit()
    return {"status": "logged"}
