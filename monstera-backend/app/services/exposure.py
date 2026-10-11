from app.schemas import ActivitySegment


def estimate_exposure(segments: list[ActivitySegment]) -> dict:
    """Integrate concentration over duration: dose = Σ(C_i × hours_i)."""
    dose = 0.0
    covered = 0.0
    provenance = []
    for segment in segments:
        hours = (segment.ended_at - segment.started_at).total_seconds() / 3600
        dose += segment.concentration_ug_m3 * hours
        covered += hours
        provenance.append({"source": segment.source, "kind": segment.concentration_kind, "activity": segment.activity})
    starts = [s.started_at for s in segments]
    ends = [s.ended_at for s in segments]
    period_hours = (max(ends) - min(starts)).total_seconds() / 3600
    return {
        "period_start": min(starts),
        "period_end": max(ends),
        "dose_ug_h_m3": round(dose, 4),
        "time_weighted_mean_ug_m3": round(dose / covered, 4) if covered else None,
        "covered_hours": round(covered, 4),
        "coverage": round(min(1.0, covered / period_hours), 4) if period_hours else 1.0,
        "assumptions": ["Concentration is constant within each supplied activity segment.", "No statistical uncertainty interval is reported because the inputs contain no uncertainty metadata.", "This estimates concentration-time exposure and is not inhaled mass or a health outcome."],
        "provenance": provenance,
    }
