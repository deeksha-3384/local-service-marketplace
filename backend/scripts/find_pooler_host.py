"""Finds which Supabase pooler host accepts your DATABASE_URL credentials.
    python scripts/find_pooler_host.py
"""
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg  # noqa: E402
from dotenv import load_dotenv  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

raw = os.getenv("DATABASE_URL", "").strip()
if not raw:
    sys.exit("DATABASE_URL is empty in backend/.env")

url = make_url(raw)
print(f"user={url.username}  current host={url.host}  port={url.port}  db={url.database}\n")

REGIONS = [
    "ap-south-1", "ap-northeast-1", "ap-northeast-2", "ap-southeast-1", "ap-southeast-2",
    "ca-central-1", "eu-central-1", "eu-west-1", "eu-west-2", "eu-west-3", "eu-north-1",
    "sa-east-1", "us-east-1", "us-east-2", "us-west-1", "us-west-2",
]
hosts = [url.host] if url.host and url.host not in [
    f"aws-{n}-{r}.pooler.supabase.com" for n in (0, 1) for r in REGIONS
] else []
hosts += [f"aws-{n}-{r}.pooler.supabase.com" for n in (0, 1) for r in REGIONS]


def try_host(host):
    try:
        with psycopg.connect(
            host=host, port=6543, user=url.username, password=url.password,
            dbname=url.database or "postgres", connect_timeout=8, prepare_threshold=None,
        ) as conn:
            conn.execute("select 1")
        return host, "OK", ""
    except Exception as exc:  # noqa: BLE001 - diagnostic script
        msg = str(exc).strip().splitlines()[-1][:110] if str(exc).strip() else exc.__class__.__name__
        return host, "FAIL", msg


with ThreadPoolExecutor(max_workers=8) as pool:
    results = list(pool.map(try_host, hosts))

winners = [h for h, status, _ in results if status == "OK"]
if winners:
    print("CONNECTED. Use this host in DATABASE_URL:\n  " + winners[0])
else:
    print("No host worked. Distinct errors seen:")
    for msg in sorted({m for _, _, m in results}):
        print("  -", msg)