from flask import Blueprint, jsonify

from auth import bearer_token, verify_token

bp = Blueprint("dev", __name__)


@bp.get("/_dev/claims")
def claims():
    """Development only: shows what a verified token contains. No database needed."""
    c = verify_token(bearer_token())
    return jsonify(
        {
            "sub": c["sub"],
            "email": c.get("email"),
            "issuer": c.get("iss"),
            "expires_at": c["exp"],
            "app_metadata": c.get("app_metadata"),
        }
    )