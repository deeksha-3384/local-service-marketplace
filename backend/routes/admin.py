import json
from uuid import UUID

from flask import Blueprint, jsonify, request
from pydantic import Field

from auth import current_user, require_auth
from db_utils import commit, fetch_all, fetch_one, run
from errors import ApiError
from pagination import paginated, parse_pagination
from query_utils import parse_choice
from services.events import add_event
from services.planner import plan_assignments
from validation import Schema, parse_body

bp = Blueprint("admin", __name__)

OPEN = ("open", "offers_received")
MAX_PLANNER_REQUESTS = 200
ALREADY_ASSIGNED = (
    "EXISTS (SELECT 1 FROM planner_assignments a JOIN planner_runs pr ON pr.id = a.run_id "
    "WHERE a.request_id = r.id AND a.status = 'proposed' AND pr.status = 'confirmed')"
)
USER_COLUMNS = (
    "p.id, p.role::text AS role, p.full_name, u.email, p.phone, p.language, p.is_active, p.created_at, "
    "pp.is_verified, pp.mode::text AS mode, pp.rating, pp.rating_count"
)
USER_FROM = (
    "FROM profiles p LEFT JOIN auth.users u ON u.id = p.id "
    "LEFT JOIN provider_profiles pp ON pp.user_id = p.id"
)


# ------------------------------------------------------------------ stats and users

@bp.get("/admin/stats")
@require_auth("admin")
def stats():
    users = {"customer": 0, "provider": 0, "admin": 0}
    for row in fetch_all("SELECT role::text AS k, count(*) AS n FROM profiles GROUP BY role"):
        users[row["k"]] = row["n"]
    statuses = {s: 0 for s in ("open", "offers_received", "booked", "in_progress", "completed", "cancelled")}
    for row in fetch_all("SELECT status::text AS k, count(*) AS n FROM requests GROUP BY status"):
        statuses[row["k"]] = row["n"]
    extra = fetch_one(
        "SELECT (SELECT count(*) FROM bookings WHERE created_at >= now() - interval '24 hours') AS bookings_today, "
        "(SELECT count(*) FROM offers) AS offers, (SELECT count(*) FROM requests) AS requests"
    )
    avg = round(extra["offers"] / extra["requests"], 2) if extra["requests"] else 0
    return jsonify({
        "users_by_role": users,
        "requests_by_status": statuses,
        "bookings_today": extra["bookings_today"],  # bookings created in the last 24 hours
        "avg_offers_per_request": avg,
    })


@bp.get("/admin/users")
@require_auth("admin")
def list_users():
    page, limit, offset = parse_pagination()
    role = parse_choice("role", {"customer", "provider", "admin"})
    q = (request.args.get("q") or "").strip()[:100].lower()
    params, where = {}, ["TRUE"]
    if role:
        where.append("p.role = CAST(:role AS user_role)")
        params["role"] = role
    if q:
        where.append("position(CAST(:q AS text) IN lower(coalesce(p.full_name, '') || ' ' || coalesce(u.email, ''))) > 0")
        params["q"] = q
    clause = " AND ".join(where)
    total = fetch_one(f"SELECT count(*) AS n {USER_FROM} WHERE {clause}", params)["n"]
    rows = fetch_all(
        f"SELECT {USER_COLUMNS} {USER_FROM} WHERE {clause} ORDER BY p.created_at DESC, p.id LIMIT :limit OFFSET :offset",
        {**params, "limit": limit, "offset": offset},
    )
    return jsonify(paginated(rows, page, limit, total))


class UserPatch(Schema):
    is_active: bool | None = None
    is_verified: bool | None = None


@bp.patch("/admin/users/<uuid:user_id>")
@require_auth("admin")
def patch_user(user_id):
    admin = current_user()
    body = parse_body(UserPatch)
    data = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not data:
        raise ApiError(422, "VALIDATION_ERROR", "Nothing to update.")
    target = fetch_one("SELECT id, role::text AS role FROM profiles WHERE id = :id", {"id": user_id})
    if target is None:
        raise ApiError(404, "NOT_FOUND", "User not found.")
    if data.get("is_active") is False and str(user_id) == admin.id:
        raise ApiError(409, "INVALID_STATE", "You cannot deactivate your own account.")
    if "is_verified" in data and target["role"] != "provider":
        raise ApiError(422, "VALIDATION_ERROR", "Only providers can be verified.",
                       [{"field": "is_verified", "message": "user is not a provider"}])
    if "is_active" in data:
        run("UPDATE profiles SET is_active = :v WHERE id = :id", {"v": data["is_active"], "id": user_id})
    if "is_verified" in data:
        run("UPDATE provider_profiles SET is_verified = :v WHERE user_id = :id", {"v": data["is_verified"], "id": user_id})
    commit()
    return jsonify(fetch_one(f"SELECT {USER_COLUMNS} {USER_FROM} WHERE p.id = :id", {"id": user_id}))


