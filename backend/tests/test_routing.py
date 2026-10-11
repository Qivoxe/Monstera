import httpx
import pytest
from fastapi import HTTPException
from datetime import datetime, timezone
from pydantic import ValidationError

from app.services.cache import TTLCache, cache
from app.services.route_exposure import sample_geometry, compare_exposure
from app.services.routing import OSRMRouter
from app.schemas import RouteCompareRequest


@pytest.mark.anyio
async def test_osrm_uses_longitude_latitude_and_parses_alternatives():
    async def handler(request):
        assert "/route/v1/driving/77.20000,28.60000;72.80000,19.00000" in request.url.path
        assert request.url.params["geometries"] == "geojson"
        route = {"geometry": {"type": "LineString", "coordinates": [[77.2, 28.6], [72.8, 19.0]]}, "distance": 1000, "duration": 500}
        return httpx.Response(200, json={"code": "Ok", "routes": [route, route]})

    cache.clear()
    router = OSRMRouter("https://routing.example", transport=httpx.MockTransport(handler))
    result = await router.route({"latitude": 28.6, "longitude": 77.2}, {"latitude": 19, "longitude": 72.8})
    assert len(result) == 2
    assert result[0]["geometry"]["coordinates"][0] == [77.2, 28.6]


@pytest.mark.anyio
@pytest.mark.parametrize("payload,status", [({"code": "NoRoute", "routes": []}, 404), ({"code": "Ok", "routes": [{"geometry": {}, "distance": 2, "duration": 1}]}, 503)])
async def test_osrm_no_route_and_malformed_geometry(payload, status):
    async def handler(_request): return httpx.Response(200, json=payload)
    with pytest.raises(HTTPException) as error:
        await OSRMRouter("https://routing.example", transport=httpx.MockTransport(handler)).route({"latitude": 1, "longitude": 2}, {"latitude": 3, "longitude": 4})
    assert error.value.status_code == status


@pytest.mark.anyio
@pytest.mark.parametrize("response,status", [(429, 503), (200, 503)])
async def test_osrm_rate_limit_and_timeout(response, status):
    async def handler(_request):
        if response == 200: raise httpx.TimeoutException("timed out")
        return httpx.Response(response)
    with pytest.raises(HTTPException) as error:
        await OSRMRouter("https://routing.example", transport=httpx.MockTransport(handler)).route({"latitude": 10, "longitude": 20}, {"latitude": 30, "longitude": 40})
    assert error.value.status_code == status


@pytest.mark.anyio
async def test_osrm_retries_one_transient_gateway_failure():
    calls = 0
    async def handler(_request):
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"code": "Ok", "routes": [{
            "geometry": {"type": "LineString", "coordinates": [[1, 2], [3, 4]]}, "distance": 500, "duration": 300,
        }]})
    router = OSRMRouter("https://retry.example", transport=httpx.MockTransport(handler))
    assert len(await router.route({"latitude": 2, "longitude": 1}, {"latitude": 4, "longitude": 3})) == 1
    assert calls == 2


def test_route_sampling_respects_maximum_and_lon_lat_order():
    points = sample_geometry([[0, 0], [0.1, 0]], interval_m=500, max_samples=4)
    assert len(points) == 4
    assert all(point[1] == 0 for point in points)
    assert points[0][0] < points[-1][0]


def test_cache_hits_expiry_and_capacity():
    local = TTLCache(max_entries=1)
    local.set("a", 1, 20)
    assert local.get("a") == 1
    local.set("b", 2, 20)
    assert local.get("a") is None
    local.set("expired", 3, 0)
    assert local.get("expired") is None


def test_route_request_validates_coordinate_ranges_and_timezone():
    base = {"origin": {"latitude": 28.6, "longitude": 77.2}, "destination": {"latitude": 19, "longitude": 72.8}, "departure_at": datetime.now(timezone.utc).isoformat()}
    with pytest.raises(ValidationError):
        RouteCompareRequest.model_validate({**base, "origin": {"latitude": 100, "longitude": 77.2}})
    with pytest.raises(ValidationError):
        RouteCompareRequest.model_validate({**base, "departure_at": "2026-10-11T12:00:00"})


@pytest.mark.anyio
async def test_missing_forecast_samples_are_not_zero_and_comparison_is_insufficient():
    routes = [{"id": "route-1", "geometry": {"coordinates": [[0, 0], [0.01, 0]]}, "distance_m": 1000, "duration_s": 600},
              {"id": "route-2", "geometry": {"coordinates": [[0, 0], [0.02, 0]]}, "distance_m": 1200, "duration_s": 700}]
    class Provider:
        async def get_pm25(self, *_args): raise HTTPException(status_code=503, detail="unavailable")
    cache.clear()
    data = await compare_exposure(routes, datetime.now(timezone.utc), Provider(), 1000, 2)
    assert data["status"] == "insufficient_data"
    assert all(route["exposure_proxy_ug_h_m3"] is None for route in data["routes"])


@pytest.mark.anyio
async def test_route_exposure_time_weighting_and_supported_recommendation():
    departure = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    routes = [
        {"id": "route-clean", "geometry": {"coordinates": [[0, 10], [0.2, 10]]}, "distance_m": 1000, "duration_s": 3600},
        {"id": "route-higher", "geometry": {"coordinates": [[0, 11], [0.2, 11]]}, "distance_m": 1100, "duration_s": 3600},
    ]
    class Provider:
        async def get_pm25(self, latitude, longitude, _hours):
            return {"items": [{"value": 10 if latitude < 10.5 else 30, "valid_at": departure}],
                    "grid_location": {"latitude": latitude, "longitude": longitude}, "retrieved_at": departure.isoformat()}
    cache.clear()
    data = await compare_exposure(routes, departure, Provider(), 1000, 2)
    assert data["status"] == "comparable"
    assert data["routes"][0]["exposure_proxy_ug_h_m3"] == 10
    assert data["routes"][1]["exposure_proxy_ug_h_m3"] == 30
    assert data["routes"][0]["data_coverage"] == 1
    assert any("not inhaled dose" in note for note in data["methodology"])
