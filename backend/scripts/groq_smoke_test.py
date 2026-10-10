"""Checks that the Groq key and the chosen models work.

Run from the backend folder:
    python scripts/groq_smoke_test.py
    python scripts/groq_smoke_test.py path\\to\\small_photo.jpg   (also tests vision)
"""
import base64
import json
import mimetypes
import os
import sys
import time

from dotenv import load_dotenv
from groq import Groq

load_dotenv()

api_key = os.getenv("GROQ_API_KEY")
chat_model = os.getenv("GROQ_CHAT_MODEL")
vision_model = os.getenv("GROQ_VISION_MODEL")

if not api_key or not chat_model:
    sys.exit("Set GROQ_API_KEY and GROQ_CHAT_MODEL in backend/.env first.")

client = Groq(api_key=api_key, timeout=60)


def run(label, fn):
    start = time.time()
    try:
        result = fn()
        print(f"[PASS] {label} ({time.time() - start:.1f}s)\n       {result}\n")
    except Exception as exc:  # noqa: BLE001 - this is a diagnostic script
        print(f"[FAIL] {label}: {type(exc).__name__}: {exc}\n")


def structured_intake():
    schema = {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "enum": ["plumbing", "electrical", "carpentry", "appliance_repair",
                         "cleaning", "painting", "pest_control", "other"],
            },
            "title": {"type": "string"},
            "severity_score": {"type": "integer"},
        },
        "required": ["category", "title", "severity_score"],
        "additionalProperties": False,
    }
    resp = client.chat.completions.create(
        model=chat_model,
        messages=[
            {"role": "system", "content": "Turn the customer's message into a service request. "
                                          "severity_score is 0 (trivial) to 100 (emergency)."},
            {"role": "user", "content": "The pipe under my kitchen sink is leaking and water "
                                        "is spreading across the floor."},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "intake", "schema": schema},
        },
        max_completion_tokens=2000,
    )
    return json.loads(resp.choices[0].message.content)


def translation():
    resp = client.chat.completions.create(
        model=chat_model,
        messages=[
            {"role": "system", "content": "Translate to Hindi. Reply with the translation only."},
            {"role": "user", "content": "A plumber will arrive tomorrow between 10 and 11."},
        ],
        max_completion_tokens=2000,
    )
    return resp.choices[0].message.content.strip()


def vision(path):
    mime = mimetypes.guess_type(path)[0] or "image/jpeg"
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    resp = client.chat.completions.create(
        model=vision_model,
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": "In one sentence, what does this photo show?"},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{data}"}},
            ],
        }],
        max_completion_tokens=2000,
    )
    return resp.choices[0].message.content.strip()


run(f"Structured intake ({chat_model})", structured_intake)
run(f"Translation to Hindi ({chat_model})", translation)

if len(sys.argv) > 1 and vision_model:
    run(f"Vision ({vision_model})", lambda: vision(sys.argv[1]))
else:
    print("(Vision test skipped: pass an image path to run it.)")