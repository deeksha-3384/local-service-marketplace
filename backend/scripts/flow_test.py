"""End-to-end API check using the real test users.
Start the server in another terminal first, then:
    python scripts/flow_test.py
    python scripts/flow_test.py https://your-app.onrender.com
It changes the test provider's profile and creates a few 'Flow test' rows.
"""
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

BASE = (sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:5000") + "/api/v1"
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label}" + (f"  -> {detail}" if not ok and detail else ""))
    return ok


def login(prefix):
    email, password = os.getenv(f"TEST_{prefix}_EMAIL"), os.getenv(f"TEST_{prefix}_PASSWORD")
    if not (SUPABASE_URL and KEY and email and password):
        return None
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": KEY, "Content-Type": "application/json"},
        json={"email": email, "password": password}, timeout=30,
    )
    if r.status_code != 200:
        sys.exit(f"Login failed for the {prefix.lower()} test user (HTTP {r.status_code}): {r.text[:200]}")
    return r.json()["access_token"]


def call(method, path, token=None, **kwargs):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = requests.request(method, BASE + path, headers=headers, timeout=60, **kwargs)
    try:
        body = r.json()
    except ValueError:
        body = None
    return r.status_code, body


def code(body):
    return (body or {}).get("error", {}).get("code")


customer, provider, admin = login("CUSTOMER"), login("PROVIDER"), login("ADMIN")
if not (customer and provider):
    sys.exit("Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and the TEST_CUSTOMER_* / TEST_PROVIDER_* values in backend/.env")

print(f"Testing {BASE}\n")

# ---- auth and roles
s, b = call("GET", "/me")
check("no token -> 401", s == 401 and code(b) == "UNAUTHENTICATED", (s, b))
s, b = call("GET", "/me", customer)
check("GET /me as customer", s == 200 and b["profile"]["role"] == "customer", (s, b))
s, b = call("GET", "/me", provider)
check("GET /me as provider", s == 200 and b["profile"]["role"] == "provider", (s, b))
if admin:
    s, b = call("GET", "/me", admin)
    check("GET /me as admin", s == 200 and b["profile"]["role"] == "admin", (s, b))
s, b = call("PATCH", "/me", customer, json={"language": "hi"})
check("PATCH /me language", s == 200 and b["language"] == "hi", (s, b))
call("PATCH", "/me", customer, json={"language": "en"})
s, b = call("PATCH", "/me", customer, json={"role": "admin"})
check("cannot change own role (unknown field) -> 422", s == 422, (s, b))

# ---- provider setup
s, b = call("PUT", "/me/provider-profile", provider, json={
    "categories": ["plumbing", "electrical"], "lat": 12.9716, "lng": 77.5946,
    "service_radius_km": 50, "bio": "Flow test provider"})
check("PUT provider profile", s == 200 and "plumbing" in b["categories"], (s, b))
s, b = call("POST", "/provider/mode", provider, json={"mode": "independent"})
check("set mode independent", s == 200 and b["mode"] == "independent", (s, b))

_, c0 = call("GET", "/updates?after_id=latest", customer)
_, p0 = call("GET", "/updates?after_id=latest", provider)

# ---- validation and permissions
s, b = call("POST", "/requests", provider, json={"category": "plumbing", "description": "x", "lat": 1, "lng": 1})
check("provider cannot create a request -> 403", s == 403 and code(b) == "FORBIDDEN", (s, b))
s, b = call("POST", "/requests", customer, json={"category": "magic", "lat": 999, "lng": 0})
check("bad request body -> 422 with details", s == 422 and code(b) == "VALIDATION_ERROR" and b["error"].get("details"), (s, b))
s, b = call("GET", "/requests?sort=hacker", customer)
check("bad sort field -> 422", s == 422, (s, b))
s, b = call("GET", "/requests?limit=1000", customer)
check("limit too large -> 422", s == 422, (s, b))
s, b = call("GET", f"/requests/{uuid4()}", customer)
check("unknown request -> 404", s == 404 and code(b) == "NOT_FOUND", (s, b))

# ---- create a request (diagnosis supplied so no AI quota is used)
diagnosis = {
    "summary": "A tap is leaking.", "probable_causes": [{"label": "Worn washer", "confidence": 0.7}],
    "recommended_category": "plumbing", "severity_score": 60, "meter_level": "high",
    "estimated_duration_minutes": 60, "safety_warning": None, "follow_up_questions": [], "language": "en"}


def new_request(title):
    return call("POST", "/requests", customer, json={
        "category": "plumbing", "title": title, "description": "Tap leaking under the sink (automated test)",
        "lat": 12.9720, "lng": 77.5950, "address": "Flow test address", "language": "en", "diagnosis": diagnosis})


s, r1 = new_request("Flow test: leaking tap A")
check("create request", s == 201 and r1["status"] == "open" and r1["meter_level"] == "high", (s, r1))
rid1 = r1["id"]

