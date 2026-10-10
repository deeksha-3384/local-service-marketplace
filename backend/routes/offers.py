from datetime import datetime, timedelta, timezone
from decimal import Decimal

from flask import Blueprint, current_app, jsonify
from pydantic import AwareDatetime, Field, model_validator
from sqlalchemy.exc import IntegrityError

from auth import current_user, require_auth
from db_utils import commit, fetch_all, fetch_one, haversine_sql, run, sqlstate
from errors import ApiError
from extensions import db
from pagination import paginated, parse_pagination, parse_sort
from query_utils import parse_float
from services.access import ensure_request_access, forbidden, get_request
from services.booking_queries import format_booking, get_booking
from services.events import add_event
from validation import Schema, parse_body

bp = Blueprint("offers", __name__)

OFFER_COLUMNS = (
    "o.id, o.request_id, o.provider_id, o.price, o.currency, o.eta_minutes, o.message, "
    "o.proposed_start, o.proposed_end, o.status::text AS status, o.created_at"
)
OFFER_SORTS = {"price": "price", "eta_minutes": "eta_minutes", "rating": "rating", "distance": "distance_km"}


class OfferCreate(Schema):
    price: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    eta_minutes: int = Field(gt=0, le=10080)
    message: str | None = Field(default=None, max_length=500)
    proposed_start: AwareDatetime
    proposed_end: AwareDatetime

    @model_validator(mode="after")
    def _window(self):
        if self.proposed_end <= self.proposed_start:
            raise ValueError("proposed_end must be after proposed_start")
        if self.proposed_end - self.proposed_start > timedelta(days=7):
            raise ValueError("the proposed window can be at most 7 days")
        if self.proposed_start < datetime.now(timezone.utc) - timedelta(minutes=5):
            raise ValueError("proposed_start cannot be in the past")
        return self


def fetch_offer(offer_id):
    return fetch_one(f"SELECT {OFFER_COLUMNS} FROM offers o WHERE o.id = :id", {"id": offer_id})


def _load_locked(offer_id):
    """Always lock the request first, then the offer, so concurrent actions cannot deadlock."""
    pre = fetch_one("SELECT request_id FROM offers WHERE id = :id", {"id": offer_id})
    if pre is None:
        raise ApiError(404, "NOT_FOUND", "Offer not found.")
    req = get_request(pre["request_id"], lock=True)
    offer = fetch_one(f"SELECT {OFFER_COLUMNS} FROM offers o WHERE o.id = :id FOR UPDATE", {"id": offer_id})
    if offer is None:
        raise ApiError(404, "NOT_FOUND", "Offer not found.")
    return offer, req


def _reopen_if_idle(req, actor_id):
    if req["status"] != "offers_received":
        return
    pending = fetch_one(
        "SELECT count(*) AS n FROM offers WHERE request_id = :rid AND status = 'pending'",
        {"rid": req["id"]},
    )["n"]
    if pending == 0:
        run("UPDATE requests SET status = 'open', updated_at = now() WHERE id = :rid", {"rid": req["id"]})
        add_event(req["id"], "request.status_changed", actor_id, {"from": "offers_received", "to": "open"})


