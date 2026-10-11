from types import SimpleNamespace

import pytest

from services.booking_queries import format_booking, phone_visible

ROW = {
    "id": "b1", "request_id": "r1", "offer_id": None, "customer_id": "cust-1", "provider_id": "prov-1",
    "slot_start": "s", "slot_end": "e", "status": "confirmed", "created_at": "c",
    "request_title": "t", "request_category": "plumbing", "request_meter_level": "low",
    "request_address": "a", "request_lat": 1.0, "request_lng": 2.0,
    "customer_name": "C", "provider_name": "P", "provider_phone": "+91 98765 43210",
}


def who(role, uid):
    return SimpleNamespace(role=role, id=uid)


@pytest.mark.parametrize(
    "viewer,status,visible",
    [
        (who("customer", "cust-1"), "confirmed", True),
        (who("customer", "cust-1"), "in_progress", True),
        (who("admin", "adm"), "confirmed", True),
        (who("customer", "cust-1"), "completed", False),
        (who("customer", "cust-1"), "cancelled", False),
        (who("customer", "someone-else"), "confirmed", False),
        (who("provider", "prov-1"), "confirmed", False),
        (who("provider", "prov-2"), "confirmed", False),
        (None, "confirmed", False),
    ],
)
def test_phone_visibility(viewer, status, visible):
    assert phone_visible(status, "cust-1", viewer) is visible
    shown = format_booking({**ROW, "status": status}, viewer)["provider_phone"]
    assert (shown == "+91 98765 43210") is visible
    if not visible:
        assert shown is None