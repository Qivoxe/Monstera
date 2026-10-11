from datetime import datetime, timezone

import httpx
from fastapi import HTTPException
from app.services.cache import cache
from app.core.config import get_settings


class OpenMeteoProvider:
    def __init__(self, base_url: str, transport: httpx.AsyncBaseTransport | None = None):
        self.base_url = base_url
        self.transport = transport

    async def get_pm25(self, latitude: float, longitude: float, forecast_hours: int = 24) -> dict:
        cache_key = f"aq:forecast:{latitude:.2f}:{longitude:.2f}:{forecast_hours}:v1"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "hourly": "pm2_5",
            "forecast_hours": forecast_hours,
            "timezone": "UTC",
        }
        try:
            async with httpx.AsyncClient(timeout=10, transport=self.transport) as client:
                response = await client.get(self.base_url, params=params)
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=503, detail="Air-quality provider is temporarily unavailable") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(status_code=503, detail="Could not retrieve air-quality forecast") from exc

        hourly = payload.get("hourly", {})
        unit = payload.get("hourly_units", {}).get("pm2_5")
        if unit not in {"μg/m³", "µg/m³", "ug/m³", "μg/m3", "µg/m3", "ug/m3"}:
            raise HTTPException(status_code=503, detail="Provider returned an unsupported or missing PM2.5 unit")
        times, values = hourly.get("time", []), hourly.get("pm2_5", [])
        if len(times) != len(values) or not times:
            raise HTTPException(status_code=503, detail="Provider returned no usable PM2.5 forecast")
        try:
            grid = {"latitude": float(payload["latitude"]), "longitude": float(payload["longitude"])}
            items = [
                {"value": float(value), "valid_at": datetime.fromisoformat(time).replace(tzinfo=timezone.utc), "grid_location": grid}
                for time, value in zip(times, values)
                if value is not None and float(value) >= 0
            ]
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(status_code=503, detail="Provider returned invalid PM2.5 data") from exc
        if not items:
            raise HTTPException(status_code=503, detail="Provider returned no valid PM2.5 forecast values")
        result = {"items": items, "grid_location": grid, "retrieved_at": datetime.now(timezone.utc).isoformat()}
        cache.set(cache_key, result, get_settings().forecast_cache_ttl_seconds)
        return result


class OpenMeteoGeocoder:
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None):
        self.transport = transport

    async def search(self, name: str, country_code: str | None = None) -> dict:
        country_code = country_code.upper() if country_code else None
        key = f"geocode:{name.strip().casefold()}:{country_code or 'any'}"
        cached = cache.get(key)
        if cached is not None:
            return cached
        try:
            async with httpx.AsyncClient(timeout=10, transport=self.transport) as client:
                params = {"name": name.strip(), "count": 10, "language": "en", "format": "json"}
                if country_code:
                    params["countryCode"] = country_code
                response = await client.get("https://geocoding-api.open-meteo.com/v1/search", params=params)
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(status_code=503, detail="Location search is temporarily unavailable") from exc
        results = payload.get("results") or []
        try:
            normalized = [{
                "id": place.get("id"), "name": place["name"], "country": place.get("country"), "latitude": float(place["latitude"]),
                "longitude": float(place["longitude"]), "country_code": place.get("country_code"),
                "admin1": place.get("admin1"), "admin2": place.get("admin2"),
                "admin3": place.get("admin3"), "admin4": place.get("admin4"),
            } for place in results[:10]]
            # Keep single-result compatibility only when the provider returned one
            # unambiguous match. Never promote the first of several matches to selected.
            result = {"results": normalized}
            if len(normalized) == 1:
                result.update(normalized[0])
            cache.set(key, result, get_settings().geocoding_cache_ttl_seconds)
            return result
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(status_code=503, detail="Location provider returned invalid coordinates") from exc