@bp.post("/requests/<uuid:request_id>/offers")
@require_auth("provider")
def create_offer(request_id):
    user = current_user()
    body = parse_body(OfferCreate)
    profile = fetch_one(
        "SELECT mode::text AS mode, categories FROM provider_profiles WHERE user_id = :uid",
        {"uid": user.id},
    )
    if profile is None:
        raise forbidden("Complete your provider profile before sending offers.")
    if profile["mode"] != "independent":
        raise forbidden("Switch to independent mode to send offers.")

    req = get_request(request_id, lock=True)
    if req["status"] not in ("open", "offers_received"):
        raise ApiError(409, "INVALID_STATE", "This request is no longer accepting offers.")
    if req["category"] not in profile["categories"]:
        raise forbidden("This request is outside your service categories.")
    if fetch_one(
        "SELECT 1 AS x FROM offers WHERE request_id = :rid AND provider_id = :uid AND status IN ('pending', 'accepted')",
        {"rid": request_id, "uid": user.id},
    ):
        raise ApiError(409, "CONFLICT", "You already have an active offer on this request.")

    try:
        row = fetch_one(
            """
            INSERT INTO offers (request_id, provider_id, price, currency, eta_minutes, message,
                                proposed_start, proposed_end, status)
            VALUES (:rid, :pid, :price, :currency, :eta, :message, :start, :end, 'pending')
            RETURNING id
            """,
            {
                "rid": request_id, "pid": user.id, "price": body.price,
                "currency": current_app.config["DEFAULT_CURRENCY"], "eta": body.eta_minutes,
                "message": body.message, "start": body.proposed_start, "end": body.proposed_end,
            },
        )
    except IntegrityError as exc:
        db.session.rollback()
        if sqlstate(exc) == "23505":
            raise ApiError(409, "CONFLICT", "You already have an active offer on this request.")
        raise

    add_event(request_id, "offer.created", user.id,
              {"offer_id": row["id"], "provider_id": user.id, "price": float(body.price),
               "eta_minutes": body.eta_minutes})
    if req["status"] == "open":
        run("UPDATE requests SET status = 'offers_received', updated_at = now() WHERE id = :rid", {"rid": request_id})
        add_event(request_id, "request.status_changed", user.id, {"from": "open", "to": "offers_received"})
    commit()
    return jsonify(fetch_offer(row["id"])), 201


@bp.get("/requests/<uuid:request_id>/offers")
@require_auth("customer", "admin")
def list_offers(request_id):
    user = current_user()
    ensure_request_access(user, request_id)
    page, limit, offset = parse_pagination()
    sort, order = parse_sort(set(OFFER_SORTS), "price", "asc")
    max_price = parse_float("max_price", 0)
    min_rating = parse_float("min_rating", 0, 5)
    max_eta = parse_float("max_eta", 0)

    params = {"rid": request_id}
    where = ["o.request_id = :rid", "o.status IN ('pending', 'accepted')"]
    if max_price is not None:
        where.append("o.price <= :max_price")
        params["max_price"] = max_price
    if min_rating is not None:
        where.append("COALESCE(pp.rating, 0) >= :min_rating")
        params["min_rating"] = min_rating
    if max_eta is not None:
        where.append("o.eta_minutes <= :max_eta")
        params["max_eta"] = max_eta

    distance = haversine_sql("r.lat", "r.lng", "pp.lat", "pp.lng")
    cte = f"""
        WITH base AS (
            SELECT {OFFER_COLUMNS},
                   p.full_name AS provider_name, pp.rating, pp.rating_count, pp.is_verified,
                   CASE WHEN pp.lat IS NULL OR pp.lng IS NULL THEN NULL ELSE {distance} END AS distance_km
            FROM offers o
            JOIN requests r ON r.id = o.request_id
            JOIN profiles p ON p.id = o.provider_id
            LEFT JOIN provider_profiles pp ON pp.user_id = o.provider_id
            WHERE {' AND '.join(where)}
        )
    """
    total = fetch_one(cte + " SELECT count(*) AS n FROM base", params)["n"]
    rows = fetch_all(
        cte + f" SELECT * FROM base ORDER BY {OFFER_SORTS[sort]} {order} NULLS LAST, created_at, id "
        "LIMIT :limit OFFSET :offset",
        {**params, "limit": limit, "offset": offset},
    )
    items = []
    for row in rows:
        distance_km = row.pop("distance_km")
        row["provider"] = {
            "id": row["provider_id"],
            "full_name": row.pop("provider_name"),
            "rating": row.pop("rating"),
            "rating_count": row.pop("rating_count"),
            "is_verified": row.pop("is_verified"),
            "distance_km": round(distance_km, 2) if distance_km is not None else None,
        }
        items.append(row)
    return jsonify(paginated(items, page, limit, total))


