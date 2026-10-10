from flask import Blueprint, jsonify, request

from auth import current_user, require_auth
from db_utils import fetch_all, fetch_one
from errors import ApiError
from services.access import LIFECYCLE_SQL

bp = Blueprint("updates", __name__)

EVENT_COLUMNS = "e.id, e.request_id, e.actor_id, e.type, e.payload, e.created_at"
MAX_EVENTS = 100


@bp.get("/updates")
@require_auth()
def updates():
    user = current_user()
    raw = request.args.get("after_id", "0")

    if raw == "latest":
        row = fetch_one("SELECT COALESCE(max(id), 0) AS last_id FROM request_events")
        return jsonify({"last_id": row["last_id"], "events": []})

    try:
        after = int(raw)
        if after < 0:
            raise ValueError
    except ValueError:
        raise ApiError(422, "VALIDATION_ERROR", "Invalid query parameter 'after_id'.",
                       [{"field": "after_id", "message": "must be a non-negative integer or 'latest'"}])

    params = {"after": after, "limit": MAX_EVENTS}
    if user.role == "admin":
        sql = f"SELECT {EVENT_COLUMNS} FROM request_events e WHERE e.id > :after ORDER BY e.id LIMIT :limit"
    elif user.role == "customer":
        params["uid"] = user.id
        sql = (
            f"SELECT {EVENT_COLUMNS} FROM request_events e JOIN requests r ON r.id = e.request_id "
            "WHERE e.id > :after AND r.customer_id = :uid ORDER BY e.id LIMIT :limit"
        )
    else:
        params.update(uid=user.id, uid_text=user.id)
        sql = f"""
            SELECT {EVENT_COLUMNS}
            FROM request_events e JOIN requests r ON r.id = e.request_id
            WHERE e.id > :after AND (
                e.actor_id = :uid
                OR e.payload->>'provider_id' = :uid_text
                OR (e.type IN {LIFECYCLE_SQL} AND (
                        r.booked_provider_id = :uid
                        OR EXISTS (SELECT 1 FROM offers o WHERE o.request_id = r.id AND o.provider_id = :uid)
                        OR EXISTS (SELECT 1 FROM planner_assignments a WHERE a.request_id = r.id AND a.provider_id = :uid)
                        OR EXISTS (SELECT 1 FROM provider_profiles pp
                                   WHERE pp.user_id = :uid AND r.category = ANY(pp.categories))
                ))
            )
            ORDER BY e.id LIMIT :limit
        """
    events = fetch_all(sql, params)
    return jsonify({"last_id": events[-1]["id"] if events else after, "events": events})