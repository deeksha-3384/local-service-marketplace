from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request
from pydantic import AwareDatetime, Field
from sqlalchemy.exc import IntegrityError

from auth import current_user, require_auth
from db_utils import commit, fetch_all, fetch_one, haversine_sql, run, sqlstate
from errors import ApiError
from extensions import db
from pagination import paginated, parse_pagination
from query_utils import parse_choice
from services.access import forbidden, get_request, mask_for_provider
from services.booking_queries import format_booking, get_booking
from services.events import add_event
from validation import Schema, parse_body

bp = Blueprint("provider", __name__)

ASSIGNMENT_STATUSES = {"proposed", "confirmed", "declined"}

ASSIGNMENT_FROM = """
FROM planner_assignments a
JOIN planner_runs pr ON pr.id = a.run_id
JOIN requests r ON r.id = a.request_id
"""
ASSIGNMENT_COLUMNS = """
a.id, a.run_id, a.request_id, a.provider_id, a.distance_km, a.score, a.status::text AS status,
r.title AS r_title, r.category AS r_category, r.description AS r_description,
r.language AS r_language, r.severity_score AS r_severity, r.meter_level::text AS r_meter,
r.status::text AS r_status, r.lat AS r_lat, r.lng AS r_lng, r.address AS r_address,
r.booked_provider_id AS r_booked, r.created_at AS r_created_at
"""


class AcceptBody(Schema):
    start: AwareDatetime | None = None
    duration_minutes: int | None = Field(default=None, ge=15, le=720)


def _optional_body(model):
    if not request.get_data(cache=True).strip():
        return model()
    return parse_body(model)


def _format_assignment(row, user):
    req = mask_for_provider(
        {
            "id": row["request_id"], "title": row["r_title"], "category": row["r_category"],
            "description": row["r_description"], "language": row["r_language"],
            "severity_score": row["r_severity"], "meter_level": row["r_meter"],
            "status": row["r_status"], "lat": row["r_lat"], "lng": row["r_lng"],
            "address": row["r_address"], "booked_provider_id": row["r_booked"],
            "created_at": row["r_created_at"],
        },
        user,
    )
    req.pop("booked_provider_id", None)
    distance = row["distance_km"]
    return {
        "id": row["id"], "run_id": row["run_id"], "request_id": row["request_id"],
        "provider_id": row["provider_id"],
        "distance_km": round(distance, 2) if distance is not None else None,
        "score": row["score"], "status": row["status"], "request": req,
    }


def _estimated_minutes(req):
    diagnosis = req.get("diagnosis")
    minutes = diagnosis.get("estimated_duration_minutes") if isinstance(diagnosis, dict) else None
    try:
        minutes = int(minutes)
    except (TypeError, ValueError):
        return 60
    return min(max(minutes, 15), 480)


def _locked_assignment(assignment_id, user):
    """Lock the request first, then the assignment (same order everywhere)."""
    pre = fetch_one("SELECT request_id FROM planner_assignments WHERE id = :id", {"id": assignment_id})
    if pre is None:
        raise ApiError(404, "NOT_FOUND", "Assignment not found.")
    req = get_request(pre["request_id"], lock=True)
    a = fetch_one(
        "SELECT a.id, a.request_id, a.provider_id, a.status::text AS status, pr.status AS run_status "
        "FROM planner_assignments a JOIN planner_runs pr ON pr.id = a.run_id "
        "WHERE a.id = :id FOR UPDATE OF a",
        {"id": assignment_id},
    )
    if a is None or a["run_status"] != "confirmed":
        raise ApiError(404, "NOT_FOUND", "Assignment not found.")
    if str(a["provider_id"]) != user.id:
        raise forbidden()
    if a["status"] != "proposed":
        raise ApiError(409, "INVALID_STATE", f"This assignment is already {a['status']}.")
    return a, req


@bp.get("/provider/assignments")
@require_auth("provider")
def list_assignments():
    user = current_user()
    page, limit, offset = parse_pagination()
    status = parse_choice("status", ASSIGNMENT_STATUSES) or "proposed"
    params = {"uid": user.id, "status": status}
    where = "a.provider_id = :uid AND pr.status = 'confirmed' AND a.status = CAST(:status AS assignment_status)"
    total = fetch_one(f"SELECT count(*) AS n {ASSIGNMENT_FROM} WHERE {where}", params)["n"]
    rows = fetch_all(
        f"SELECT {ASSIGNMENT_COLUMNS} {ASSIGNMENT_FROM} WHERE {where} "
        "ORDER BY a.score DESC NULLS LAST, a.id LIMIT :limit OFFSET :offset",
        {**params, "limit": limit, "offset": offset},
    )
    return jsonify(paginated([_format_assignment(r, user) for r in rows], page, limit, total))


