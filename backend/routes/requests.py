import json
from uuid import UUID

from flask import Blueprint, jsonify, request
from pydantic import Field, field_validator

from auth import current_user, require_auth
from db_utils import commit, fetch_all, fetch_one, haversine_sql, run
from errors import ApiError
from extensions import db
from pagination import paginated, parse_pagination, parse_sort
from query_utils import parse_choice, parse_float
from services import diagnosis as dg
from services import groq_client
from services.access import (
    PROVIDER_EVENT_FILTER,
    REQUEST_COLUMNS,
    ensure_request_access,
    forbidden,
    get_request,
    mask_for_provider,
)
from services.events import add_event
from validation import Schema, parse_body

bp = Blueprint("requests", __name__)

REQUEST_STATUSES = {"open", "offers_received", "booked", "in_progress", "completed", "cancelled"}
METER_LEVELS = {"low", "medium", "high", "critical"}
SORT_COLUMNS = {"created_at": "created_at", "severity_score": "severity_score", "distance": "distance_km"}


class RequestCreate(Schema):
    category: str
    title: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    transcript: str | None = Field(default=None, max_length=4000)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    address: str | None = Field(default=None, max_length=300)
    language: str | None = None
    media_ids: list[UUID] = Field(default_factory=list, max_length=5)
    diagnosis: dict | None = None

    @field_validator("category")
    @classmethod
    def _category(cls, v):
        v = v.lower()
        if v not in dg.CATEGORIES:
            raise ValueError("must be one of: " + ", ".join(dg.CATEGORIES))
        return v

    @field_validator("language")
    @classmethod
    def _language(cls, v):
        if v is None:
            return v
        code = dg.known_language(v)
        if code is None:
            raise ValueError("unsupported language")
        return code


def _decorate(req, user):
    rid = req["id"]
    media = fetch_all(
        "SELECT id, kind::text AS kind, mime, size_bytes, created_at "
        "FROM request_media WHERE request_id = :rid ORDER BY created_at",
        {"rid": rid},
    )
    for item in media:
        item["url"] = None  # signed URLs are added in the upload step
    req["media"] = media
    req["offer_count"] = fetch_one(
        "SELECT count(*) AS n FROM offers WHERE request_id = :rid AND status IN ('pending', 'accepted')",
        {"rid": rid},
    )["n"]
    booking = fetch_one(
        "SELECT id, provider_id, lower(slot) AS slot_start, upper(slot) AS slot_end, status::text AS status "
        "FROM bookings WHERE request_id = :rid AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 1",
        {"rid": rid},
    )
    if booking and user.role == "provider" and str(booking["provider_id"]) != user.id:
        booking = None
    req["booking"] = (
        {
            "id": booking["id"],
            "provider_id": booking["provider_id"],
            "status": booking["status"],
            "slot": {"start": booking["slot_start"], "end": booking["slot_end"]},
        }
        if booking
        else None
    )
    return mask_for_provider(req, user)


