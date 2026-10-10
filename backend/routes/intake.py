from functools import lru_cache
from uuid import UUID, uuid4

from flask import Blueprint, current_app, jsonify, request
from pydantic import Field, field_validator

from auth import current_user, require_auth
from db_utils import commit, fetch_one, run
from errors import ApiError
from extensions import db
from rate_limit import check_rate
from services import diagnosis as dg
from services import groq_client, media, storage
from services.access import forbidden
from validation import Schema, parse_body

bp = Blueprint("intake", __name__)

VISION_MAX_BYTES = 3 * 1024 * 1024  # base64 grows ~33%; stay well under Groq's image limits
MAX_PHOTOS_PER_REQUEST = 4


def _read_upload(field, limit_mb):
    file = request.files.get(field)
    if file is None:
        raise ApiError(
            422, "VALIDATION_ERROR", f"Missing file field '{field}'.",
            [{"field": field, "message": "required (multipart/form-data)"}],
        )
    limit = limit_mb * 1024 * 1024
    data = file.read(limit + 1)
    if not data:
        raise ApiError(422, "VALIDATION_ERROR", "The uploaded file is empty.", [{"field": field, "message": "empty"}])
    if len(data) > limit:
        raise ApiError(413, "FILE_TOO_LARGE", f"Files can be at most {limit_mb} MB.")
    return data


def _store_media(user, kind, data, ext, mime, request_id=None, strict=True):
    media_id = uuid4()
    bucket = storage.BUCKETS[kind]
    path = f"{user.id}/{media_id}.{ext}"
    try:
        storage.upload(bucket, path, data, mime)
    except storage.StorageUnavailable:
        if strict:
            raise
        return None
    try:
        run(
            "INSERT INTO request_media (id, request_id, owner_id, kind, storage_path, mime, size_bytes) "
            "VALUES (:id, :rid, :oid, CAST(:kind AS media_kind), :path, :mime, :size)",
            {"id": media_id, "rid": request_id, "oid": user.id, "kind": kind,
             "path": path, "mime": mime, "size": len(data)},
        )
        commit()
    except Exception:
        db.session.rollback()
        storage.delete(bucket, path)
        raise
    return media_id


def _language(raw, user):
    if raw and dg.known_language(raw) is None:
        raise ApiError(422, "VALIDATION_ERROR", "Unsupported language.",
                       [{"field": "language", "message": "must be one of: " + ", ".join(sorted(dg.LANGUAGE_NAMES))}])
    return dg.normalize_language(raw or user.language)


@bp.post("/intake/voice")
@require_auth("customer")
def intake_voice():
    user = current_user()
    check_rate(f"upload:{user.id}", 20, 600)
    check_rate(f"ai:{user.id}", 10, 60)
    language = _language(request.form.get("language"), user)
    data = _read_upload("audio", current_app.config["MAX_AUDIO_MB"])
    kind = media.sniff_audio(data)
    if kind is None:
        raise ApiError(415, "UNSUPPORTED_MEDIA", "Unsupported audio format (use webm, m4a/mp4, ogg, wav or mp3).")
    ext, mime = kind

    db.session.rollback()  # release the DB connection while the AI works
    transcript = groq_client.transcribe_audio(f"audio.{ext}", data)  # language is auto-detected
    try:
        result = groq_client.analyze_text(transcript, language)
        draft, diagnosis = result.to_draft(), result.to_diagnosis(language)
    except groq_client.AIUnavailable:
        draft = {"category": "other", "title": transcript[:80], "description": transcript,
                 "severity_score": None, "meter_level": None}
        diagnosis = None

    media_id = _store_media(user, "audio", data, ext, mime, strict=False)
    return jsonify({"media_id": media_id, "transcript": transcript, "draft": draft, "diagnosis": diagnosis})


@bp.post("/intake/photo")
@require_auth("customer")
def intake_photo():
    user = current_user()
    check_rate(f"upload:{user.id}", 20, 600)
    check_rate(f"ai:{user.id}", 10, 60)
    language = _language(request.form.get("language"), user)

    rid = None
    raw_rid = request.form.get("request_id")
    if raw_rid:
        try:
            rid = UUID(raw_rid)
        except ValueError:
            raise ApiError(422, "VALIDATION_ERROR", "Invalid request_id.", [{"field": "request_id", "message": "must be a UUID"}])
        req = fetch_one("SELECT customer_id, status::text AS status FROM requests WHERE id = :id", {"id": rid})
        if req is None:
            raise ApiError(404, "NOT_FOUND", "Request not found.")
        if str(req["customer_id"]) != user.id:
            raise forbidden()
        if req["status"] not in ("open", "offers_received"):
            raise ApiError(409, "INVALID_STATE", "Photos can only be added to an open request.")
        count = fetch_one(
            "SELECT count(*) AS n FROM request_media WHERE request_id = :rid AND kind = 'photo'", {"rid": rid}
        )["n"]
        if count >= MAX_PHOTOS_PER_REQUEST:
            raise ApiError(409, "INVALID_STATE", f"A request can have at most {MAX_PHOTOS_PER_REQUEST} photos.")

    data = _read_upload("photo", current_app.config["MAX_PHOTO_MB"])
    kind = media.sniff_image(data)
    if kind is None:
        raise ApiError(415, "UNSUPPORTED_MEDIA", "Photos must be JPEG, PNG or WebP.")
    ext, mime = kind

    db.session.rollback()
    analysis = None
    if len(data) <= VISION_MAX_BYTES:
        try:
            analysis = groq_client.analyze_photo(data, mime, language)
        except groq_client.AIUnavailable:
            analysis = None

    media_id = _store_media(user, "photo", data, ext, mime, rid, strict=True)
    url = storage.signed_url(storage.BUCKETS["photo"], f"{user.id}/{media_id}.{ext}")
    return jsonify({"media_id": media_id, "url": url, "analysis": analysis})


class DiagnoseBody(Schema):
    description: str = Field(min_length=1, max_length=2000)
    transcript: str | None = Field(default=None, max_length=4000)
    media_ids: list[UUID] = Field(default_factory=list, max_length=5)
    photo_notes: list[str] = Field(default_factory=list, max_length=4)
    language: str | None = None

    @field_validator("language")
    @classmethod
    def _lang(cls, v):
        if v is not None and dg.known_language(v) is None:
            raise ValueError("unsupported language")
        return v


@bp.post("/intake/diagnose")
@require_auth()
def intake_diagnose():
    user = current_user()
    body = parse_body(DiagnoseBody)
    check_rate(f"ai:{user.id}", 10, 60)
    language = dg.normalize_language(body.language or user.language)
    text = "\n".join(part for part in (body.description, body.transcript) if part)
    db.session.rollback()
    result = groq_client.analyze_text(text, language, body.photo_notes)
    return jsonify(result.to_diagnosis(language))


class TranslateBody(Schema):
    text: str = Field(min_length=1, max_length=2000)
    target_lang: str


@lru_cache(maxsize=500)
def _translate_cached(text, code):
    return groq_client.translate(text, code)


@bp.post("/translate")
@require_auth()
def translate():
    user = current_user()
    body = parse_body(TranslateBody)
    code = dg.known_language(body.target_lang)
    if code is None:
        raise ApiError(422, "VALIDATION_ERROR", "Unsupported target language.",
                       [{"field": "target_lang", "message": "must be one of: " + ", ".join(sorted(dg.LANGUAGE_NAMES))}])
    check_rate(f"tr:{user.id}", 30, 60)
    db.session.rollback()
    return jsonify({"text": _translate_cached(body.text, code), "target_lang": code})