from datetime import datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt

from app.services.cache import cache


def _distance(a, b):
    lat1, lon1 = radians(a[1]), radians(a[0])
    lat2, lon2 = radians(b[1]), radians(b[0])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 6_371_000 * 2 * asin(sqrt(h))


def sample_geometry(coordinates: list[list[float]], interval_m: int, max_samples: int) -> list[list[float]]:
    """Return evenly spaced [longitude, latitude] samples, bounded by max_samples."""
    lengths = [_distance(a, b) for a, b in zip(coordinates, coordinates[1:])]
    total = sum(lengths)
    count = max(1, min(max_samples, int(total / max(1, interval_m)) + 1))
    targets = [total * (i + 0.5) / count for i in range(count)]
    result, segment, traversed = [], 0, 0.0
    for target in targets:
        while segment < len(lengths) - 1 and traversed + lengths[segment] < target:
            traversed += lengths[segment]
            segment += 1
        length = lengths[segment] if lengths else 0
        ratio = max(0, min(1, (target - traversed) / length)) if length else 0
        a, b = coordinates[segment], coordinates[segment + 1]
        result.append([a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio])
    return result


async def compare_exposure(routes: list[dict], departure_at: datetime, provider, interval_m: int, max_samples: int) -> dict:
    now = datetime.now(timezone.utc)
    rows = []
    for route in routes:
        samples = sample_geometry(route["geometry"]["coordinates"], interval_m, max_samples)
        duration_h = route["duration_s"] / 3600
        concentrations, provenance = [], []
        for index, point in enumerate(samples):
            lat, lon = point[1], point[0]
            key = f"aq:forecast:{lat:.2f}:{lon:.2f}:48:v1"
            data = cache.get(key)
            if data is None:
                try:
                    data = await provider.get_pm25(lat, lon, 48)
                except Exception:
                    continue
                cache.set(key, data, 2700)
            target_time = departure_at + timedelta(seconds=route["duration_s"] * (index + 0.5) / len(samples))
            nearest = min(data["items"], key=lambda item: abs((item["valid_at"] - target_time).total_seconds()), default=None)
            if nearest is None or abs((nearest["valid_at"] - target_time).total_seconds()) > 3 * 3600:
                continue
            concentrations.append(nearest["value"])
            provenance.append({"source": "Open-Meteo / CAMS", "kind": "forecast", "valid_at": nearest["valid_at"].isoformat(),
                               "retrieved_at": data.get("retrieved_at"), "grid_location": data["grid_location"]})
        coverage = len(concentrations) / len(samples) if samples else 0
        # Equal time slices approximate segment durations because OSRM has no segment timings here.
        exposure = sum(value * duration_h / len(samples) for value in concentrations) if samples else None
        rows.append({**route, "exposure_proxy_ug_h_m3": round(exposure, 3) if exposure is not None and concentrations else None,
                     "exposure_unit": "µg·h/m³", "data_coverage": round(coverage, 3), "sample_count": len(samples),
                     "available_sample_count": len(concentrations), "source": "Open-Meteo / CAMS", "retrieved_at": now.isoformat(),
                     "forecast_retrieval_times": sorted({item["retrieved_at"] for item in provenance if item.get("retrieved_at")}),
                     "freshness": "comparison generated now; underlying forecast retrieval times and valid forecast hours are listed per sample", "provenance": provenance,
                     "uncertainty": "Regional model grid values do not resolve roadside differences; segment time is evenly allocated from total route duration."})
    valid = [row for row in rows if row["exposure_proxy_ug_h_m3"] is not None and row["data_coverage"] >= 0.8]
    recommendation = None
    status = "insufficient_data"
    if len(valid) == len(rows) and len(valid) >= 2:
        scores = sorted(valid, key=lambda row: row["exposure_proxy_ug_h_m3"])
        best, worst = scores[0], scores[-1]
        diff = worst["exposure_proxy_ug_h_m3"] - best["exposure_proxy_ug_h_m3"]
        if worst["exposure_proxy_ug_h_m3"] > 0 and diff / worst["exposure_proxy_ug_h_m3"] >= 0.15:
            status = "comparable"
            recommendation = f"{best['id']} has a lower modeled concentration-time proxy; this comparison has regional model uncertainty and no roadside precision."
    return {"status": status, "recommendation": recommendation, "routes": rows,
            "methodology": ["Exposure proxy = sum of estimated PM2.5 concentration × estimated segment time in hours (µg·h/m³).", "Route sample locations are evenly spaced at the configured interval, up to a per-route cap.", "Total OSRM travel time is divided evenly among samples because segment timing is unavailable.", "Only forecast samples with timestamps within three hours of estimated passage are counted; missing samples are not treated as zero.", "This is not inhaled dose, personal risk, or an exact estimate of what a traveller breathes.", "Forecast cache is in-memory, instance-local, and expires after 45 minutes; retrieved time and provider forecast times are both reported."]}
