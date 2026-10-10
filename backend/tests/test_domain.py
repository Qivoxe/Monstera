from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas import ActivitySegment, Scenario
from app.services.exposure import estimate_exposure


def segment(start, end, concentration):
    return ActivitySegment(
        started_at=datetime.fromisoformat(start).replace(tzinfo=timezone.utc),
        ended_at=datetime.fromisoformat(end).replace(tzinfo=timezone.utc),
        concentration_ug_m3=concentration,
        concentration_kind="observed",
        source="test fixture",
    )


def test_exposure_integrates_concentration_over_duration():
    result = estimate_exposure([segment("2026-01-01T08:00", "2026-01-01T09:00", 20)])
    assert result["dose_ug_h_m3"] == 20
    assert result["time_weighted_mean_ug_m3"] == 20
    assert result["covered_hours"] == 1
    assert result["coverage"] == 1


def test_exposure_preserves_missing_time_as_incomplete_coverage():
    result = estimate_exposure([
        segment("2026-01-01T08:00", "2026-01-01T09:00", 20),
        segment("2026-01-01T10:00", "2026-01-01T11:00", 40),
    ])
    assert result["dose_ug_h_m3"] == 60
    assert result["coverage"] == pytest.approx(2 / 3, abs=0.0001)


def test_rejects_non_positive_activity_duration():
    with pytest.raises(ValidationError):
        segment("2026-01-01T09:00", "2026-01-01T08:00", 20)


def test_scenario_rejects_negative_duration():
    with pytest.raises(ValidationError):
        Scenario(concentration_ug_m3=10, duration_minutes=0, source="test", concentration_kind="forecast")


def test_exposure_request_rejects_overlapping_segments():
    from app.schemas import ExposureRequest
    with pytest.raises(ValidationError):
        ExposureRequest(segments=[
            segment("2026-01-01T08:00", "2026-01-01T09:00", 20),
            segment("2026-01-01T08:30", "2026-01-01T09:30", 30),
        ])


def test_exposure_request_requires_timezone_aware_timestamps():
    with pytest.raises(ValidationError):
        ActivitySegment(
            started_at=datetime(2026, 1, 1, 8), ended_at=datetime(2026, 1, 1, 9),
            concentration_ug_m3=20, concentration_kind="forecast", source="fixture",
        )
