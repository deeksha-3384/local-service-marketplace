import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.exceptions import PyJWKClientConnectionError

import auth
from app import create_app
from config import Config

ISSUER = "https://test.supabase.co/auth/v1"
USER_ID = str(uuid.uuid4())
PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_KEY = ec.generate_private_key(ec.SECP256R1())


class FakeConfig(Config):
    TESTING = True
    DEBUG = True
    SUPABASE_URL = "https://test.supabase.co"
    SUPABASE_JWKS_URL = ""
    DATABASE_URL = ""


def make_token(key=PRIVATE_KEY, alg="ES256", **overrides):
    now = int(time.time())
    payload = {
        "sub": USER_ID,
        "aud": "authenticated",
        "iss": ISSUER,
        "iat": now,
        "exp": now + 3600,
        "email": "a@example.com",
    }
    payload.update(overrides)
    return jwt.encode(payload, key, algorithm=alg, headers={"kid": "test-key"})


def hdr(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def profile(monkeypatch):
    state = {"role": "customer", "is_active": True, "exists": True}

    def fake_load(user_id):
        if not state["exists"]:
            return None
        return {
            "id": str(user_id),
            "role": state["role"],
            "full_name": "Test User",
            "language": "en",
            "is_active": state["is_active"],
        }

    monkeypatch.setattr(auth, "_load_profile", fake_load)
    return state


@pytest.fixture()
def client(monkeypatch, profile):
    monkeypatch.setattr(auth, "_get_signing_key", lambda token: PRIVATE_KEY.public_key())
    app = create_app(FakeConfig)

    app.add_url_rule("/api/v1/_t/any", "t_any", auth.require_auth()(lambda: {"ok": True}))
    app.add_url_rule(
        "/api/v1/_t/customer", "t_customer", auth.require_auth("customer")(lambda: {"ok": True})
    )
    app.add_url_rule(
        "/api/v1/_t/admin", "t_admin", auth.require_auth("admin")(lambda: {"ok": True})
    )
    app.add_url_rule(
        "/api/v1/_t/multi",
        "t_multi",
        auth.require_auth("provider", "admin")(lambda: {"ok": True}),
    )
    return app.test_client()


def error_code(response):
    return response.get_json()["error"]["code"]


# ---- token verification ----

def test_valid_token_is_accepted(client):
    r = client.get("/api/v1/_dev/claims", headers=hdr(make_token()))
    assert r.status_code == 200
    assert r.get_json()["sub"] == USER_ID


@pytest.mark.parametrize(
    "token",
    [
        make_token(exp=int(time.time()) - 100),
        make_token(aud="something-else"),
        make_token(iss="https://evil.example.com/auth/v1"),
        make_token(key=OTHER_KEY),
        make_token(key="x" * 40, alg="HS256"),
        "not.a.jwt",
    ],
    ids=["expired", "wrong_audience", "wrong_issuer", "bad_signature", "hs256_rejected", "garbage"],
)
def test_bad_tokens_are_rejected(client, token):
    r = client.get("/api/v1/_dev/claims", headers=hdr(token))
    assert r.status_code == 401
    assert error_code(r) == "UNAUTHENTICATED"


@pytest.mark.parametrize("header", [None, "Basic abc", "Bearer", "Bearer   "])
def test_missing_or_malformed_header(client, header):
    headers = {"Authorization": header} if header else {}
    r = client.get("/api/v1/_dev/claims", headers=headers)
    assert r.status_code == 401
    assert error_code(r) == "UNAUTHENTICATED"


def test_jwks_outage_gives_503(client, monkeypatch):
    def boom(token):
        raise PyJWKClientConnectionError("down")

    monkeypatch.setattr(auth, "_get_signing_key", boom)
    r = client.get("/api/v1/_dev/claims", headers=hdr(make_token()))
    assert r.status_code == 503
    assert error_code(r) == "AUTH_UNAVAILABLE"


# ---- roles ----

def test_any_logged_in_user_passes(client):
    assert client.get("/api/v1/_t/any", headers=hdr(make_token())).status_code == 200


def test_non_uuid_subject_rejected(client):
    r = client.get("/api/v1/_t/any", headers=hdr(make_token(sub="not-a-uuid")))
    assert r.status_code == 401


def test_customer_cannot_use_admin_route(client, profile):
    profile["role"] = "customer"
    r = client.get("/api/v1/_t/admin", headers=hdr(make_token()))
    assert r.status_code == 403
    assert error_code(r) == "FORBIDDEN"


def test_admin_can_use_admin_route(client, profile):
    profile["role"] = "admin"
    assert client.get("/api/v1/_t/admin", headers=hdr(make_token())).status_code == 200


def test_multi_role_route(client, profile):
    profile["role"] = "provider"
    assert client.get("/api/v1/_t/multi", headers=hdr(make_token())).status_code == 200
    profile["role"] = "customer"
    assert client.get("/api/v1/_t/multi", headers=hdr(make_token())).status_code == 403


def test_disabled_account_blocked(client, profile):
    profile["is_active"] = False
    r = client.get("/api/v1/_t/any", headers=hdr(make_token()))
    assert r.status_code == 403
    assert error_code(r) == "ACCOUNT_DISABLED"


def test_missing_profile_blocked(client, profile):
    profile["exists"] = False
    r = client.get("/api/v1/_t/any", headers=hdr(make_token()))
    assert r.status_code == 403
    assert error_code(r) == "PROFILE_NOT_FOUND"


def test_unknown_role_blocked(client, profile):
    profile["role"] = "superuser"
    assert client.get("/api/v1/_t/any", headers=hdr(make_token())).status_code == 403