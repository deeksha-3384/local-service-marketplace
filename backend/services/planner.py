"""Recovery Planner: assign open requests to planner-mode providers.

Pure functions only (no Flask, no database), so the logic is easy to test.
The caller passes plain dicts and decides which providers are eligible
(planner mode, active, verified, free at the time slot).

Rules
- A provider is feasible for a request when the request's category is in the
  provider's categories AND the distance is within the provider's radius.
- The solver assigns each provider at most one request per run, and each
  request to at most one provider.
- Priority 1: serve as many requests as possible.
- Priority 2: minimise  distance + rating penalty + severity penalty, so
  closer, better-rated providers are preferred and, when providers are
  scarce, higher-severity requests are served first.
"""
import math

import numpy as np
from scipy.optimize import linear_sum_assignment

from services.geo import haversine_km, valid_coordinates

MAX_RADIUS_KM = 500.0
RATING_WEIGHT = 2.0     # one rating star below 5 costs as much as 2 km
SEVERITY_WEIGHT = 1.0   # one severity point below 100 costs as much as 1 km
MAX_CELLS = 250_000     # requests x providers; larger runs must be split


def _to_float(value):
    """Accepts int, float, Decimal and numeric strings; rejects NaN and inf."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _clamp(value, low, high):
    return min(max(value, low), high)


def _clean_request(raw):
    lat, lng = _to_float(raw.get("lat")), _to_float(raw.get("lng"))
    if lat is None or lng is None or not valid_coordinates(lat, lng):
        return None
    severity = _to_float(raw.get("severity_score"))
    return {
        "id": str(raw["id"]),
        "category": raw.get("category"),
        "lat": lat,
        "lng": lng,
        # Unknown severity (e.g. AI was unavailable) is treated as neutral
        "severity": 50.0 if severity is None else _clamp(severity, 0.0, 100.0),
    }


def _clean_provider(raw):
    lat, lng = _to_float(raw.get("lat")), _to_float(raw.get("lng"))
    if lat is None or lng is None or not valid_coordinates(lat, lng):
        return None
    radius = _to_float(raw.get("service_radius_km"))
    rating = _to_float(raw.get("rating"))
    return {
        "id": str(raw["id"]),
        "categories": set(raw.get("categories") or []),
        "lat": lat,
        "lng": lng,
        "radius": 0.0 if radius is None else _clamp(radius, 0.0, MAX_RADIUS_KM),
        "rating": 0.0 if rating is None else _clamp(rating, 0.0, 5.0),
    }


def plan_assignments(requests, providers):
    """
    requests:  [{id, category, lat, lng, severity_score}]
    providers: [{id, categories, lat, lng, service_radius_km, rating}]

    Returns {
        assignments: [{request_id, provider_id, distance_km, score}],
        unassigned: [{request_id, reason}],
        unassigned_request_ids: [request_id],
    }
    Reasons: missing_location, no_planner_providers, no_provider_in_range, no_capacity
    """
    unassigned = {}

    reqs = []
    for raw in requests:
        cleaned = _clean_request(raw)
        if cleaned is None:
            unassigned[str(raw["id"])] = "missing_location"
        else:
            reqs.append(cleaned)

    provs = [c for c in (_clean_provider(p) for p in providers) if c is not None]

    # Stable order so identical inputs always give identical output
    reqs.sort(key=lambda r: r["id"])
    provs.sort(key=lambda p: p["id"])

    n, m = len(reqs), len(provs)
    assignments = []

    if n and not m:
        for r in reqs:
            unassigned[r["id"]] = "no_planner_providers"
    elif n:
        if n * m > MAX_CELLS:
            raise ValueError("Problem too large; split the planner run into batches.")

        max_feasible_cost = MAX_RADIUS_KM + 5 * RATING_WEIGHT + 100 * SEVERITY_WEIGHT
        # Any assignment that serves one more request must beat any cost
        # saving, so the "infeasible" price exceeds the sum of all feasible costs.
        big = max_feasible_cost * (min(n, m) + 1)

        cost = np.full((n, m), big, dtype=float)
        feasible = np.zeros((n, m), dtype=bool)
        dist = np.zeros((n, m), dtype=float)

        for i, r in enumerate(reqs):
            for j, p in enumerate(provs):
                d = haversine_km(r["lat"], r["lng"], p["lat"], p["lng"])
                dist[i, j] = d
                if p["radius"] > 0 and d <= p["radius"] and r["category"] in p["categories"]:
                    feasible[i, j] = True
                    cost[i, j] = (
                        d
                        + (5.0 - p["rating"]) * RATING_WEIGHT
                        + (100.0 - r["severity"]) * SEVERITY_WEIGHT
                    )

        rows, cols = linear_sum_assignment(cost)
        matched = set()
        for i, j in zip(rows, cols):
            if not feasible[i, j]:
                continue
            r, p, d = reqs[i], provs[j], float(dist[i, j])
            score = 100.0 * (0.7 * (1.0 - d / p["radius"]) + 0.3 * (p["rating"] / 5.0))
            assignments.append(
                {
                    "request_id": r["id"],
                    "provider_id": p["id"],
                    "distance_km": round(d, 2),
                    "score": round(_clamp(score, 0.0, 100.0), 1),
                    "_severity": r["severity"],
                }
            )
            matched.add(i)

        for i, r in enumerate(reqs):
            if i not in matched:
                unassigned[r["id"]] = (
                    "no_provider_in_range" if not feasible[i].any() else "no_capacity"
                )

    # Most severe first, then by id for a stable order
    assignments.sort(key=lambda a: (-a["_severity"], a["request_id"]))
    for a in assignments:
        del a["_severity"]

    unassigned_list = [
        {"request_id": rid, "reason": reason} for rid, reason in sorted(unassigned.items())
    ]
    return {
        "assignments": assignments,
        "unassigned": unassigned_list,
        "unassigned_request_ids": [u["request_id"] for u in unassigned_list],
    }