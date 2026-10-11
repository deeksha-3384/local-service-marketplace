from typing import Literal

from flask import Blueprint, jsonify
from pydantic import Field, field_validator

from auth import current_user, require_auth
from db_utils import commit, fetch_one, run
from errors import ApiError
from services import diagnosis as dg
from validation import Schema, parse_body

bp = Blueprint("me", __name__)

PROFILE_SQL = (
    "SELECT id, role::text AS role, full_name, phone, language, is_active, created_at "
    "FROM profiles WHERE id = :id"
)
PROVIDER_SQL = (
    "SELECT user_id, categories, lat, lng, service_radius_km, mode::text AS mode, "
    "rating, rating_count, is_verified, bio FROM provider_profiles WHERE user_id = :id"
)


class ProfileUpdate(Schema):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, pattern=r"^[0-9+\-\s()]{6,20}$")
    language: str | None = None

    @field_validator("language")
    @classmethod
    def _language(cls, v):
        if v is None:
            return v
        code = dg.known_language(v)
        if code is None:
            raise ValueError("unsupported language")
        return code


class ProviderProfileUpdate(Schema):
    categories: list[str] = Field(min_length=1, max_length=8)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    service_radius_km: float = Field(gt=0, le=500)
    bio: str | None = Field(default=None, max_length=500)

    @field_validator("categories")
    @classmethod
    def _categories(cls, values):
        cleaned = []
        for value in values:
            value = value.strip().lower()
            if value not in dg.CATEGORIES:
                raise ValueError("must be one of: " + ", ".join(dg.CATEGORIES))
            if value not in cleaned:
                cleaned.append(value)
        return cleaned


class ModeUpdate(Schema):
    mode: Literal["independent", "planner"]


@bp.get("/me")
@require_auth()
def get_me():
    user = current_user()
    profile = fetch_one(PROFILE_SQL, {"id": user.id})
    provider = fetch_one(PROVIDER_SQL, {"id": user.id}) if user.role == "provider" else None
    return jsonify({"profile": profile, "provider_profile": provider})


@bp.patch("/me")
@require_auth()
def update_me():
    user = current_user()
    body = parse_body(ProfileUpdate)
    data = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not data:
        raise ApiError(422, "VALIDATION_ERROR", "Nothing to update.")
    # Column names come from the model fields above (extra fields are rejected), never from the client.
    assignments = ", ".join(f"{column} = :{column}" for column in data)
    run(f"UPDATE profiles SET {assignments} WHERE id = :id", {**data, "id": user.id})
    commit()
    return jsonify(fetch_one(PROFILE_SQL, {"id": user.id}))


@bp.put("/me/provider-profile")
@require_auth("provider")
def put_provider_profile():
    user = current_user()
    body = parse_body(ProviderProfileUpdate)
    run(
        """
        INSERT INTO provider_profiles
            (user_id, categories, lat, lng, service_radius_km, mode, rating, rating_count, is_verified, bio)
        VALUES
            (:uid, CAST(:categories AS text[]), :lat, :lng, :radius, 'independent', 0, 0, false, :bio)
        ON CONFLICT (user_id) DO UPDATE SET
            categories = EXCLUDED.categories,
            lat = EXCLUDED.lat,
            lng = EXCLUDED.lng,
            service_radius_km = EXCLUDED.service_radius_km,
            bio = EXCLUDED.bio
        """,
        {
            "uid": user.id,
            "categories": body.categories,
            "lat": body.lat,
            "lng": body.lng,
            "radius": body.service_radius_km,
            "bio": body.bio,
        },
    )
    commit()
    return jsonify(fetch_one(PROVIDER_SQL, {"id": user.id}))


@bp.post("/provider/mode")
@require_auth("provider")
def set_provider_mode():
    user = current_user()
    body = parse_body(ModeUpdate)
    profile = fetch_one(PROVIDER_SQL, {"id": user.id})
    if profile is None:
        raise ApiError(422, "VALIDATION_ERROR", "Complete your provider profile first.")
    if body.mode == "planner" and (
        profile["lat"] is None or profile["lng"] is None or not profile["categories"]
    ):
        raise ApiError(
            422, "VALIDATION_ERROR",
            "Set your location and categories before joining planner mode.",
            [{"field": "mode", "message": "location and categories are required for planner mode"}],
        )
    run(
        "UPDATE provider_profiles SET mode = CAST(:mode AS provider_mode) WHERE user_id = :id",
        {"mode": body.mode, "id": user.id},
    )
    commit()
    return jsonify(fetch_one(PROVIDER_SQL, {"id": user.id}))