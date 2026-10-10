from flask import Blueprint, jsonify

from auth import current_user, require_auth
from db_utils import commit, fetch_one, run
from errors import ApiError
from services.access import forbidden, get_request
from services.events import add_event

bp = Blueprint("request_delete", __name__)

MIN_NOTICE_MINUTES = 20


@bp.post("/requests/<uuid:request_id>/delete")
@require_auth("customer")
def delete_request(request_id):
    user = current_user()
    req = get_request(request_id, lock=True)
    if req is None:
        raise ApiError(404, "NOT_FOUND", "Request not found.")
    if str(req["customer_id"]) != user.id:
        raise forbidden()

    status = req["status"]
    if status == "cancelled":
        raise ApiError(409, "INVALID_STATE", "This request is already deleted.")
    if status in ("in_progress", "completed"):
        raise ApiError(409, "INVALID_STATE", "Work has already started or finished, so this request can no longer be deleted.")

    booking = fetch_one(
        "SELECT id, provider_id, status::text AS status, "
        "EXTRACT(EPOCH FROM (lower(slot) - now())) / 60 AS minutes_to_start "
        "FROM bookings WHERE request_id = :rid AND status IN ('confirmed', 'in_progress') FOR UPDATE",
        {"rid": request_id},
    )
    if booking is not None:
        if booking["status"] == "in_progress":
            raise ApiError(409, "INVALID_STATE", "The provider has already started work, so this request can no longer be deleted.")
        minutes = float(booking["minutes_to_start"])
        if minutes < MIN_NOTICE_MINUTES:
            raise ApiError(
                409, "TOO_LATE",
                "This job starts in less than 20 minutes, so it can no longer be deleted. Please contact the provider.",
                {"minutes_to_start": max(0, int(minutes))},
            )
        run("UPDATE bookings SET status = 'cancelled' WHERE id = :id", {"id": booking["id"]})

    run("UPDATE offers SET status = 'rejected' WHERE request_id = :rid AND status = 'pending'", {"rid": request_id})
    run("UPDATE planner_assignments SET status = 'declined' WHERE request_id = :rid AND status = 'proposed'", {"rid": request_id})
    run("UPDATE requests SET status = 'cancelled', booked_provider_id = NULL, updated_at = now() WHERE id = :rid", {"rid": request_id})

    title_row = fetch_one("SELECT title FROM requests WHERE id = :id", {"id": request_id})
    add_event(request_id, "request.cancelled", user.id, {
        "by": "customer",
        "title": title_row["title"] if title_row else None,
        "provider_id": booking["provider_id"] if booking else None,
        "booking_id": booking["id"] if booking else None,
    })
    add_event(request_id, "request.status_changed", user.id, {"from": status, "to": "cancelled"})
    commit()
    return jsonify({"id": request_id, "status": "cancelled", "provider_notified": booking is not None})