# ------------------------------------------------------------------ Recovery Planner

class PlannerRunBody(Schema):
    request_ids: list[UUID] | None = Field(default=None, min_length=1, max_length=MAX_PLANNER_REQUESTS)
    dry_run: bool = True
    require_verified: bool = False


def _run_view(run_id):
    run_row = fetch_one(
        "SELECT id, created_by, created_at, status, summary FROM planner_runs WHERE id = :id", {"id": run_id}
    )
    if run_row is None:
        raise ApiError(404, "NOT_FOUND", "Planner run not found.")
    assignments = fetch_all(
        "SELECT a.id, a.request_id, a.provider_id, a.distance_km, a.score, a.status::text AS status, "
        "r.title AS request_title, p.full_name AS provider_name "
        "FROM planner_assignments a JOIN requests r ON r.id = a.request_id JOIN profiles p ON p.id = a.provider_id "
        "WHERE a.run_id = :id ORDER BY a.score DESC NULLS LAST, a.id",
        {"id": run_id},
    )
    for item in assignments:
        if item["distance_km"] is not None:
            item["distance_km"] = round(item["distance_km"], 2)
    summary = run_row["summary"] if isinstance(run_row["summary"], dict) else {}
    raw = summary.get("unassigned")
    unassigned = [u for u in raw if isinstance(u, dict) and u.get("request_id")] if isinstance(raw, list) else []
    dropped = summary.get("dropped_at_confirm")
    return {
        "run_id": run_row["id"],
        "status": run_row["status"],
        "created_at": run_row["created_at"],
        "created_by": run_row["created_by"],
        "assignments": assignments,
        "unassigned": unassigned,
        "unassigned_request_ids": [u["request_id"] for u in unassigned],
        "dropped": dropped if isinstance(dropped, list) else [],
        "summary": {k: summary.get(k) for k in ("requests_considered", "providers_considered", "assigned", "require_verified")},
    }


def _candidate(row):
    return {"id": str(row["id"]), "category": row["category"], "lat": row["lat"], "lng": row["lng"],
            "severity_score": row["severity_score"]}


@bp.post("/admin/planner/run")
@require_auth("admin")
def planner_run():
    admin = current_user()
    body = parse_body(PlannerRunBody)

    pre = []
    if body.request_ids:
        ids = list(dict.fromkeys(body.request_ids))
        rows = fetch_all(
            "SELECT r.id, r.category, r.lat, r.lng, r.severity_score, r.status::text AS status, "
            f"{ALREADY_ASSIGNED} AS already_assigned FROM requests r WHERE r.id = ANY(CAST(:ids AS uuid[]))",
            {"ids": ids},
        )
        by_id = {str(r["id"]): r for r in rows}
        candidates = []
        for rid in ids:
            row = by_id.get(str(rid))
            if row is None:
                pre.append({"request_id": str(rid), "reason": "not_found"})
            elif row["status"] not in OPEN:
                pre.append({"request_id": str(rid), "reason": "not_open"})
            elif row["already_assigned"]:
                pre.append({"request_id": str(rid), "reason": "already_assigned"})
            else:
                candidates.append(_candidate(row))
    else:
        rows = fetch_all(
            "SELECT r.id, r.category, r.lat, r.lng, r.severity_score FROM requests r "
            f"WHERE r.status IN ('open', 'offers_received') AND NOT {ALREADY_ASSIGNED} "
            f"ORDER BY r.severity_score DESC NULLS LAST, r.created_at LIMIT {MAX_PLANNER_REQUESTS}"
        )
        candidates = [_candidate(r) for r in rows]

    verified_sql = " AND pp.is_verified" if body.require_verified else ""
    providers = fetch_all(
        "SELECT pp.user_id AS id, pp.categories, pp.lat, pp.lng, pp.service_radius_km, pp.rating "
        "FROM provider_profiles pp JOIN profiles p ON p.id = pp.user_id "
        "WHERE p.role = 'provider' AND p.is_active AND pp.mode = 'planner' "
        f"AND pp.lat IS NOT NULL AND pp.lng IS NOT NULL{verified_sql} "
        "AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.provider_id = pp.user_id "
        "  AND b.status IN ('confirmed', 'in_progress') "
        "  AND b.slot && tstzrange(now(), now() + interval '60 minutes', '[)')) "
        "AND NOT EXISTS (SELECT 1 FROM planner_assignments a JOIN planner_runs pr ON pr.id = a.run_id "
        "  WHERE a.provider_id = pp.user_id AND a.status = 'proposed' AND pr.status = 'confirmed')"
    )

    try:
        result = plan_assignments(candidates, providers)
    except ValueError:
        raise ApiError(422, "VALIDATION_ERROR", "Too many requests or providers for one run. Select fewer requests.")

    unassigned = pre + result["unassigned"]
    summary = {
        "requests_considered": len(candidates) + len(pre),
        "providers_considered": len(providers),
        "assigned": len(result["assignments"]),
        "require_verified": body.require_verified,
        "unassigned": unassigned,
    }
    status = "dry_run" if body.dry_run else "confirmed"
    run_row = fetch_one(
        "INSERT INTO planner_runs (created_by, status, summary) VALUES (:uid, :status, CAST(:summary AS jsonb)) RETURNING id",
        {"uid": admin.id, "status": status, "summary": json.dumps(summary, default=str)},
    )
    for item in result["assignments"]:
        row = fetch_one(
            "INSERT INTO planner_assignments (run_id, request_id, provider_id, distance_km, score, status) "
            "VALUES (:run, :rid, :pid, :dist, :score, 'proposed') RETURNING id",
            {"run": run_row["id"], "rid": item["request_id"], "pid": item["provider_id"],
             "dist": item["distance_km"], "score": item["score"]},
        )
        if not body.dry_run:
            add_event(item["request_id"], "planner.assigned", admin.id,
                      {"assignment_id": row["id"], "provider_id": item["provider_id"],
                       "run_id": run_row["id"], "distance_km": item["distance_km"]})
    commit()
    return jsonify(_run_view(run_row["id"])), 201


