from datetime import datetime, timezone

import httpx
from fastapi import HTTPException


class OpenMeteoProvider:
    def __init__(self, base_url: str, transport: httpx.AsyncBaseTransport | None = None):
        self.base_url = base_url
        self.transport = transport

    async def get_pm25(self, latitude: float, longitude: float, forecast_hours: int = 24) -> dict:
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
        return {"items": items, "grid_location": grid}


class OpenMeteoGeocoder:
    async def search(self, name: str) -> dict:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get("https://geocoding-api.open-meteo.com/v1/search", params={"name": name, "count": 1, "language": "en", "format": "json"})
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(status_code=503, detail="Location search is temporarily unavailable") from exc
        results = payload.get("results") or []
        if not results:
            raise HTTPException(status_code=404, detail="Location was not found")
        place = results[0]
        try:
            return {"name": place["name"], "country": place.get("country"), "latitude": float(place["latitude"]), "longitude": float(place["longitude"])}
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(status_code=503, detail="Location provider returned invalid coordinates") from exc
