from db_utils import fetch_one
from errors import ApiError

REQUEST_COLUMNS = (
    "r.id, r.customer_id, r.category, r.title, r.description, r.transcript, r.language, "
    "r.lat, r.lng, r.address, r.status::text AS status, r.severity_score, "
    "r.meter_level::text AS meter_level, r.diagnosis, r.booked_provider_id, "
    "r.created_at, r.updated_at"
)

# Event types any involved provider may see; offer/booking events are shown
# only to the provider they belong to (payload.provider_id) so rivals never see prices.
LIFECYCLE_SQL = (
    "('request.created', 'request.status_changed', 'request.cancelled', 'diagnosis.ready')"
)
PROVIDER_EVENT_FILTER = (
    "(e.actor_id = :uid OR e.payload->>'provider_id' = :uid_text OR e.type IN " + LIFECYCLE_SQL + ")"
)

PROVIDER_REL_SQL = """
SELECT
  (COALESCE(r.booked_provider_id = :uid, false)
   OR EXISTS (SELECT 1 FROM offers o WHERE o.request_id = r.id AND o.provider_id = :uid)
   OR EXISTS (SELECT 1 FROM planner_assignments a WHERE a.request_id = r.id AND a.provider_id = :uid)
  ) AS involved,
  (r.status IN ('open', 'offers_received')
   AND EXISTS (SELECT 1 FROM provider_profiles pp
               WHERE pp.user_id = :uid AND r.category = ANY(pp.categories))
  ) AS matching
FROM requests r WHERE r.id = :id
"""


def forbidden(message="You do not have access to this resource."):
    return ApiError(403, "FORBIDDEN", message)


def get_request(request_id, lock=False):
    sql = f"SELECT {REQUEST_COLUMNS} FROM requests r WHERE r.id = :id"
    if lock:
        sql += " FOR UPDATE OF r"
    row = fetch_one(sql, {"id": request_id})
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Request not found.")
    return row


def ensure_request_access(user, request_id, involved_only=False):
    req = get_request(request_id)
    if user.role == "admin":
        return req
    if user.role == "customer":
        if str(req["customer_id"]) == user.id:
            return req
        raise forbidden()
    rel = fetch_one(PROVIDER_REL_SQL, {"id": request_id, "uid": user.id})
    if rel and (rel["involved"] or (rel["matching"] and not involved_only)):
        return req
    raise forbidden()


def mask_for_provider(req, user):
    """Providers only get the exact address once they are the booked provider."""
    if user.role != "provider":
        return req
    booked = req.get("booked_provider_id")
    if booked is not None and str(booked) == user.id:
        return req
    masked = dict(req)
    masked["address"] = None
    for key in ("lat", "lng"):
        if masked.get(key) is not None:
            masked[key] = round(masked[key], 2)
    return masked