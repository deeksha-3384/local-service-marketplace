import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
# Real environment variables (e.g. on Render) always win over .env
load_dotenv(BASE_DIR / ".env")


def _list(name, default=""):
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


class Config:
    APP_ENV = os.getenv("APP_ENV", "development").lower()
    DEBUG = APP_ENV == "development"
    SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "dev-only-change-me")

    DATABASE_URL = os.getenv("DATABASE_URL", "")
    SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
    SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    SUPABASE_JWKS_URL = os.getenv("SUPABASE_JWKS_URL", "")
    JWT_AUDIENCE = os.getenv("JWT_AUDIENCE", "authenticated")
    JWT_LEEWAY_SECONDS = int(os.getenv("JWT_LEEWAY_SECONDS", "10"))

    GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
    GROQ_STT_MODEL = os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo")
    GROQ_CHAT_MODEL = os.getenv("GROQ_CHAT_MODEL", "")
    GROQ_VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "")
    GROQ_STT_MODEL_FALLBACK = os.getenv("GROQ_STT_MODEL_FALLBACK", "whisper-large-v3")
    GROQ_CHAT_MODEL_FALLBACK = os.getenv("GROQ_CHAT_MODEL_FALLBACK", "openai/gpt-oss-20b")
    GROQ_TIMEOUT_SECONDS = float(os.getenv("GROQ_TIMEOUT_SECONDS", "30"))

    CORS_ORIGINS = _list("CORS_ORIGINS", "http://localhost:5000")

    MAX_AUDIO_MB = int(os.getenv("MAX_AUDIO_MB", "10"))
    MAX_PHOTO_MB = int(os.getenv("MAX_PHOTO_MB", "5"))
    DEFAULT_CURRENCY = os.getenv("DEFAULT_CURRENCY", "INR")
    # Flask rejects larger request bodies with 413 automatically
    MAX_CONTENT_LENGTH = (max(MAX_AUDIO_MB, MAX_PHOTO_MB) + 1) * 1024 * 1024

    FRONTEND_DIR = BASE_DIR.parent / "frontend"