@bp.post("/offers/<uuid:offer_id>/withdraw")
@require_auth("provider")
def withdraw_offer(offer_id):
    user = current_user()
    offer, req = _load_locked(offer_id)
    if str(offer["provider_id"]) != user.id:
        raise forbidden()
    if offer["status"] != "pending":
        raise ApiError(409, "INVALID_STATE", f"A {offer['status']} offer cannot be withdrawn.")
    run("UPDATE offers SET status = 'withdrawn' WHERE id = :id", {"id": offer_id})
    add_event(req["id"], "offer.withdrawn", user.id, {"offer_id": offer_id, "provider_id": user.id})
    _reopen_if_idle(req, user.id)
    commit()
    return jsonify(fetch_offer(offer_id))


@bp.post("/offers/<uuid:offer_id>/reject")
@require_auth("customer")
def reject_offer(offer_id):
    user = current_user()
    offer, req = _load_locked(offer_id)
    if str(req["customer_id"]) != user.id:
        raise forbidden()
    if offer["status"] != "pending":
        raise ApiError(409, "INVALID_STATE", f"A {offer['status']} offer cannot be rejected.")
    run("UPDATE offers SET status = 'rejected' WHERE id = :id", {"id": offer_id})
    add_event(req["id"], "offer.rejected", user.id, {"offer_id": offer_id, "provider_id": offer["provider_id"]})
    _reopen_if_idle(req, user.id)
    commit()
    return jsonify(fetch_offer(offer_id))


@bp.post("/offers/<uuid:offer_id>/accept")
@require_auth("customer")
def accept_offer(offer_id):
    user = current_user()
    offer, req = _load_locked(offer_id)
    if str(req["customer_id"]) != user.id:
        raise forbidden()
    if offer["status"] != "pending":
        raise ApiError(409, "INVALID_STATE", f"A {offer['status']} offer cannot be accepted.")
    if req["status"] not in ("open", "offers_received"):
        raise ApiError(409, "INVALID_STATE", "This request is no longer open for booking.")
    if offer["proposed_end"] <= datetime.now(timezone.utc):
        raise ApiError(409, "INVALID_STATE", "This offer has expired. Ask the provider for a new one.")

    try:
        booking = fetch_one(
            """
            INSERT INTO bookings (request_id, offer_id, customer_id, provider_id, slot, status)
            VALUES (:rid, :oid, :cid, :pid, tstzrange(:start, :end, '[)'), 'confirmed')
            RETURNING id
            """,
            {
                "rid": req["id"], "oid": offer_id, "cid": user.id, "pid": offer["provider_id"],
                "start": offer["proposed_start"], "end": offer["proposed_end"],
            },
        )
    except IntegrityError as exc:
        db.session.rollback()
        state = sqlstate(exc)
        if state == "23P01":
            raise ApiError(409, "SLOT_CONFLICT",
                           "This provider is already booked for that time. Please choose another offer.")
        if state == "23505":
            raise ApiError(409, "INVALID_STATE", "This request already has an active booking.")
        raise

    run("UPDATE offers SET status = 'accepted' WHERE id = :id", {"id": offer_id})
    rejected = fetch_all(
        "UPDATE offers SET status = 'rejected' WHERE request_id = :rid AND status = 'pending' AND id <> :oid "
        "RETURNING id, provider_id",
        {"rid": req["id"], "oid": offer_id},
    )
    run(
        "UPDATE requests SET status = 'booked', booked_provider_id = :pid, updated_at = now() WHERE id = :rid",
        {"pid": offer["provider_id"], "rid": req["id"]},
    )
    run("UPDATE planner_assignments SET status = 'declined' WHERE request_id = :rid AND status = 'proposed'",
        {"rid": req["id"]})

    add_event(req["id"], "offer.accepted", user.id, {"offer_id": offer_id, "provider_id": offer["provider_id"]})
    for item in rejected:
        add_event(req["id"], "offer.rejected", user.id, {"offer_id": item["id"], "provider_id": item["provider_id"]})
    add_event(req["id"], "booking.created", user.id,
              {"booking_id": booking["id"], "provider_id": offer["provider_id"]})
    add_event(req["id"], "request.status_changed", user.id, {"from": req["status"], "to": "booked"})
    commit()
    return jsonify(format_booking(get_booking(booking["id"]))), 201