import hashlib
import json

import httpx
from fastapi import HTTPException

from app.services.cache import cache


class OSRMRouter:
    def __init__(self, base_url: str, timeout: float = 8, max_alternatives: int = 3, cache_ttl: int = 1200, transport=None):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_alternatives = max(1, min(max_alternatives, 3))
        self.cache_ttl = max(0, cache_ttl)
        self.transport = transport

    async def route(self, origin: dict, destination: dict) -> list[dict]:
        # OSRM coordinate order is longitude,latitude. Never accept provider URLs from clients.
        coords = f"{origin['longitude']:.5f},{origin['latitude']:.5f};{destination['longitude']:.5f},{destination['latitude']:.5f}"
        key = "route:v1:" + hashlib.sha256(f"{self.base_url}|driving|{self.max_alternatives}|{coords}".encode()).hexdigest()
        result = cache.get(key)
        if result is not None:
            return result
        url = f"{self.base_url}/route/v1/driving/{coords}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
                response = None
                # GET is safe to retry once after transient gateway errors/timeouts.
                for attempt in range(2):
                    try:
                        response = await client.get(url, params={"alternatives": str(self.max_alternatives), "overview": "full", "geometries": "geojson", "steps": "false"})
                        if response.status_code == 429:
                            raise HTTPException(status_code=503, detail="Routing provider rate limit reached; try again later")
                        if response.status_code in {502, 503, 504} and attempt == 0:
                            continue
                        break
                    except httpx.TimeoutException:
                        if attempt == 0:
                            continue
                        raise
                if response is None:
                    raise HTTPException(status_code=503, detail="Routing provider is temporarily unavailable")
                response.raise_for_status()
                if len(response.content) > 5_000_000:
                    raise HTTPException(status_code=503, detail="Routing provider response exceeded the size limit")
                payload = response.json()
        except HTTPException:
            raise
        except httpx.TimeoutException as exc:
            raise HTTPException(status_code=503, detail="Routing provider timed out") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(status_code=503, detail="Routing provider is temporarily unavailable") from exc
        if not isinstance(payload, dict) or payload.get("code") != "Ok" or not isinstance(payload.get("routes"), list):
            if isinstance(payload, dict) and payload.get("code") == "NoRoute":
                raise HTTPException(status_code=404, detail="No driving route is available between these locations")
            raise HTTPException(status_code=503, detail="Routing provider returned an invalid response")
        routes = []
        for index, route in enumerate(payload["routes"][: self.max_alternatives]):
            geometry = route.get("geometry", {})
            coordinates = geometry.get("coordinates") if isinstance(geometry, dict) else None
            if not isinstance(coordinates, list) or len(coordinates) < 2 or not all(
                isinstance(point, list) and len(point) >= 2 and all(isinstance(v, (int, float)) for v in point[:2])
                and -180 <= point[0] <= 180 and -90 <= point[1] <= 90 for point in coordinates
            ):
                continue
            distance, duration = route.get("distance"), route.get("duration")
            if not isinstance(distance, (int, float)) or not isinstance(duration, (int, float)) or distance <= 0 or duration <= 0:
                continue
            routes.append({"id": f"route-{index + 1}", "geometry": {"type": "LineString", "coordinates": coordinates}, "distance_m": float(distance), "duration_s": float(duration)})
        if not routes:
            raise HTTPException(status_code=503, detail="Routing provider returned no usable route geometry")
        cache.set(key, routes, self.cache_ttl)
        return routes
