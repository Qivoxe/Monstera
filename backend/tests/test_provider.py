import json

import httpx
import pytest
from fastapi import HTTPException

from app.services.air_quality import OpenMeteoProvider


@pytest.mark.anyio
async def test_provider_normalizes_forecast_metadata():
    async def handler(request):
        assert request.url.params["hourly"] == "pm2_5"
        return httpx.Response(200, json={
            "latitude": 28.6, "longitude": 77.2,
            "hourly_units": {"pm2_5": "μg/m³"},
            "hourly": {"time": ["2026-10-10T09:00"], "pm2_5": [42.5]},
        })

    provider = OpenMeteoProvider("https://example.test/air-quality", httpx.MockTransport(handler))
    result = await provider.get_pm25(28.61, 77.21, 24)
    assert result["items"][0]["value"] == 42.5
    assert result["items"][0]["valid_at"].isoformat() == "2026-10-10T09:00:00+00:00"
    assert result["grid_location"] == {"latitude": 28.6, "longitude": 77.2}


@pytest.mark.anyio
async def test_provider_failure_is_reported_as_unavailable():
    async def handler(_request):
        return httpx.Response(429, json={"error": "rate limit"})

    provider = OpenMeteoProvider("https://example.test/air-quality", httpx.MockTransport(handler))
    with pytest.raises(HTTPException) as error:
        await provider.get_pm25(28.61, 77.21)
    assert error.value.status_code == 503


@pytest.mark.anyio
async def test_provider_missing_data_fails_closed():
    async def handler(_request):
        return httpx.Response(200, content=json.dumps({"hourly_units": {"pm2_5": "μg/m³"}, "hourly": {"time": [], "pm2_5": []}}))

    provider = OpenMeteoProvider("https://example.test/air-quality", httpx.MockTransport(handler))
    with pytest.raises(HTTPException) as error:
        await provider.get_pm25(28.61, 77.21)
    assert error.value.status_code == 503


@pytest.mark.anyio
async def test_provider_rejects_missing_unit_metadata():
    async def handler(_request):
        return httpx.Response(200, json={"hourly": {"time": ["2026-10-10T09:00"], "pm2_5": [42.5]}})

    provider = OpenMeteoProvider("https://example.test/air-quality", httpx.MockTransport(handler))
    with pytest.raises(HTTPException) as error:
        await provider.get_pm25(28.61, 77.21)
    assert error.value.status_code == 503
