"""Runs the real service functions once. Uses a little of your free quota, so don't loop it.
    python scripts/live_ai_check.py
    python scripts/live_ai_check.py path\\to\\photo.jpg
"""
import json
import mimetypes
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import create_app  # noqa: E402
from services import groq_client as gc  # noqa: E402

app = create_app()
with app.app_context():
    r = gc.analyze_text("The bathroom tap keeps dripping all night and there is a damp patch on the wall below it.", "en")
    print("DRAFT:", json.dumps(r.to_draft(), ensure_ascii=False))
    print("DIAGNOSIS:", json.dumps(r.to_diagnosis("en"), ensure_ascii=False, indent=2))
    print("HINDI:", gc.translate("A plumber will arrive tomorrow between 10 and 11.", "hi"))
    if len(sys.argv) > 1:
        path = Path(sys.argv[1])
        mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
        print("PHOTO:", json.dumps(gc.analyze_photo(path.read_bytes(), mime), ensure_ascii=False))