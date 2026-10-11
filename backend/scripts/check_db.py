"""Read-only report of the database structure. Safe to paste into chat (no secrets).
    python scripts/check_db.py
"""
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app import app  # noqa: E402
from extensions import db  # noqa: E402

with app.app_context():
    if not db.configured:
        sys.exit("DATABASE_URL is not set in backend/.env")

    s = db.session
    s.execute(text("SET TRANSACTION READ ONLY"))

    who = s.execute(
        text("SELECT current_user, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)")
    ).one()
    print(f"CONNECTED AS: {who[0]} (bypasses RLS: {who[1]})\n")

    print("TABLES  (? = nullable)")
    cols = defaultdict(list)
    for t, c, udt, nullable in s.execute(
        text(
            "SELECT table_name, column_name, udt_name, is_nullable "
            "FROM information_schema.columns WHERE table_schema = 'public' "
            "ORDER BY table_name, ordinal_position"
        )
    ):
        cols[t].append(f"{c}:{udt}{'?' if nullable == 'YES' else ''}")
    for t, items in cols.items():
        print(f"- {t}: " + ", ".join(items))

    print("\nENUMS")
    for name, labels in s.execute(
        text(
            "SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) "
            "FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid "
            "JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' "
            "GROUP BY t.typname ORDER BY t.typname"
        )
    ):
        print(f"- {name}: {labels}")

    print("\nCONSTRAINTS (check, exclusion, unique, foreign key)")
    for table, name, kind, definition in s.execute(
        text(
            "SELECT conrelid::regclass::text, conname, contype, pg_get_constraintdef(oid) "
            "FROM pg_constraint WHERE connamespace = 'public'::regnamespace "
            "AND contype IN ('c','x','u','f') ORDER BY 1, 2"
        )
    ):
        print(f"- [{kind}] {table}.{name}: {definition}")

    print("\nINDEXES")
    for table, name, definition in s.execute(
        text("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2")
    ):
        print(f"- {table}.{name}: {definition.split(' USING ', 1)[-1]}")

    print("\nSTORAGE BUCKETS")
    try:
        for name, public in s.execute(text("SELECT name, public FROM storage.buckets ORDER BY name")):
            print(f"- {name} (public: {public})")
    except Exception as exc:  # noqa: BLE001
        print(f"- could not read buckets: {exc.__class__.__name__}")

    print("\nROW COUNTS")
    for (table,) in s.execute(
        text("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1")
    ).all():
        n = s.execute(text(f'SELECT count(*) FROM public."{table}"')).scalar()
        print(f"- {table}: {n}")