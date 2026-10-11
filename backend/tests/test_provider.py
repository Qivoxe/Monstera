import json

import httpx
import pytest
from fastapi import HTTPException

from app.services.air_quality import OpenMeteoProvider
from app.services.air_quality import OpenMeteoGeocoder


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


@pytest.mark.anyio
async def test_forecast_cache_normalizes_coordinates_and_separates_forecast_length():
    from app.services.cache import cache
    calls = []
    async def handler(request):
        calls.append(request.url.params["forecast_hours"])
        return httpx.Response(200, json={
            "latitude": 28.6, "longitude": 77.2, "hourly_units": {"pm2_5": "ug/m³"},
            "hourly": {"time": ["2026-10-10T09:00"], "pm2_5": [42]},
        })
    cache.clear()
    provider = OpenMeteoProvider("https://example.test/air-quality", httpx.MockTransport(handler))
    await provider.get_pm25(28.601, 77.201, 24)
    await provider.get_pm25(28.604, 77.204, 24)
    await provider.get_pm25(28.604, 77.204, 48)
    assert calls == ["24", "48"]


@pytest.mark.anyio
@pytest.mark.parametrize("query,country_code,place", [
    ("East Delhi", "IN", {"name": "East Delhi", "country": "India", "country_code": "IN", "admin1": "Delhi", "latitude": 28.65, "longitude": 77.30}),
    ("New Delhi", "IN", {"name": "New Delhi", "country": "India", "country_code": "IN", "admin1": "Delhi", "latitude": 28.6139, "longitude": 77.2090}),
    ("Paris, France", None, {"name": "Paris", "country": "France", "country_code": "FR", "admin1": "Île-de-France", "latitude": 48.8566, "longitude": 2.3522}),
])
async def test_geocoder_returns_ranked_place_candidates_with_region_country_and_coordinates(query, country_code, place):
    from app.services.cache import cache
    cache.clear()
    async def handler(request):
        assert request.url.params["count"] == "10"
        assert request.url.params.get("countryCode") == country_code
        return httpx.Response(200, json={"results": [{**place, "id": 445566}]})
    result = await OpenMeteoGeocoder(httpx.MockTransport(handler)).search(query, country_code)
    selected = result["results"][0]
    assert selected["country"] == place["country"]
    assert selected["country_code"] == place["country_code"]
    assert selected["admin1"] == place["admin1"]
    assert selected["latitude"] == place["latitude"]
    assert selected["longitude"] == place["longitude"]


@pytest.mark.anyio
async def test_geocoder_returns_empty_candidate_list_without_substitution():
    async def handler(_request): return httpx.Response(200, json={"results": []})
    result = await OpenMeteoGeocoder(httpx.MockTransport(handler)).search("Place that does not exist", "IN")
    assert result == {"results": []}


@pytest.mark.anyio
async def test_geocoder_does_not_promote_first_of_ambiguous_matches():
    places = [
        {"name": "East Delhi", "country": "India", "country_code": "IN", "latitude": 28.65, "longitude": 77.3},
        {"name": "East Delhi", "country": "United States", "country_code": "US", "latitude": 40.1, "longitude": -75.2},
    ]
    async def handler(_request): return httpx.Response(200, json={"results": places})
    result = await OpenMeteoGeocoder(httpx.MockTransport(handler)).search("East Delhi")
    assert len(result["results"]) == 2
    assert "name" not in result
    assert [item["country_code"] for item in result["results"]] == ["IN", "US"]
