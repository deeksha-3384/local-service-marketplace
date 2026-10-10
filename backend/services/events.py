import json

from db_utils import run


def add_event(request_id, event_type, actor_id=None, payload=None):
    """Writes to the timeline and polling feed, inside the caller's transaction."""
    run(
        "INSERT INTO request_events (request_id, actor_id, type, payload) "
        "VALUES (:rid, :aid, :type, CAST(:payload AS jsonb))",
        {
            "rid": request_id,
            "aid": actor_id,
            "type": event_type,
            "payload": json.dumps(payload or {}, default=str),
        },
    )