@bp.post("/requests")
@require_auth("customer")
def create_request():
    user = current_user()
    body = parse_body(RequestCreate)
    description = body.description or ""
    title = body.title or ""
    if not (title or description):
        raise ApiError(
            422, "VALIDATION_ERROR", "Provide a title or a description.",
            [{"field": "description", "message": "title or description is required"}],
        )
    if not title:
        title = description[:80].strip()
    language = dg.normalize_language(body.language or user.language)

    if body.diagnosis is not None:
        try:
            diagnosis = dg.clean_diagnosis(body.diagnosis, language)
        except ValueError:
            raise ApiError(
                422, "VALIDATION_ERROR", "The diagnosis object is invalid.",
                [{"field": "diagnosis", "message": "does not match the diagnosis format"}],
            )
    else:
        db.session.rollback()  # free the DB connection while the AI call runs
        try:
            diagnosis = groq_client.analyze_text(description or title, language).to_diagnosis(language)
        except groq_client.AIUnavailable:
            diagnosis = None  # the request is still created, just without a diagnosis

    media_ids = list(dict.fromkeys(body.media_ids))
    if media_ids:
        owned = fetch_all(
            "SELECT id FROM request_media WHERE id = ANY(CAST(:ids AS uuid[])) "
            "AND owner_id = :uid AND request_id IS NULL",
            {"ids": media_ids, "uid": user.id},
        )
        if len(owned) != len(media_ids):
            raise ApiError(
                422, "VALIDATION_ERROR", "One or more uploaded files are invalid or already used.",
                [{"field": "media_ids", "message": "unknown, not yours, or already attached"}],
            )

    row = fetch_one(
        """
        INSERT INTO requests
            (customer_id, category, title, description, transcript, language, lat, lng, address,
             status, severity_score, meter_level, diagnosis)
        VALUES
            (:cid, :category, :title, :description, :transcript, :language, :lat, :lng, :address,
             'open', :severity, CAST(:meter AS meter_level), CAST(:diagnosis AS jsonb))
        RETURNING id
        """,
        {
            "cid": user.id,
            "category": body.category,
            "title": title,
            "description": description,
            "transcript": body.transcript,
            "language": language,
            "lat": body.lat,
            "lng": body.lng,
            "address": body.address,
            "severity": diagnosis["severity_score"] if diagnosis else None,
            "meter": diagnosis["meter_level"] if diagnosis else None,
            "diagnosis": json.dumps(diagnosis) if diagnosis else None,
        },
    )
    rid = row["id"]
    if media_ids:
        run(
            "UPDATE request_media SET request_id = :rid WHERE id = ANY(CAST(:ids AS uuid[]))",
            {"rid": rid, "ids": media_ids},
        )
    add_event(rid, "request.created", user.id,
              {"category": body.category, "meter_level": diagnosis["meter_level"] if diagnosis else None})
    if diagnosis:
        add_event(rid, "diagnosis.ready", user.id,
                  {"severity_score": diagnosis["severity_score"], "meter_level": diagnosis["meter_level"]})
    commit()
    return jsonify(_decorate(get_request(rid), user)), 201


@bp.get("/requests")
@require_auth()
def list_requests():
    user = current_user()
    page, limit, offset = parse_pagination()
    status = parse_choice("status", REQUEST_STATUSES)
    category = parse_choice("category", set(dg.CATEGORIES))
    meter = parse_choice("meter_level", METER_LEVELS)
    q = (request.args.get("q") or "").strip()[:100].lower()
    near_lat = parse_float("near_lat", -90, 90)
    near_lng = parse_float("near_lng", -180, 180)
    radius_km = parse_float("radius_km", 0, 500)
    if (near_lat is None) != (near_lng is None):
        raise ApiError(
            422, "VALIDATION_ERROR", "near_lat and near_lng must be given together.",
            [{"field": "near_lat", "message": "required together with near_lng"}],
        )

    params = {}
    where = ["TRUE"]
    join = ""
    radius_col = "NULL::float8"
    my_offer = "NULL::text AS my_offer_status"

    if user.role == "provider":
        params["uid"] = user.id
        join = "JOIN provider_profiles pp ON pp.user_id = :uid"
        where += [
            "pp.mode = 'independent'",
            "pp.lat IS NOT NULL",
            "pp.lng IS NOT NULL",
            "r.status IN ('open', 'offers_received')",
            "r.category = ANY(pp.categories)",
        ]
        distance = haversine_sql("r.lat", "r.lng", "pp.lat", "pp.lng")
        radius_col = "pp.service_radius_km"
        my_offer = (
            "(SELECT o2.status::text FROM offers o2 WHERE o2.request_id = r.id "
            "AND o2.provider_id = :uid ORDER BY o2.created_at DESC LIMIT 1) AS my_offer_status"
        )
        has_distance = True
    else:
        if user.role == "customer":
            params["uid"] = user.id
            where.append("r.customer_id = :uid")
        if near_lat is not None:
            params["near_lat"] = near_lat
            params["near_lng"] = near_lng
            distance = haversine_sql("r.lat", "r.lng", ":near_lat", ":near_lng")
            has_distance = True
        else:
            distance = "NULL::float8"
            has_distance = False

    if radius_km is not None and not has_distance:
        raise ApiError(
            422, "VALIDATION_ERROR", "radius_km needs near_lat and near_lng.",
            [{"field": "radius_km", "message": "requires near_lat and near_lng"}],
        )

    allowed_sorts = {"created_at", "severity_score"} | ({"distance"} if has_distance else set())
    sort, order = parse_sort(allowed_sorts, "created_at")

    if status:
        where.append("r.status = :status")
        params["status"] = status
    if category:
        where.append("r.category = :category")
        params["category"] = category
    if meter:
        where.append("r.meter_level = :meter")
        params["meter"] = meter
    if q:
        where.append("position(CAST(:q AS text) IN lower(r.title || ' ' || r.description)) > 0")
        params["q"] = q

    outer = ["TRUE"]
    if user.role == "provider":
        outer.append("distance_km <= radius_km")
    if radius_km is not None:
        outer.append("distance_km <= :radius_km")
        params["radius_km"] = radius_km

    cte = f"""
        WITH base AS (
            SELECT {REQUEST_COLUMNS},
                   {distance} AS distance_km,
                   {radius_col} AS radius_km,
                   {my_offer},
                   (SELECT count(*) FROM offers o
                    WHERE o.request_id = r.id AND o.status IN ('pending', 'accepted')) AS offer_count
            FROM requests r {join}
            WHERE {' AND '.join(where)}
        )
    """
    outer_sql = " AND ".join(outer)
    total = fetch_one(cte + f" SELECT count(*) AS n FROM base WHERE {outer_sql}", params)["n"]
    rows = fetch_all(
        cte
        + f" SELECT * FROM base WHERE {outer_sql}"
        + f" ORDER BY {SORT_COLUMNS[sort]} {order} NULLS LAST, id LIMIT :limit OFFSET :offset",
        {**params, "limit": limit, "offset": offset},
    )

    items = []
    for row in rows:
        row.pop("radius_km", None)
        if row["distance_km"] is not None:
            row["distance_km"] = round(row["distance_km"], 2)
        if user.role == "provider":
            row = mask_for_provider(row, user)
        else:
            row.pop("my_offer_status", None)
        items.append(row)
    return jsonify(paginated(items, page, limit, total))


