"""Deletes rows created by flow_test.py and ai_flow_test.py (titles starting 'Flow test' / 'AI test').
Bookings, offers and timeline events go with them. Uploaded files stay in storage."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app import app  # noqa: E402
from extensions import db  # noqa: E402

WHERE = "title LIKE 'Flow test:%' OR title LIKE 'AI test:%'"

with app.app_context():
    s = db.session
    rows = s.execute(text(f"SELECT title, status::text FROM requests WHERE {WHERE} ORDER BY created_at")).all()
    if not rows:
        sys.exit("Nothing to clean up.")
    for title, status in rows:
        print(f"- {title} ({status})")
    if input(f"\nDelete these {len(rows)} requests and everything attached to them? Type yes: ").strip() != "yes":
        sys.exit("Cancelled.")
    s.execute(text(f"DELETE FROM requests WHERE {WHERE}"))
    s.commit()
    print("Deleted.")