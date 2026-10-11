"""Provider languages, the language filter and phone privacy, against the real API.
    python scripts/language_flow_test.py
    python scripts/language_flow_test.py --url https://your-app.onrender.com
It sets the test provider's phone number and languages (languages are restored at the end).
"""
import argparse
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:5000")
args = parser.parse_args()

BASE = args.url.rstrip("/") + "/api/v1"
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
PHONE = "+91 98765 43210"
results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label}" + (f"  -> {detail}" if not ok and detail else ""))
    return ok


def login(prefix):
    email, password = os.getenv(f"TEST_{prefix}_EMAIL"), os.getenv(f"TEST_{prefix}_PASSWORD")
    r = requests.post(f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                      headers={"apikey": KEY, "Content-Type": "application/json"},
                      json={"email": email, "password": password}, timeout=30)
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


customer, provider = login("CUSTOMER"), login("PROVIDER")
print(f"Testing {BASE}\n")
_, me_p = call("GET", "/me", provider)
orig = me_p["provider_profile"] or {}
PROFILE = {"categories": ["plumbing"], "lat": 12.9716, "lng": 77.5946, "service_radius_km": 50}
created = []

try:
    s, b = call("PUT", "/me/provider-profile", provider, json={**PROFILE, "languages": ["xx"]})
    check("unknown language -> 422", s == 422, (s, b))
    s, b = call("PUT", "/me/provider-profile", provider, json={**PROFILE, "languages": []})
    check("empty language list -> 422", s == 422, (s, b))
    s, b = call("PUT", "/me/provider-profile", provider, json={**PROFILE, "languages": ["en", "hi", "hi"]})
    check("provider saves languages (duplicates removed)", s == 200 and sorted(b["languages"]) == ["en", "hi"], (s, b))
    s, b = call("PUT", "/me/provider-profile", provider, json=PROFILE)
    check("saving without languages keeps them", s == 200 and sorted(b["languages"]) == ["en", "hi"], (s, b))
    s, b = call("PATCH", "/me", provider, json={"phone": "abc"})
    check("invalid phone -> 422", s == 422, (s, b))
    s, b = call("PATCH", "/me", provider, json={"phone": PHONE})
    check("provider saves a phone number", s == 200 and b["phone"] == PHONE, (s, b))
    s, b = call("POST", "/provider/mode", provider, json={"mode": "independent"})
    check("provider independent mode", s == 200, (s, b))

    diagnosis = {"summary": "Leak.", "probable_causes": [{"label": "Worn seal", "confidence": 0.6}],
                 "recommended_category": "plumbing", "severity_score": 40, "meter_level": "medium",
                 "estimated_duration_minutes": 60, "safety_warning": None, "follow_up_questions": [], "language": "en"}
    s, req = call("POST", "/requests", customer, json={
        "category": "plumbing", "title": "Flow test: languages", "description": "Automated language test",
        "lat": 12.9720, "lng": 77.5950, "language": "en", "diagnosis": diagnosis})
    check("customer creates a request", s == 201, (s, req))
    rid = req["id"]
    created.append(rid)

    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=random.randint(30, 3000), minutes=random.randint(0, 600))
    s, offer = call("POST", f"/requests/{rid}/offers", provider, json={
        "price": 500, "eta_minutes": 30, "message": "language test",
        "proposed_start": start.isoformat(), "proposed_end": (start + timedelta(hours=1)).isoformat()})
    check("provider sends an offer", s == 201, (s, offer))

    s, b = call("GET", f"/requests/{rid}/offers", customer)
    p = (b or {}).get("items", [{}])[0].get("provider", {})
    check("offer shows provider languages", s == 200 and sorted(p.get("languages", [])) == ["en", "hi"], (s, b))
    check("offers list never exposes the phone number", "phone" not in p and PHONE not in str(b), p)
    s, b = call("GET", f"/requests/{rid}/offers?language=hi", customer)
    check("language filter keeps a Hindi speaker", s == 200 and b["total"] == 1, (s, b))
    s, b = call("GET", f"/requests/{rid}/offers?language=kn", customer)
    check("language filter hides a non-Kannada speaker", s == 200 and b["total"] == 0, (s, b))
    s, b = call("GET", f"/requests/{rid}/offers?language=xx", customer)
    check("unknown filter language -> 422", s == 422, (s, b))

    s, bk = call("POST", f"/offers/{offer['id']}/accept", customer)
    check("customer accepts: booking shows the provider phone", s == 201 and bk["provider_phone"] == PHONE, (s, bk))
    s, b = call("GET", "/bookings", customer)
    mine = next((i for i in (b or {}).get("items", []) if i["id"] == bk["id"]), None)
    check("customer booking list shows the phone", mine and mine["provider_phone"] == PHONE, (s, b))
    s, b = call("GET", "/bookings", provider)
    mine = next((i for i in (b or {}).get("items", []) if i["id"] == bk["id"]), None)
    check("provider's own view has no phone field value", mine and mine["provider_phone"] is None, (s, b))
    s, b = call("GET", f"/requests/{rid}", customer)
    check("request detail shows the phone to the customer", s == 200 and b["booking"]["provider_phone"] == PHONE, (s, b))
    s, b = call("GET", f"/requests/{rid}", provider)
    check("request detail hides the phone from the provider", s == 200 and b["booking"]["provider_phone"] is None, (s, b))

    call("POST", f"/bookings/{bk['id']}/status", provider, json={"status": "in_progress"})
    call("POST", f"/bookings/{bk['id']}/status", provider, json={"status": "completed"})
    s, b = call("GET", f"/bookings/{bk['id']}", customer)
    check("phone is hidden once the booking is completed", s == 200 and b["provider_phone"] is None, (s, b))
finally:
    for rid in created:
        call("POST", f"/requests/{rid}/cancel", customer)
    call("PUT", "/me/provider-profile", provider, json={
        "categories": orig.get("categories") or ["plumbing"], "languages": orig.get("languages") or ["en"],
        "lat": orig.get("lat") or 12.9716, "lng": orig.get("lng") or 77.5946,
        "service_radius_km": orig.get("service_radius_km") or 20, "bio": orig.get("bio")})
    print("\n(cleanup: provider languages restored; the test phone number stays on the test provider)")

print(f"{sum(results)} passed, {len(results) - sum(results)} failed")
sys.exit(0 if all(results) else 1)