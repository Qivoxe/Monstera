from fastapi.testclient import TestClient

from app.main import app
from app.db.session import get_db
import app.api.routes as routes


def signed_in(email="person@example.com"):
    client = TestClient(app)
    response = client.post("/api/v1/auth/register", json={"email": email, "password": "correct horse battery staple 42"})
    assert response.status_code == 201
    return client, {"X-CSRF-Token": response.json()["csrf_token"]}


class FailingDB:
    def execute(self, _query):
        raise RuntimeError("not connected")

    def close(self):
        pass


def test_health_does_not_require_database():
    client = TestClient(app)
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_reports_unavailable_database():
    app.dependency_overrides[get_db] = lambda: FailingDB()
    try:
        response = TestClient(app).get("/api/v1/ready")
        assert response.status_code == 503
        assert response.json()["detail"] == "Database is unavailable"
    finally:
        app.dependency_overrides.clear()


def test_air_quality_validates_coordinates_before_provider_call():
    response = TestClient(app).get("/api/v1/air-quality/forecast?latitude=120&longitude=77")
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_air_quality_endpoint_persists_provider_forecast(monkeypatch):
    class DB:
        def __init__(self):
            self.rows = []
            self.commits = 0

        def scalar(self, _query):
            return None

        def add(self, row):
            self.rows.append(row)

        def commit(self):
            self.commits += 1

        def close(self):
            pass

    db = DB()
    app.dependency_overrides[get_db] = lambda: db

    class Provider:
        def __init__(self, _base_url):
            pass

        async def get_pm25(self, latitude, longitude, hours):
            from datetime import datetime, timezone
            return {
                "items": [{"value": 40.0, "valid_at": datetime(2026, 10, 10, tzinfo=timezone.utc)}],
                "grid_location": {"latitude": latitude, "longitude": longitude},
            }

    monkeypatch.setattr(routes, "OpenMeteoProvider", Provider)
    try:
        response = TestClient(app).get("/api/v1/air-quality/forecast?latitude=28.6&longitude=77.2")
        assert response.status_code == 200
        assert response.json()["items"][0]["kind"] == "forecast"
        assert response.json()["items"][0]["value"] == 40
        assert len(db.rows) == 1
        assert db.rows[0].data_kind == "forecast"
        assert db.commits == 1
    finally:
        app.dependency_overrides.clear()


def test_exposure_endpoint_returns_transparent_concentration_time_estimate():
    payload = {
        "segments": [{
            "started_at": "2026-10-10T08:00:00Z",
            "ended_at": "2026-10-10T09:00:00Z",
            "concentration_ug_m3": 20,
            "concentration_kind": "observed",
            "source": "test station",
            "activity": "commute",
        }]
    }
    client, headers = signed_in()
    response = client.post("/api/v1/exposure/estimates", json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json()["dose_ug_h_m3"] == 20
    assert response.json()["time_weighted_mean_ug_m3"] == 20
    assert response.json()["coverage"] == 1


def test_simulation_handles_zero_baseline_percentage_as_undefined():
    payload = {
        "baseline": {"concentration_ug_m3": 0, "duration_minutes": 20, "source": "none", "concentration_kind": "modeled"},
        "alternative": {"concentration_ug_m3": 30, "duration_minutes": 30, "source": "forecast", "concentration_kind": "forecast"},
    }
    client, headers = signed_in()
    response = client.post("/api/v1/simulations", json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json()["alternative_dose_ug_h_m3"] == 15
    assert response.json()["delta_percent"] is None


def test_planner_states_history_is_missing_instead_of_zero_exposure():
    client, _headers = signed_in()
    response = client.get("/api/v1/planner/summary")
    assert response.status_code == 200
    assert response.json()["estimate_count"] == 0
    assert "not zero exposure" in response.json()["coverage_note"]


def test_exposure_request_validation_error_is_structured():
    client, headers = signed_in()
    response = client.post("/api/v1/exposure/estimates", headers=headers, json={"segments": [
        {"started_at": "2026-10-10T08:00:00Z", "ended_at": "2026-10-10T09:00:00Z", "concentration_ug_m3": 20, "concentration_kind": "forecast", "source": "a"},
        {"started_at": "2026-10-10T08:30:00Z", "ended_at": "2026-10-10T09:30:00Z", "concentration_ug_m3": 30, "concentration_kind": "forecast", "source": "b"},
    ]})
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_personal_endpoints_require_login_and_csrf():
    client = TestClient(app)
    unauthenticated = client.get("/api/v1/planner/summary")
    assert unauthenticated.status_code == 401
    client, _headers = signed_in()
    no_csrf = client.post("/api/v1/dashboard/actions", json={"event_type": "filter_replacement", "payload": {}})
    assert no_csrf.status_code == 403


def test_registration_preferences_and_account_isolation():
    client_a, csrf_a = signed_in()
    saved = client_a.put("/api/v1/preferences", headers=csrf_a, json={
        "sensitivity": "high", "commute_reminder": False, "indoor_air_alert": True,
    })
    assert saved.status_code == 200
    assert saved.json()["sensitivity"] == "high"
    home = client_a.put("/api/v1/preferences", headers=csrf_a, json={
        "sensitivity": "high", "commute_reminder": False, "indoor_air_alert": True,
        "home_location": "Pune, India", "home_latitude": 18.52, "home_longitude": 73.85,
    })
    assert home.status_code == 200
    assert home.json()["home_location"] == "Pune, India"
    assert home.json()["home_latitude"] == 18.52
    client_b, _csrf_b = signed_in("other@example.com")
    assert client_b.get("/api/v1/preferences").json()["sensitivity"] == "normal"
    assert client_b.get("/api/v1/preferences").json()["home_location"] is None


def test_register_saves_display_name_to_account():
    response = TestClient(app).post("/api/v1/auth/register", json={
        "display_name": "Jordan Lee", "email": "jordan@example.com", "password": "correct horse battery staple 42",
    })
    assert response.status_code == 201
    assert response.json()["display_name"] == "Jordan Lee"


def test_exposure_and_simulations_are_scoped_to_account():
    client_a, csrf_a = signed_in()
    payload = {"segments": [{
        "started_at": "2026-10-10T08:00:00Z", "ended_at": "2026-10-10T09:00:00Z",
        "concentration_ug_m3": 20, "concentration_kind": "observed", "source": "station", "activity": "commute",
    }]}
    assert client_a.post("/api/v1/exposure/estimates", json=payload, headers=csrf_a).status_code == 200
    assert len(client_a.get("/api/v1/exposure/history").json()["items"]) == 1
    client_b, _csrf_b = signed_in("other@example.com")
    assert client_b.get("/api/v1/exposure/history").json()["items"] == []


def test_account_deletion_cascades_private_records():
    client, csrf = signed_in()
    response = client.delete("/api/v1/auth/account", headers=csrf)
    assert response.status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401
