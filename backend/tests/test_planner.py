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



# ---------------------------------------------------------------- emergency mode

def test_emergency_off_is_unchanged_by_the_new_option():
    requests = [req("R1", 12.90, 77.50, sev=90), req("R2", 12.91, 77.50, sev=20)]
    providers = [prov("P1", 12.90, 77.50), prov("P2", 12.92, 77.50)]
    assert plan_assignments(requests, providers) == plan_assignments(requests, providers, emergency=False)


def test_emergency_gives_the_only_provider_to_the_urgent_request_even_if_far():
    # Normal mode: distance can outweigh severity, so the nearby minor job wins the lone provider.
    # Emergency mode: the critical request must win regardless of distance.
    requests = [
        req("critical", 13.35, 77.50, sev=75),  # about 50 km away
        req("minor", 12.901, 77.50, sev=45),    # about 0.1 km away, not urgent
    ]
    providers = [prov("P1", 12.90, 77.50, radius=100)]
    normal = plan_assignments(requests, providers)
    assert pairs(normal) == {"minor": "P1"}
    emergency = plan_assignments(requests, providers, emergency=True)
    assert pairs(emergency) == {"critical": "P1"}
    assert reasons(emergency) == {"minor": "deferred_for_urgent"}


def test_emergency_gives_standard_requests_only_the_leftover_providers():
    requests = [
        req("urgent", 12.90, 77.50, sev=80),
        req("standard", 12.95, 77.50, sev=30),
    ]
    providers = [prov("P1", 12.90, 77.50), prov("P2", 12.96, 77.50)]
    result = plan_assignments(requests, providers, emergency=True)
    assert pairs(result) == {"urgent": "P1", "standard": "P2"}
    assert result["unassigned"] == []


def test_emergency_reason_is_no_capacity_when_urgent_tier_did_not_take_the_provider():
    # Two standard requests compete for one provider; no urgent request exists.
    requests = [req("A", 12.90, 77.50, sev=30), req("B", 12.91, 77.50, sev=20)]
    result = plan_assignments(requests, [prov("P1", 12.90, 77.50)], emergency=True)
    assert len(result["assignments"]) == 1
    assert set(reasons(result).values()) == {"no_capacity"}


def test_emergency_keeps_no_provider_in_range_reason():
    requests = [req("urgent", 12.90, 77.50, sev=90, cat="electrical"), req("minor", 12.90, 77.50, sev=10)]
    result = plan_assignments(requests, [prov("P1", 12.90, 77.50)], emergency=True)
    assert pairs(result) == {"minor": "P1"}
    assert reasons(result) == {"urgent": "no_provider_in_range"}


def test_emergency_unknown_severity_is_not_urgent():
    unknown = {"id": "U", "category": "plumbing", "lat": 12.90, "lng": 77.50, "severity_score": None}
    high = req("H", 12.99, 77.50, sev=60)
    result = plan_assignments([unknown, high], [prov("P1", 12.90, 77.50, radius=20)], emergency=True)
    assert pairs(result) == {"H": "P1"}
    assert reasons(result) == {"U": "deferred_for_urgent"}


def test_emergency_threshold_is_fifty():
    requests = [req("at50", 12.99, 77.50, sev=50), req("at49", 12.901, 77.50, sev=49)]
    result = plan_assignments(requests, [prov("P1", 12.90, 77.50, radius=20)], emergency=True)
    assert pairs(result) == {"at50": "P1"}


def test_emergency_still_maximises_urgent_requests_served():
    requests = [
        req("U1", 12.90, 77.50, cat="plumbing", sev=90),
        req("U2", 12.91, 77.50, cat="electrical", sev=80),
    ]
    providers = [
        prov("P1", 12.90, 77.50, cats=("plumbing", "electrical")),
        prov("P2", 12.95, 77.50, cats=("plumbing",)),
    ]
    result = plan_assignments(requests, providers, emergency=True)
    assert pairs(result) == {"U1": "P2", "U2": "P1"}


def test_emergency_result_does_not_depend_on_input_order():
    requests = [req(f"R{i}", 12.90 + i * 0.004, 77.50, sev=15 * i) for i in range(7)]
    providers = [prov(f"P{i}", 12.90 + i * 0.006, 77.51, rating=3 + i * 0.3) for i in range(3)]
    baseline = plan_assignments(requests, providers, emergency=True)
    for seed in range(5):
        rnd = random.Random(seed)
        shuffled_r, shuffled_p = requests[:], providers[:]
        rnd.shuffle(shuffled_r)
        rnd.shuffle(shuffled_p)
        assert plan_assignments(shuffled_r, shuffled_p, emergency=True) == baseline


def test_emergency_output_fields_are_unchanged():
    result = plan_assignments([req("R1", 12.91, 77.50, sev=90)], [prov("P1", 12.90, 77.50, radius=10)], emergency=True)
    assert set(result["assignments"][0]) == {"request_id", "provider_id", "distance_km", "score"}


def test_emergency_oversized_problem_is_still_rejected():
    requests = [req(f"R{i}", 12.9, 77.5, sev=90) for i in range(600)]
    providers = [prov(f"P{i}", 12.9, 77.5) for i in range(600)]
    with pytest.raises(ValueError):
        plan_assignments(requests, providers, emergency=True)