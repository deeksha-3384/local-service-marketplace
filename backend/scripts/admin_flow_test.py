"""Provider, planner and admin checks. Start the server first, then:
    python scripts/admin_flow_test.py
    python scripts/admin_flow_test.py --url https://your-app.onrender.com
It temporarily moves the test provider to Sydney (planner mode) and restores the profile at the end.
"""
import argparse
import os
import sys
import uuid
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
SYDNEY = (-33.8688, 151.2093)
results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label}" + (f"  -> {detail}" if not ok and detail else ""))
    return ok


def login(prefix):
    email, password = os.getenv(f"TEST_{prefix}_EMAIL"), os.getenv(f"TEST_{prefix}_PASSWORD")
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
print(f"Testing {BASE}\n")

_, me_p = call("GET", "/me", provider)
_, me_c = call("GET", "/me", customer)
_, me_a = call("GET", "/me", admin)
pid, cid = me_p["profile"]["id"], me_c["profile"]["id"]
original = me_p["provider_profile"] or {}

DIAG = {
    "summary": "Pipe burst.", "probable_causes": [{"label": "Burst pipe", "confidence": 0.8}],
    "recommended_category": "plumbing", "severity_score": 80, "meter_level": "critical",
    "estimated_duration_minutes": 90, "safety_warning": None, "follow_up_questions": [], "language": "en"}
created = []


def make_request(title):
    s, r = call("POST", "/requests", customer, json={
        "category": "plumbing", "title": title, "description": "Automated planner test",
        "lat": SYDNEY[0], "lng": SYDNEY[1], "language": "en", "diagnosis": DIAG})
    if s == 201:
        created.append(r["id"])
    return s, r


