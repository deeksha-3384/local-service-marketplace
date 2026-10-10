from typing import Literal

from flask import Blueprint, jsonify

from auth import current_user, require_auth
from db_utils import commit, fetch_all, fetch_one, run
from errors import ApiError
from pagination import paginated, parse_pagination, parse_sort
from query_utils import parse_choice
from services.access import forbidden, get_request
from services.booking_queries import BOOKING_SELECT, format_booking, get_booking
from services.events import add_event
from validation import Schema, parse_body

bp = Blueprint("bookings", __name__)

BOOKING_STATUSES = {"confirmed", "in_progress", "completed", "cancelled"}
SORT_COLUMNS = {"created_at": "b.created_at", "slot_start": "lower(b.slot)"}
TRANSITIONS = {"confirmed": {"in_progress", "cancelled"}, "in_progress": {"completed", "cancelled"}}


class StatusUpdate(Schema):
    status: Literal["in_progress", "completed", "cancelled"]


def _involved(user, row):
    return (
        user.role == "admin"
        or (user.role == "customer" and str(row["customer_id"]) == user.id)
        or (user.role == "provider" and str(row["provider_id"]) == user.id)
    )


@bp.get("/bookings")
@require_auth()
def list_bookings():
    user = current_user()
    page, limit, offset = parse_pagination()
    status = parse_choice("status", BOOKING_STATUSES)
    sort, order = parse_sort(set(SORT_COLUMNS), "created_at")

    params = {}
    where = ["TRUE"]
    if user.role == "customer":
        where.append("b.customer_id = :uid")
        params["uid"] = user.id
    elif user.role == "provider":
        where.append("b.provider_id = :uid")
        params["uid"] = user.id
    if status:
        where.append("b.status = :status")
        params["status"] = status

    clause = " AND ".join(where)
    total = fetch_one(f"SELECT count(*) AS n FROM bookings b WHERE {clause}", params)["n"]
    rows = fetch_all(
        BOOKING_SELECT + f" WHERE {clause} ORDER BY {SORT_COLUMNS[sort]} {order}, b.id LIMIT :limit OFFSET :offset",
        {**params, "limit": limit, "offset": offset},
    )
    return jsonify(paginated([format_booking(r) for r in rows], page, limit, total))


@bp.get("/bookings/<uuid:booking_id>")
@require_auth()
def get_booking_detail(booking_id):
    user = current_user()
    row = get_booking(booking_id)
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Booking not found.")
    if not _involved(user, row):
        raise forbidden()
    return jsonify(format_booking(row))


@bp.post("/bookings/<uuid:booking_id>/status")
@require_auth("provider", "customer", "admin")
def update_booking_status(booking_id):
    user = current_user()
    body = parse_body(StatusUpdate)
    new = body.status

    pre = fetch_one("SELECT request_id FROM bookings WHERE id = :id", {"id": booking_id})
    if pre is None:
        raise ApiError(404, "NOT_FOUND", "Booking not found.")
    req = get_request(pre["request_id"], lock=True)  # request first, then booking (consistent lock order)
    booking = fetch_one(
        "SELECT id, request_id, offer_id, customer_id, provider_id, status::text AS status "
        "FROM bookings WHERE id = :id FOR UPDATE",
        {"id": booking_id},
    )
    if booking is None:
        raise ApiError(404, "NOT_FOUND", "Booking not found.")
    if not _involved(user, booking):
        raise forbidden()
    if user.role == "customer" and new != "cancelled":
        raise forbidden("Customers can only cancel a booking.")
    if new not in TRANSITIONS.get(booking["status"], set()):
        raise ApiError(409, "INVALID_STATE", f"A {booking['status']} booking cannot move to {new}.")
    if user.role == "customer" and booking["status"] != "confirmed":
        raise ApiError(409, "INVALID_STATE", "You can no longer cancel once the work has started.")

    run("UPDATE bookings SET status = CAST(:s AS booking_status) WHERE id = :id", {"s": new, "id": booking_id})
    add_event(req["id"], "booking.status_changed", user.id,
              {"booking_id": booking_id, "provider_id": booking["provider_id"], "from": booking["status"], "to": new})

    if new in ("in_progress", "completed"):
        run("UPDATE requests SET status = CAST(:s AS request_status), updated_at = now() WHERE id = :rid",
            {"s": new, "rid": req["id"]})
        add_event(req["id"], "request.status_changed", user.id, {"from": req["status"], "to": new})
    else:
        if booking["offer_id"] is not None:
            run("UPDATE offers SET status = 'withdrawn' WHERE id = :oid AND status = 'accepted'",
                {"oid": booking["offer_id"]})
        if user.role == "customer":
            run("UPDATE requests SET status = 'cancelled', booked_provider_id = NULL, updated_at = now() WHERE id = :rid",
                {"rid": req["id"]})
            add_event(req["id"], "request.cancelled", user.id, {"from": req["status"]})
        else:
            run("UPDATE requests SET status = 'open', booked_provider_id = NULL, updated_at = now() WHERE id = :rid",
                {"rid": req["id"]})
            add_event(req["id"], "request.status_changed", user.id, {"from": req["status"], "to": "open"})
    commit()
    return jsonify(format_booking(get_booking(booking_id)))