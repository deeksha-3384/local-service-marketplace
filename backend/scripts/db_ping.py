import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app import app  # noqa: E402
from extensions import db  # noqa: E402

with app.app_context():
    print("database configured:", db.configured)
    try:
        print("connected as:", db.session.execute(text("select current_user")).scalar())
    except Exception as exc:  # noqa: BLE001 - diagnostic script
        lines = str(exc).strip().splitlines()
        print("FAILED:", type(exc).__name__, lines[-1][:200] if lines else "")