def run_tests():
    # clear leftovers so an old assignment cannot block the provider
    s, b = call("GET", "/provider/assignments", provider)
    for item in (b or {}).get("items", []):
        call("POST", f"/provider/assignments/{item['id']}/decline", provider)

    # ---- admin basics
    s, b = call("GET", "/admin/stats", customer)
    check("customer cannot read admin stats -> 403", s == 403, (s, b))
    s, b = call("GET", "/admin/stats", provider)
    check("provider cannot read admin stats -> 403", s == 403, (s, b))
    s, b = call("GET", "/admin/stats", admin)
    check("admin stats", s == 200 and {"customer", "provider", "admin"} <= set(b["users_by_role"])
          and "open" in b["requests_by_status"] and "bookings_today" in b and "avg_offers_per_request" in b, (s, b))
    s, b = call("GET", "/admin/users?role=provider&limit=100", admin)
    mine = next((u for u in (b or {}).get("items", []) if u["id"] == pid), None)
    check("admin lists providers with email", s == 200 and mine and mine.get("email"), (s, b))
    s, b = call("GET", "/admin/users?q=test.provider", admin)
    check("admin user search", s == 200 and any(u["id"] == pid for u in b["items"]), (s, b))
    s, b = call("GET", "/admin/users?role=wizard", admin)
    check("bad role filter -> 422", s == 422, (s, b))
    s, b = call("PATCH", f"/admin/users/{me_a['profile']['id']}", admin, json={"is_active": False})
    check("admin cannot deactivate themselves -> 409", s == 409, (s, b))
    s, b = call("PATCH", f"/admin/users/{pid}", admin, json={})
    check("empty user patch -> 422", s == 422, (s, b))
    s, b = call("PATCH", f"/admin/users/{uuid.uuid4()}", admin, json={"is_active": True})
    check("unknown user -> 404", s == 404, (s, b))
    s, b = call("PATCH", f"/admin/users/{cid}", admin, json={"is_verified": True})
    check("cannot verify a customer -> 422", s == 422, (s, b))
    s, b = call("PATCH", f"/admin/users/{pid}", admin, json={"is_verified": bool(mine["is_verified"])})
    check("admin patches a provider (value unchanged)", s == 200, (s, b))

    # ---- provider setup
    s, b = call("PUT", "/me/provider-profile", provider, json={
        "categories": ["plumbing"], "lat": SYDNEY[0], "lng": SYDNEY[1], "service_radius_km": 25, "bio": "Planner test"})
    check("provider profile moved to Sydney", s == 200, (s, b))
    s, b = call("POST", "/provider/mode", provider, json={"mode": "planner"})
    check("provider switches to planner mode", s == 200 and b["mode"] == "planner", (s, b))
    s, b = call("GET", "/requests", provider)
    check("planner-mode provider has an empty open-requests feed", s == 200 and b["total"] == 0, (s, b))
    s, b = call("GET", "/provider/dashboard", provider)
    check("provider dashboard", s == 200 and {"open_nearby", "pending_offers", "upcoming_bookings", "rating"} <= set(b), (s, b))
    s, b = call("GET", f"/providers/{pid}", customer)
    check("public provider profile hides contact details", s == 200 and "phone" not in b and "lat" not in b, (s, b))
    s, b = call("GET", f"/providers/{uuid.uuid4()}", customer)
    check("unknown provider -> 404", s == 404, (s, b))
    s, b = call("POST", "/admin/planner/run", customer, json={"dry_run": True})
    check("customer cannot run the planner -> 403", s == 403, (s, b))
    s, b = call("POST", "/admin/planner/run", admin, json={"request_ids": ["abc"]})
    check("bad request_ids -> 422", s == 422, (s, b))
    ghost = str(uuid.uuid4())
    s, b = call("POST", "/admin/planner/run", admin, json={"request_ids": [ghost]})
    check("unknown request id is reported as unassigned",
          s == 201 and ghost in b["unassigned_request_ids"] and b["assignments"] == [], (s, b))

    # ---- scenario 1: live run, provider declines
    s, rb = make_request("Flow test: planner B")
    check("create request B", s == 201, (s, rb))
    s, live = call("POST", "/admin/planner/run", admin, json={"request_ids": [rb["id"]], "dry_run": False})
    check("live run assigns request B to the test provider",
          s == 201 and live["status"] == "confirmed" and len(live["assignments"]) == 1
          and live["assignments"][0]["provider_id"] == pid, (s, live))
    s, lst = call("GET", "/provider/assignments", provider)
    mine = next((i for i in (lst or {}).get("items", []) if i["request_id"] == rb["id"]), None)
    check("provider sees the assignment with request summary", s == 200 and mine and mine["request"]["title"], (s, lst))
    if mine:
        s, b = call("POST", f"/provider/assignments/{mine['id']}/decline", provider)
        check("provider declines", s == 200 and b["status"] == "declined", (s, b))
        s, b = call("POST", f"/provider/assignments/{mine['id']}/decline", provider)
        check("declining twice -> 409", s == 409, (s, b))
    s, b = call("GET", f"/requests/{rb['id']}", customer)
    check("declined request stays open", s == 200 and b["status"] == "open", (s, b))

    # ---- scenario 2: dry run, confirm, provider accepts
    s, ra = make_request("Flow test: planner A")
    s, dry = call("POST", "/admin/planner/run", admin, json={"request_ids": [ra["id"]]})
    check("dry run proposes the test provider",
          s == 201 and dry["status"] == "dry_run" and len(dry["assignments"]) == 1
          and dry["assignments"][0]["provider_id"] == pid, (s, dry))
    s, lst = call("GET", "/provider/assignments", provider)
    check("dry run is invisible to providers", s == 200 and not any(i["request_id"] == ra["id"] for i in lst["items"]), (s, lst))
    s, b = call("GET", f"/admin/planner/runs/{dry['run_id']}", admin)
    check("admin reads the run back", s == 200 and b["run_id"] == dry["run_id"] and len(b["assignments"]) == 1, (s, b))
    s, b = call("GET", f"/admin/planner/runs/{uuid.uuid4()}", admin)
    check("unknown run -> 404", s == 404, (s, b))
    s, b = call("POST", f"/admin/planner/runs/{dry['run_id']}/confirm", customer)
    check("customer cannot confirm a run -> 403", s == 403, (s, b))

    _, cursor = call("GET", "/updates?after_id=latest", provider)
    s, conf = call("POST", f"/admin/planner/runs/{dry['run_id']}/confirm", admin)
    check("admin confirms the run", s == 200 and conf["status"] == "confirmed" and conf["dropped"] == [], (s, conf))
    s, b = call("POST", f"/admin/planner/runs/{dry['run_id']}/confirm", admin)
    check("confirming twice -> 409", s == 409, (s, b))
    s, b = call("GET", f"/updates?after_id={cursor['last_id']}", provider)
    check("provider /updates feed shows planner.assigned",
          s == 200 and any(e["type"] == "planner.assigned" for e in b["events"]), (s, b))

    s, lst = call("GET", "/provider/assignments", provider)
    mine = next((i for i in (lst or {}).get("items", []) if i["request_id"] == ra["id"]), None)
    check("assignment is now visible to the provider", mine is not None, (s, lst))
    if mine:
        s, bk = call("POST", f"/provider/assignments/{mine['id']}/accept", provider)
        check("provider accepts -> booking without an offer",
              s == 201 and bk["status"] == "confirmed" and bk["offer_id"] is None, (s, bk))
        s, b = call("POST", f"/provider/assignments/{mine['id']}/accept", provider)
        check("accepting twice -> 409", s == 409, (s, b))
    s, b = call("GET", f"/requests/{ra['id']}", customer)
    check("request became booked", s == 200 and b["status"] == "booked", (s, b))
    s, b = call("GET", "/provider/dashboard", provider)
    check("dashboard counts the upcoming booking", s == 200 and b["upcoming_bookings"] >= 1, (s, b))


try:
    run_tests()
finally:
    for rid in created:
        call("POST", f"/requests/{rid}/cancel", customer)
    call("PUT", "/me/provider-profile", provider, json={
        "categories": original.get("categories") or ["plumbing"],
        "lat": original.get("lat") or 12.9716, "lng": original.get("lng") or 77.5946,
        "service_radius_km": original.get("service_radius_km") or 20, "bio": original.get("bio")})
    call("POST", "/provider/mode", provider, json={"mode": original.get("mode") or "independent"})
    print("\n(cleanup: test requests cancelled, provider profile restored)")

print(f"{sum(results)} passed, {len(results) - sum(results)} failed")
sys.exit(0 if all(results) else 1)