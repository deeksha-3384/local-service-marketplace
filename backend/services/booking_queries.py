from db_utils import fetch_one

BOOKING_SELECT = """
SELECT b.id, b.request_id, b.offer_id, b.customer_id, b.provider_id,
       lower(b.slot) AS slot_start, upper(b.slot) AS slot_end,
       b.status::text AS status, b.created_at,
       r.title AS request_title, r.category AS request_category,
       r.meter_level::text AS request_meter_level, r.address AS request_address,
       r.lat AS request_lat, r.lng AS request_lng,
       cp.full_name AS customer_name, pv.full_name AS provider_name
FROM bookings b
JOIN requests r ON r.id = b.request_id
JOIN profiles cp ON cp.id = b.customer_id
JOIN profiles pv ON pv.id = b.provider_id
"""


def format_booking(row):
    return {
        "id": row["id"],
        "request_id": row["request_id"],
        "offer_id": row["offer_id"],
        "customer_id": row["customer_id"],
        "provider_id": row["provider_id"],
        "status": row["status"],
        "slot": {"start": row["slot_start"], "end": row["slot_end"]},
        "created_at": row["created_at"],
        "customer_name": row["customer_name"],
        "provider_name": row["provider_name"],
        "request": {
            "id": row["request_id"],
            "title": row["request_title"],
            "category": row["request_category"],
            "meter_level": row["request_meter_level"],
            "address": row["request_address"],
            "lat": row["request_lat"],
            "lng": row["request_lng"],
        },
    }


def get_booking(booking_id):
    return fetch_one(BOOKING_SELECT + " WHERE b.id = :id", {"id": booking_id})