s, b = call("GET", "/requests?category=plumbing&sort=distance&order=asc&limit=100", provider)
mine = next((i for i in (b or {}).get("items", []) if i["id"] == rid1), None)
check("provider feed shows the request with distance", s == 200 and mine and mine["distance_km"] is not None, (s, b))
check("provider feed hides the exact address", mine and mine["address"] is None, mine)
s, b = call("GET", "/requests", customer)
check("customer list contains own request", s == 200 and any(i["id"] == rid1 for i in b["items"]), (s, b))

# ---- offer and accept
day = random.randint(30, 3000)
start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=day, minutes=random.randint(0, 600))
end = start + timedelta(hours=1)
offer_body = {"price": 450, "eta_minutes": 45, "message": "Flow test offer",
              "proposed_start": start.isoformat(), "proposed_end": end.isoformat()}
s, o1 = call("POST", f"/requests/{rid1}/offers", provider, json=offer_body)
check("provider sends offer", s == 201 and o1["status"] == "pending", (s, o1))
s, b = call("POST", f"/requests/{rid1}/offers", provider, json=offer_body)
check("duplicate active offer -> 409", s == 409, (s, b))
s, b = call("GET", f"/requests/{rid1}", customer)
check("request moved to offers_received", s == 200 and b["status"] == "offers_received" and b["offer_count"] == 1, (s, b))
s, b = call("GET", f"/requests/{rid1}/offers?sort=price&order=asc", customer)
check("customer lists offers with provider info", s == 200 and b["total"] == 1 and b["items"][0]["provider"]["id"], (s, b))
s, b = call("GET", f"/requests/{rid1}/offers", provider)
check("provider cannot list offers -> 403", s == 403, (s, b))

s, bk1 = call("POST", f"/offers/{o1['id']}/accept", customer)
check("customer accepts offer -> booking", s == 201 and bk1["status"] == "confirmed", (s, bk1))
s, b = call("POST", f"/offers/{o1['id']}/accept", customer)
check("accepting twice -> 409 INVALID_STATE", s == 409 and code(b) == "INVALID_STATE", (s, b))

# ---- the double-booking guard, proven through the API
s, r2 = new_request("Flow test: leaking tap B")
rid2 = r2["id"]
s, o2 = call("POST", f"/requests/{rid2}/offers", provider, json=offer_body)
check("provider offers the SAME slot on a second request", s == 201, (s, o2))
s, b = call("POST", f"/offers/{o2['id']}/accept", customer)
check("double-booking blocked -> 409 SLOT_CONFLICT", s == 409 and code(b) == "SLOT_CONFLICT", (s, b))
s, b = call("GET", f"/requests/{rid2}", customer)
check("failed accept left the request untouched", s == 200 and b["status"] == "offers_received", (s, b))

# ---- booking lifecycle
s, b = call("GET", "/bookings", provider)
check("provider sees the booking", s == 200 and any(i["id"] == bk1["id"] for i in b["items"]), (s, b))
s, b = call("POST", f"/bookings/{bk1['id']}/status", customer, json={"status": "completed"})
check("customer cannot complete a booking -> 403", s == 403, (s, b))
s, b = call("POST", f"/bookings/{bk1['id']}/status", provider, json={"status": "completed"})
check("cannot skip confirmed -> completed -> 409", s == 409, (s, b))
s, b = call("POST", f"/bookings/{bk1['id']}/status", provider, json={"status": "in_progress"})
check("provider starts work", s == 200 and b["status"] == "in_progress", (s, b))
s, b = call("POST", f"/bookings/{bk1['id']}/status", provider, json={"status": "completed"})
check("provider completes work", s == 200 and b["status"] == "completed", (s, b))
s, b = call("GET", f"/requests/{rid1}", customer)
check("request status followed the booking", s == 200 and b["status"] == "completed", (s, b))

# ---- timeline and live updates
s, b = call("GET", f"/requests/{rid1}/timeline", customer)
types = [e["type"] for e in (b or {}).get("items", [])]
check("timeline has the full story", s == 200 and {"request.created", "offer.created", "offer.accepted", "booking.created"} <= set(types), types)
s, b = call("GET", f"/requests/{rid1}/timeline", provider)
check("provider timeline works", s == 200, (s, b))

s, b = call("GET", f"/updates?after_id={c0['last_id']}", customer)
ctypes = {e["type"] for e in (b or {}).get("events", [])}
check("customer /updates feed", s == 200 and {"request.created", "offer.created", "booking.created"} <= ctypes, ctypes)
s, b = call("GET", f"/updates?after_id={p0['last_id']}", provider)
ptypes = {e["type"] for e in (b or {}).get("events", [])}
check("provider /updates feed", s == 200 and {"offer.created", "booking.created"} <= ptypes, ptypes)

# ---- cleanup
s, b = call("POST", f"/requests/{rid2}/cancel", customer)
check("customer cancels the second request", s == 200 and b["status"] == "cancelled", (s, b))

print(f"\n{sum(results)} passed, {len(results) - sum(results)} failed")
sys.exit(0 if all(results) else 1)