@bp.post("/provider/assignments/<uuid:assignment_id>/accept")
@require_auth("provider")
def accept_assignment(assignment_id):
    user = current_user()
    a, req = _locked_assignment(assignment_id, user)
    if req["status"] not in ("open", "offers_received"):
        raise ApiError(409, "INVALID_STATE", "This request is no longer open.")

    body = _optional_body(AcceptBody)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    start = body.start or now
    if start < now - timedelta(minutes=5) or start > now + timedelta(days=30):
        raise ApiError(422, "VALIDATION_ERROR", "Invalid start time.",
                       [{"field": "start", "message": "must be within the next 30 days"}])
    end = start + timedelta(minutes=body.duration_minutes or _estimated_minutes(req))

    try:
        booking = fetch_one(
            "INSERT INTO bookings (request_id, offer_id, customer_id, provider_id, slot, status) "
            "VALUES (:rid, NULL, :cid, :pid, tstzrange(:start, :end, '[)'), 'confirmed') RETURNING id",
            {"rid": req["id"], "cid": req["customer_id"], "pid": user.id, "start": start, "end": end},
        )
    except IntegrityError as exc:
        db.session.rollback()
        state = sqlstate(exc)
        if state == "23P01":
            raise ApiError(409, "SLOT_CONFLICT", "You already have a booking at that time.")
        if state == "23505":
            raise ApiError(409, "INVALID_STATE", "This request already has an active booking.")
        raise

    run("UPDATE planner_assignments SET status = 'confirmed' WHERE id = :id", {"id": assignment_id})
    run("UPDATE planner_assignments SET status = 'declined' WHERE request_id = :rid AND status = 'proposed' AND id <> :id",
        {"rid": req["id"], "id": assignment_id})
    rejected = fetch_all(
        "UPDATE offers SET status = 'rejected' WHERE request_id = :rid AND status = 'pending' RETURNING id, provider_id",
        {"rid": req["id"]},
    )
    run("UPDATE requests SET status = 'booked', booked_provider_id = :pid, updated_at = now() WHERE id = :rid",
        {"pid": user.id, "rid": req["id"]})
    for item in rejected:
        add_event(req["id"], "offer.rejected", user.id, {"offer_id": item["id"], "provider_id": item["provider_id"]})
    add_event(req["id"], "booking.created", user.id,
              {"booking_id": booking["id"], "provider_id": user.id, "via": "planner"})
    add_event(req["id"], "request.status_changed", user.id, {"from": req["status"], "to": "booked"})
    commit()
    return jsonify(format_booking(get_booking(booking["id"]))), 201


@bp.post("/provider/assignments/<uuid:assignment_id>/decline")
@require_auth("provider")
def decline_assignment(assignment_id):
    user = current_user()
    a, req = _locked_assignment(assignment_id, user)
    run("UPDATE planner_assignments SET status = 'declined' WHERE id = :id", {"id": assignment_id})
    add_event(req["id"], "planner.declined", user.id, {"assignment_id": assignment_id, "provider_id": user.id})
    commit()
    return jsonify({"id": assignment_id, "request_id": req["id"], "status": "declined"})


@bp.get("/provider/dashboard")
@require_auth("provider")
def provider_dashboard():
    user = current_user()
    distance = haversine_sql("r.lat", "r.lng", "pp.lat", "pp.lng")
    row = fetch_one(
        f"""
        SELECT pp.rating, pp.rating_count, pp.mode::text AS mode,
          (SELECT count(*) FROM requests r
            WHERE r.status IN ('open', 'offers_received') AND r.category = ANY(pp.categories)
              AND pp.lat IS NOT NULL AND pp.lng IS NOT NULL
              AND {distance} <= pp.service_radius_km) AS open_nearby,
          (SELECT count(*) FROM offers o WHERE o.provider_id = pp.user_id AND o.status = 'pending') AS pending_offers,
          (SELECT count(*) FROM bookings b WHERE b.provider_id = pp.user_id
              AND b.status IN ('confirmed', 'in_progress') AND upper(b.slot) > now()) AS upcoming_bookings,
          (SELECT count(*) FROM planner_assignments a JOIN planner_runs pr ON pr.id = a.run_id
            WHERE a.provider_id = pp.user_id AND a.status = 'proposed' AND pr.status = 'confirmed') AS pending_assignments
        FROM provider_profiles pp WHERE pp.user_id = :uid
        """,
        {"uid": user.id},
    )
    if row is None:
        row = {"rating": 0, "rating_count": 0, "mode": "independent", "open_nearby": 0,
               "pending_offers": 0, "upcoming_bookings": 0, "pending_assignments": 0}
    return jsonify(row)


@bp.get("/providers/<uuid:provider_id>")
@require_auth()
def public_provider(provider_id):
    row = fetch_one(
        "SELECT p.id, p.full_name, pp.categories, pp.languages, pp.service_radius_km, pp.rating, pp.rating_count, "
        "pp.is_verified, pp.bio FROM profiles p JOIN provider_profiles pp ON pp.user_id = p.id "
        "WHERE p.id = :id AND p.role = 'provider' AND p.is_active",
        {"id": provider_id},
    )
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Provider not found.")
    return jsonify(row)