import logging
from datetime import datetime, timezone

from flask import Blueprint, jsonify
from sqlalchemy import text

from errors import ApiError
from extensions import db

log = logging.getLogger(__name__)
bp = Blueprint("health", __name__)


@bp.get("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "service": "local-service-marketplace-api",
            "time": datetime.now(timezone.utc).isoformat(),
        }
    )


@bp.get("/health/db")
def health_db():
    if not db.configured:
        raise ApiError(503, "DB_NOT_CONFIGURED", "DATABASE_URL is not set.")
    try:
        db.session.execute(text("SELECT 1"))
    except Exception:
        log.exception("Database health check failed")
        raise ApiError(503, "DB_UNAVAILABLE", "Cannot reach the database.")
    return jsonify({"status": "ok", "database": "connected"})