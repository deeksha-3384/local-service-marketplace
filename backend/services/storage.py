import logging

import requests
from flask import current_app

from errors import ApiError

log = logging.getLogger(__name__)

BUCKETS = {"audio": "request-audio", "photo": "request-photos"}
SIGNED_URL_SECONDS = 3600


class StorageUnavailable(ApiError):
    def __init__(self):
        super().__init__(503, "STORAGE_UNAVAILABLE", "File storage is temporarily unavailable.")


def _config():
    cfg = current_app.config
    base, key = cfg.get("SUPABASE_URL", ""), cfg.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        raise StorageUnavailable()
    return base, key


def _headers(key, extra=None):
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    if extra:
        headers.update(extra)
    return headers


def upload(bucket, path, data, mime):
    base, key = _config()
    try:
        resp = requests.post(
            f"{base}/storage/v1/object/{bucket}/{path}",
            headers=_headers(key, {"Content-Type": mime, "x-upsert": "false"}),
            data=data,
            timeout=30,
        )
    except requests.RequestException:
        log.exception("Storage upload failed (network)")
        raise StorageUnavailable()
    if resp.status_code not in (200, 201):
        log.error("Storage upload rejected: HTTP %s %s", resp.status_code, resp.text[:200])
        raise StorageUnavailable()


def signed_url(bucket, path):
    """Temporary download link, or None if signing fails (never breaks the caller)."""
    try:
        base, key = _config()
        resp = requests.post(
            f"{base}/storage/v1/object/sign/{bucket}/{path}",
            headers=_headers(key, {"Content-Type": "application/json"}),
            json={"expiresIn": SIGNED_URL_SECONDS},
            timeout=8,
        )
        resp.raise_for_status()
        signed = resp.json().get("signedURL") or ""
    except (requests.RequestException, ValueError, ApiError):
        log.warning("Could not sign a storage URL")
        return None
    if not signed:
        return None
    if signed.startswith("http"):
        return signed
    if signed.startswith("/storage/v1"):
        return base + signed
    return f"{base}/storage/v1{signed}"


def delete(bucket, path):
    """Best effort cleanup of an orphaned file."""
    try:
        base, key = _config()
        requests.delete(f"{base}/storage/v1/object/{bucket}/{path}", headers=_headers(key), timeout=10)
    except Exception:  # noqa: BLE001
        log.warning("Could not delete an orphaned storage object")