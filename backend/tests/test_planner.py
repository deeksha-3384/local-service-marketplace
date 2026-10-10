import random
from decimal import Decimal

import pytest

from services.planner import plan_assignments


def req(rid, lat, lng, cat="plumbing", sev=50):
    return {"id": rid, "category": cat, "lat": lat, "lng": lng, "severity_score": sev}


def prov(pid, lat, lng, cats=("plumbing",), radius=20, rating=4.0):
    return {
        "id": pid,
        "categories": list(cats),
        "lat": lat,
        "lng": lng,
        "service_radius_km": radius,
        "rating": rating,
    }


def pairs(result):
    return {a["request_id"]: a["provider_id"] for a in result["assignments"]}


def reasons(result):
    return {u["request_id"]: u["reason"] for u in result["unassigned"]}


def test_nearest_provider_is_chosen():
    result = plan_assignments(
        [req("R1", 12.90, 77.50)],
        [prov("near", 12.91, 77.50), prov("far", 12.99, 77.50)],
    )
    assert pairs(result) == {"R1": "near"}
    assert result["unassigned_request_ids"] == []


def test_solver_maximises_number_of_requests_served():
    # A greedy "nearest first" approach would give R1 -> P1 and strand R2.
    # R2 can only be served by P1, so the optimum is R1 -> P2 and R2 -> P1.
    requests = [
        req("R1", 12.90, 77.50, cat="plumbing"),
        req("R2", 12.91, 77.50, cat="electrical"),
    ]
    providers = [
        prov("P1", 12.90, 77.50, cats=("plumbing", "electrical")),
        prov("P2", 12.95, 77.50, cats=("plumbing",)),
    ]
    result = plan_assignments(requests, providers)
    assert pairs(result) == {"R1": "P2", "R2": "P1"}
    assert result["unassigned"] == []


def test_category_mismatch_is_unassigned():
    result = plan_assignments(
        [req("R1", 12.90, 77.50, cat="electrical")], [prov("P1", 12.90, 77.50)]
    )
    assert result["assignments"] == []
    assert reasons(result) == {"R1": "no_provider_in_range"}


def test_request_outside_radius_is_unassigned():
    # about 5.5 km away, provider radius 2 km
    result = plan_assignments([req("R1", 12.95, 77.50)], [prov("P1", 12.90, 77.50, radius=2)])
    assert reasons(result) == {"R1": "no_provider_in_range"}


def test_zero_radius_provider_is_never_matched():
    result = plan_assignments([req("R1", 12.90, 77.50)], [prov("P1", 12.90, 77.50, radius=0)])
    assert result["assignments"] == []


def test_scarcity_serves_the_more_severe_request():
    requests = [
        req("high", 12.927, 77.50, sev=90),  # about 3 km away
        req("low", 12.909, 77.50, sev=20),   # about 1 km away
    ]
    result = plan_assignments(requests, [prov("P1", 12.90, 77.50)])
    assert pairs(result) == {"high": "P1"}
    assert reasons(result) == {"low": "no_capacity"}


def test_each_provider_gets_at_most_one_request():
    requests = [req(f"R{i}", 12.90, 77.50) for i in range(3)]
    result = plan_assignments(requests, [prov("P1", 12.90, 77.50)])
    assert len(result["assignments"]) == 1
    assert set(reasons(result).values()) == {"no_capacity"}
    assert len(result["unassigned_request_ids"]) == 2


def test_higher_rating_wins_a_distance_tie():
    # 0.01 degrees north and south of the request are exactly equidistant
    result = plan_assignments(
        [req("R1", 12.90, 77.50)],
        [prov("north_low", 12.91, 77.50, rating=3.0), prov("south_high", 12.89, 77.50, rating=5.0)],
    )
    assert pairs(result) == {"R1": "south_high"}


def test_request_without_location_is_reported():
    bad = {"id": "R1", "category": "plumbing", "lat": None, "lng": None, "severity_score": 50}
    good = req("R2", 12.90, 77.50)
    result = plan_assignments([bad, good], [prov("P1", 12.90, 77.50)])
    assert pairs(result) == {"R2": "P1"}
    assert reasons(result) == {"R1": "missing_location"}


def test_no_providers_and_no_requests():
    assert plan_assignments([req("R1", 12.9, 77.5)], [])["unassigned"] == [
        {"request_id": "R1", "reason": "no_planner_providers"}
    ]
    empty = plan_assignments([], [prov("P1", 12.9, 77.5)])
    assert empty == {"assignments": [], "unassigned": [], "unassigned_request_ids": []}


def test_decimal_inputs_from_the_database_are_accepted():
    requests = [req("R1", Decimal("12.90"), Decimal("77.50"), sev=Decimal("80"))]
    providers = [prov("P1", Decimal("12.91"), Decimal("77.50"), radius=Decimal("10"), rating=Decimal("4.5"))]
    assert pairs(plan_assignments(requests, providers)) == {"R1": "P1"}


def test_output_fields_and_ranges():
    result = plan_assignments([req("R1", 12.91, 77.50)], [prov("P1", 12.90, 77.50, radius=10)])
    a = result["assignments"][0]
    assert set(a) == {"request_id", "provider_id", "distance_km", "score"}
    assert 0 <= a["score"] <= 100
    assert a["distance_km"] == pytest.approx(1.11, abs=0.02)


def test_result_does_not_depend_on_input_order():
    requests = [req(f"R{i}", 12.90 + i * 0.004, 77.50, sev=10 * i) for i in range(6)]
    providers = [prov(f"P{i}", 12.90 + i * 0.006, 77.51, rating=3 + i * 0.3) for i in range(4)]
    baseline = plan_assignments(requests, providers)
    for seed in range(5):
        rnd = random.Random(seed)
        shuffled_r, shuffled_p = requests[:], providers[:]
        rnd.shuffle(shuffled_r)
        rnd.shuffle(shuffled_p)
        assert plan_assignments(shuffled_r, shuffled_p) == baseline


def test_oversized_problem_is_rejected():
    requests = [req(f"R{i}", 12.9, 77.5) for i in range(600)]
    providers = [prov(f"P{i}", 12.9, 77.5) for i in range(600)]
    with pytest.raises(ValueError):
        plan_assignments(requests, providers)