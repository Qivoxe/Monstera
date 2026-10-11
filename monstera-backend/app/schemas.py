from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ErrorResponse(BaseModel):
    detail: str
    code: str


class AirQualityItem(BaseModel):
    pollutant: Literal["pm2_5"] = "pm2_5"
    value: float = Field(ge=0)
    unit: Literal["µg/m³"] = "µg/m³"
    kind: Literal["forecast"] = "forecast"
    valid_at: datetime
    provider: str = "Open-Meteo / CAMS"
    grid_location: dict[str, float]


class AirQualityResponse(BaseModel):
    requested_location: dict[str, float]
    items: list[AirQualityItem]
    attribution: str


class LocationResponse(BaseModel):
    name: str
    country: str | None
    latitude: float
    longitude: float


class ActivitySegment(BaseModel):
    started_at: datetime
    ended_at: datetime
    concentration_ug_m3: float = Field(ge=0, le=5000)
    concentration_kind: Literal["observed", "forecast", "modeled"]
    source: str = Field(min_length=1, max_length=120)
    activity: str = Field(default="unspecified", max_length=48)

    @model_validator(mode="after")
    def valid_interval(self):
        if self.started_at.utcoffset() is None or self.ended_at.utcoffset() is None:
            raise ValueError("timestamps must include a timezone")
        if self.ended_at <= self.started_at:
            raise ValueError("ended_at must be after started_at")
        return self


class ExposureRequest(BaseModel):
    segments: list[ActivitySegment] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def segments_must_not_overlap(self):
        ordered = sorted(self.segments, key=lambda item: item.started_at)
        if any(current.started_at < previous.ended_at for previous, current in zip(ordered, ordered[1:])):
            raise ValueError("activity segments must not overlap")
        return self


class ExposureResponse(BaseModel):
    period_start: datetime
    period_end: datetime
    dose_ug_h_m3: float
    time_weighted_mean_ug_m3: float | None
    unit: Literal["µg·h/m³"] = "µg·h/m³"
    covered_hours: float
    coverage: float = Field(ge=0, le=1)
    assumptions: list[str]
    provenance: list[dict]


class Scenario(BaseModel):
    concentration_ug_m3: float = Field(ge=0, le=5000)
    duration_minutes: float = Field(gt=0, le=24 * 60)
    source: str = Field(min_length=1, max_length=120)
    concentration_kind: Literal["observed", "forecast", "modeled"]


class SimulationRequest(BaseModel):
    baseline: Scenario
    alternative: Scenario
    context: dict = Field(default_factory=dict)


class SimulationResponse(BaseModel):
    baseline_dose_ug_h_m3: float
    alternative_dose_ug_h_m3: float
    delta_ug_h_m3: float
    delta_percent: float | None
    unit: Literal["µg·h/m³"] = "µg·h/m³"
    assumptions: list[str]


class RoutineCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    corridor_id: str = Field(min_length=1, max_length=80)
    simulation: SimulationRequest


class RoutineResponse(BaseModel):
    id: str
    title: str
    corridor_id: str
    created_at: datetime
    simulation: dict


class PlannerSummary(BaseModel):
    terminology_note: str
    estimate_count: int
    total_dose_ug_h_m3: float
    daily_series: list[dict]
    coverage_note: str
    recommendations: list[str]


class Credentials(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    email: str = Field(min_length=5, max_length=320)
    password: str = Field(min_length=12, max_length=128)

    @model_validator(mode="after")
    def validate_email(self):
        if "@" not in self.email or "." not in self.email.rsplit("@", 1)[-1]:
            raise ValueError("Enter a valid email address")
        self.email = self.email.strip().lower()
        if self.display_name is not None:
            self.display_name = self.display_name.strip()
            if len(self.display_name) < 2:
                raise ValueError("display_name must contain at least two characters")
        return self


class AuthResponse(BaseModel):
    id: str
    display_name: str | None = None
    email: str
    csrf_token: str


class PreferenceResponse(BaseModel):
    sensitivity: str
    commute_reminder: bool
    indoor_air_alert: bool
    home_location: str | None
    home_latitude: float | None
    home_longitude: float | None


class PreferenceUpdate(BaseModel):
    sensitivity: str = Field(pattern="^(normal|sensitive|high)$")
    commute_reminder: bool
    indoor_air_alert: bool
    home_location: str | None = Field(default=None, min_length=1, max_length=160)
    home_latitude: float | None = Field(default=None, ge=-90, le=90)
    home_longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def valid_home_location(self):
        has_any_coordinate = self.home_latitude is not None or self.home_longitude is not None
        has_all_coordinates = self.home_latitude is not None and self.home_longitude is not None
        if has_any_coordinate and (self.home_location is None or not has_all_coordinates):
            raise ValueError("home location and both coordinates must be provided together")
        if self.home_location is not None and not has_all_coordinates:
            raise ValueError("home location and both coordinates must be provided together")
        return self


class InterventionUpdate(BaseModel):
    applied: bool


class ActionLogRequest(BaseModel):
    event_type: str = Field(pattern="^(filter_replacement|mask_reminder)$")
    payload: dict = Field(default_factory=dict)
