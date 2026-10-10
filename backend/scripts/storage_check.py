import base64
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests  # noqa: E402

from app import app  # noqa: E402
from services import storage  # noqa: E402

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

with app.app_context():
    bucket = storage.BUCKETS["photo"]
    path = f"healthcheck/{uuid.uuid4()}.png"
    try:
        storage.upload(bucket, path, PNG, "image/png")
        print("[PASS] upload")
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"[FAIL] upload: {exc}  (see the log line above for the HTTP status)")

    url = storage.signed_url(bucket, path)
    if not url:
        sys.exit("[FAIL] signed URL could not be created")
    print("[PASS] signed URL created")

    resp = requests.get(url, timeout=20)
    print(f"[{'PASS' if resp.status_code == 200 and resp.content == PNG else 'FAIL'}] download via signed URL (HTTP {resp.status_code})")

    storage.delete(bucket, path)
    print("[PASS] cleanup requested")