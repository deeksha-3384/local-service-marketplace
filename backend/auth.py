import logging
import uuid
from dataclasses import dataclass
from functools import wraps

import jwt
from flask import current_app, g, request
from jwt import PyJWKClient
from jwt.exceptions import (
    ExpiredSignatureError,
    InvalidTokenError,
    PyJWKClientConnectionError,
    PyJWKClientError,
)
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from errors import ApiError
from extensions import db

log = logging.getLogger(__name__)

# Pinned on purpose: never trust the algorithm named inside the token.
ALLOWED_ALGORITHMS = ["ES256"]
VALID_ROLES = {"customer", "provider", "admin"}

_jwks_client = None
_jwks_client_url = None


@dataclass(frozen=True)
class CurrentUser:
    id: str
    role: str
    full_name: str
    language: str
    claims: dict


def _jwks_url():
    cfg = current_app.config
    if cfg.get("SUPABASE_JWKS_URL"):
        return cfg["SUPABASE_JWKS_URL"]
    if cfg.get("SUPABASE_URL"):
        return f"{cfg['SUPABASE_URL']}/auth/v1/.well-known/jwks.json"
    raise ApiError(
        503, "AUTH_NOT_CONFIGURED", "Authentication is not configured on the server."
    )


def _get_signing_key(token):
    """Public key matching the token's kid. Cached; refreshed if the kid is unknown."""
    global _jwks_client, _jwks_client_url
    url = _jwks_url()
    if _jwks_client is None or _jwks_client_url != url:
        _jwks_client = PyJWKClient(url, cache_keys=True, lifespan=600, timeout=10)
        _jwks_client_url = url
    return _jwks_client.get_signing_key_from_jwt(token).key


def bearer_token():
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise ApiError(
            401, "UNAUTHENTICATED", "Missing or malformed Authorization header."
        )
    return token.strip()


def verify_token(token):
    """Return the verified claims or raise ApiError(401/503)."""
    cfg = current_app.config
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") not in ALLOWED_ALGORITHMS:
            raise ApiError(401, "UNAUTHENTICATED", "Unsupported token algorithm.")

        key = _get_signing_key(token)

        extra = {}
        if cfg.get("SUPABASE_URL"):
            extra["issuer"] = f"{cfg['SUPABASE_URL']}/auth/v1"

        return jwt.decode(
            token,
            key,
            algorithms=ALLOWED_ALGORITHMS,
            audience=cfg["JWT_AUDIENCE"],
            leeway=cfg["JWT_LEEWAY_SECONDS"],
            options={"require": ["exp", "sub", "aud"]},
            **extra,
        )
    except ExpiredSignatureError:
        raise ApiError(401, "UNAUTHENTICATED", "Your session has expired. Please log in again.")
    except PyJWKClientConnectionError:
        log.error("Could not reach the JWKS endpoint")
        raise ApiError(503, "AUTH_UNAVAILABLE", "Authentication service is temporarily unavailable.")
    except PyJWKClientError:
        raise ApiError(401, "UNAUTHENTICATED", "Invalid token.")
    except InvalidTokenError as exc:
        log.info("Rejected token: %s", exc.__class__.__name__)
        raise ApiError(401, "UNAUTHENTICATED", "Invalid token.")


def _load_profile(user_id):
    """Role comes from the database (source of truth), not from the token."""
    if not db.configured:
        raise ApiError(503, "DB_NOT_CONFIGURED", "DATABASE_URL is not set.")
    try:
        row = (
            db.session.execute(
                text(
                    "SELECT id, role::text AS role, full_name, language, is_active "
                    "FROM profiles WHERE id = :id"
                ),
                {"id": user_id},
            )
            .mappings()
            .first()
        )
    except SQLAlchemyError:
        log.exception("Profile lookup failed")
        raise ApiError(503, "DB_UNAVAILABLE", "Cannot reach the database.")
    return dict(row) if row else None


def authenticate():
    claims = verify_token(bearer_token())

    try:
        user_id = uuid.UUID(str(claims["sub"]))
    except ValueError:
        raise ApiError(401, "UNAUTHENTICATED", "Invalid token.")

    profile = _load_profile(user_id)
    if profile is None:
        raise ApiError(403, "PROFILE_NOT_FOUND", "No profile exists for this account.")
    if not profile["is_active"]:
        raise ApiError(403, "ACCOUNT_DISABLED", "This account has been disabled.")
    if profile["role"] not in VALID_ROLES:
        raise ApiError(403, "FORBIDDEN", "Your account has no valid role.")

    return CurrentUser(
        id=str(user_id),
        role=profile["role"],
        full_name=profile.get("full_name") or "",
        language=profile.get("language") or "en",
        claims=claims,
    )


def require_auth(*roles):
    """@require_auth() = any logged-in user. @require_auth('admin') = admins only."""
    unknown = set(roles) - VALID_ROLES
    if unknown:
        raise ValueError(f"Unknown roles: {unknown}")

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = authenticate()
            if roles and user.role not in roles:
                raise ApiError(
                    403, "FORBIDDEN", "You do not have permission to perform this action."
                )
            g.current_user = user
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def current_user():
    return g.current_user