"""AI and upload checks against the real API (uses a little free Groq quota).
Start the server first, then:
    python scripts/ai_flow_test.py
    python scripts/ai_flow_test.py --photo "C:\\path\\photo.jpg" --audio "C:\\path\\voice.m4a"
    python scripts/ai_flow_test.py --url https://your-app.onrender.com
"""
import argparse
import mimetypes
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:5000")
parser.add_argument("--photo")
parser.add_argument("--audio")
args = parser.parse_args()

BASE = args.url.rstrip("/") + "/api/v1"
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
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
    r = requests.request(method, BASE + path, headers=headers, timeout=120, **kwargs)
    try:
        body = r.json()
    except ValueError:
        body = None
    return r.status_code, body


customer, provider = login("CUSTOMER"), login("PROVIDER")
print(f"Testing {BASE}\n")

FALLBACK_DIAGNOSIS = {
    "summary": "Test.", "probable_causes": [{"label": "Worn part", "confidence": 0.5}],
    "recommended_category": "plumbing", "severity_score": 40, "meter_level": "medium",
    "estimated_duration_minutes": 60, "safety_warning": None, "follow_up_questions": [], "language": "en"}

s, b = call("POST", "/translate", None, json={"text": "hello", "target_lang": "hi"})
check("translate without a token -> 401", s == 401, (s, b))
s, b = call("POST", "/translate", customer, json={"text": "A plumber will arrive tomorrow.", "target_lang": "hi"})
check("translate to Hindi", s == 200 and b["text"] and b["target_lang"] == "hi", (s, b))
s, b = call("POST", "/translate", customer, json={"text": "A plumber will arrive tomorrow.", "target_lang": "hi"})
check("same translation again (cached)", s == 200 and b["text"], (s, b))
s, b = call("POST", "/translate", provider, json={"text": "Water is leaking.", "target_lang": "hi"})
check("providers can translate too", s == 200 and b["text"], (s, b))
s, b = call("POST", "/translate", customer, json={"text": "hello", "target_lang": "xx"})
check("unsupported language -> 422", s == 422, (s, b))

time.sleep(4)
s, diag = call("POST", "/intake/diagnose", customer,
               json={"description": "The kitchen tap drips all night and the cabinet below is damp."})
keys = {"summary", "probable_causes", "recommended_category", "severity_score", "meter_level",
        "estimated_duration_minutes", "safety_warning", "follow_up_questions", "language"}
check("diagnose returns the contract shape", s == 200 and keys <= set(diag or {}), (s, diag))
s, b = call("POST", "/intake/diagnose", customer, json={"description": "   "})
check("empty description -> 422", s == 422, (s, b))
s, b = call("POST", "/intake/photo", provider, files={"photo": ("x.jpg", b"\xff\xd8\xff", "image/jpeg")})
check("provider cannot upload photos -> 403", s == 403, (s, b))
s, b = call("POST", "/intake/photo", customer, files={"photo": ("fake.jpg", b"this is not an image", "image/jpeg")})
check("fake image is rejected -> 415", s == 415, (s, b))
s, b = call("POST", "/intake/voice", customer, files={"audio": ("fake.webm", b"this is not audio", "audio/webm")})
check("fake audio is rejected -> 415", s == 415, (s, b))

if args.photo:
    p = Path(args.photo)
    time.sleep(6)
    s, b = call("POST", "/intake/photo", customer,
                files={"photo": (p.name, p.read_bytes(), mimetypes.guess_type(p.name)[0] or "image/jpeg")},
                data={"language": "en"})
    if check("photo upload returns media_id and url", s == 200 and b.get("media_id") and b.get("url"), (s, b)):
        print(f"       analysis: {b.get('analysis')}")
        img = requests.get(b["url"], timeout=30)
        check("signed photo URL downloads", img.status_code == 200 and len(img.content) > 0, img.status_code)
        s, req = call("POST", "/requests", customer, json={
            "category": "plumbing", "title": "AI test: photo", "description": "Automated photo test",
            "lat": 12.9720, "lng": 77.5950, "language": "en",
            "media_ids": [b["media_id"]], "diagnosis": diag if s == 200 and isinstance(diag, dict) and keys <= set(diag) else FALLBACK_DIAGNOSIS})
        check("request created with the photo attached", s == 201, (s, req))
        if s == 201:
            s, det = call("GET", f"/requests/{req['id']}", customer)
            items = (det or {}).get("media") or []
            check("request detail returns the photo with a signed URL",
                  s == 200 and len(items) == 1 and items[0].get("url"), (s, det))
            call("POST", f"/requests/{req['id']}/cancel", customer)

if args.audio:
    p = Path(args.audio)
    time.sleep(6)
    s, b = call("POST", "/intake/voice", customer,
                files={"audio": (p.name, p.read_bytes(), mimetypes.guess_type(p.name)[0] or "audio/mpeg")},
                data={"language": "en"})
    check("voice upload returns transcript and draft", s == 200 and b.get("transcript") and b.get("draft"), (s, b))
    if s == 200:
        print(f"       transcript: {b['transcript'][:120]}")
        print(f"       draft: {b['draft']}")
        print(f"       media_id: {b.get('media_id')}")

print(f"\n{sum(results)} passed, {len(results) - sum(results)} failed")
sys.exit(0 if all(results) else 1)