@bp.get("/admin/planner/runs")
@require_auth("admin")
def list_runs():
    rows = fetch_all(
        "SELECT pr.id, pr.status, pr.created_at, "
        "(SELECT count(*) FROM planner_assignments a WHERE a.run_id = pr.id) AS assignment_count "
        "FROM planner_runs pr ORDER BY pr.created_at DESC LIMIT 20"
    )
    return jsonify({"items": rows})


@bp.get("/admin/planner/runs/<uuid:run_id>")
@require_auth("admin")
def get_run(run_id):
    return jsonify(_run_view(run_id))


@bp.post("/admin/planner/runs/<uuid:run_id>/confirm")
@require_auth("admin")
def confirm_run(run_id):
    admin = current_user()
    run_row = fetch_one("SELECT id, status FROM planner_runs WHERE id = :id FOR UPDATE", {"id": run_id})
    if run_row is None:
        raise ApiError(404, "NOT_FOUND", "Planner run not found.")
    if run_row["status"] != "dry_run":
        raise ApiError(409, "INVALID_STATE", "This run is already confirmed.")

    dropped = []
    for a in fetch_all(
        "SELECT id, request_id, provider_id FROM planner_assignments WHERE run_id = :id AND status = 'proposed'",
        {"id": run_id},
    ):
        check = fetch_one(
            """
            SELECT (r.status IN ('open', 'offers_received')) AS request_open,
                   EXISTS (SELECT 1 FROM planner_assignments x JOIN planner_runs xr ON xr.id = x.run_id
                           WHERE x.request_id = a.request_id AND x.status = 'proposed'
                             AND xr.status = 'confirmed' AND x.id <> a.id) AS request_taken,
                   (pp.mode = 'planner' AND p.is_active) AS provider_ok,
                   EXISTS (SELECT 1 FROM planner_assignments x JOIN planner_runs xr ON xr.id = x.run_id
                           WHERE x.provider_id = a.provider_id AND x.status = 'proposed'
                             AND xr.status = 'confirmed' AND x.id <> a.id) AS provider_busy
            FROM planner_assignments a
            JOIN requests r ON r.id = a.request_id
            JOIN profiles p ON p.id = a.provider_id
            JOIN provider_profiles pp ON pp.user_id = a.provider_id
            WHERE a.id = :aid
            """,
            {"aid": a["id"]},
        )
        reason = None
        if check is None or not check["request_open"]:
            reason = "request_not_open"
        elif check["request_taken"]:
            reason = "request_already_assigned"
        elif not check["provider_ok"]:
            reason = "provider_unavailable"
        elif check["provider_busy"]:
            reason = "provider_has_pending_assignment"
        if reason:
            run("UPDATE planner_assignments SET status = 'declined' WHERE id = :id", {"id": a["id"]})
            dropped.append({"assignment_id": str(a["id"]), "request_id": str(a["request_id"]), "reason": reason})
        else:
            add_event(a["request_id"], "planner.assigned", admin.id,
                      {"assignment_id": a["id"], "provider_id": a["provider_id"], "run_id": run_id})

    run(
        "UPDATE planner_runs SET status = 'confirmed', "
        "summary = COALESCE(summary, '{}'::jsonb) || CAST(:extra AS jsonb) WHERE id = :id",
        {"extra": json.dumps({"dropped_at_confirm": dropped}), "id": run_id},
    )
    commit()
    return jsonify(_run_view(run_id))