@bp.get("/requests/<uuid:request_id>")
@require_auth()
def get_request_detail(request_id):
    user = current_user()
    req = ensure_request_access(user, request_id)
    return jsonify(_decorate(req, user))


@bp.post("/requests/<uuid:request_id>/cancel")
@require_auth("customer", "admin")
def cancel_request(request_id):
    user = current_user()
    req = get_request(request_id, lock=True)
    if user.role == "customer" and str(req["customer_id"]) != user.id:
        raise forbidden()
    allowed = {"open", "offers_received", "booked"}
    if user.role == "admin":
        allowed.add("in_progress")
    if req["status"] not in allowed:
        raise ApiError(409, "INVALID_STATE", f"A request that is {req['status']} cannot be cancelled.")

    run(
        "UPDATE requests SET status = 'cancelled', booked_provider_id = NULL, updated_at = now() WHERE id = :id",
        {"id": request_id},
    )
    cancelled = fetch_all(
        "UPDATE bookings SET status = 'cancelled' "
        "WHERE request_id = :id AND status IN ('confirmed', 'in_progress') RETURNING id, provider_id",
        {"id": request_id},
    )
    run("UPDATE offers SET status = 'rejected' WHERE request_id = :id AND status = 'pending'", {"id": request_id})
    run(
        "UPDATE planner_assignments SET status = 'declined' "
        "WHERE request_id = :id AND status IN ('proposed', 'confirmed')",
        {"id": request_id},
    )
    for booking in cancelled:
        add_event(request_id, "booking.status_changed", user.id,
                  {"booking_id": booking["id"], "provider_id": booking["provider_id"], "to": "cancelled"})
    add_event(request_id, "request.cancelled", user.id, {"from": req["status"]})
    commit()
    return jsonify(_decorate(get_request(request_id), user))


@bp.get("/requests/<uuid:request_id>/timeline")
@require_auth()
def request_timeline(request_id):
    user = current_user()
    ensure_request_access(user, request_id, involved_only=True)
    params = {"rid": request_id}
    extra = ""
    if user.role == "provider":
        extra = " AND " + PROVIDER_EVENT_FILTER
        params.update(uid=user.id, uid_text=user.id)
    items = fetch_all(
        "SELECT e.id, e.request_id, e.actor_id, e.type, e.payload, e.created_at "
        f"FROM request_events e WHERE e.request_id = :rid{extra} ORDER BY e.id ASC LIMIT 500",
        params,
    )
    return jsonify({"items": items})