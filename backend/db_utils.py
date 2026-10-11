"""Small helpers around raw SQL. Every value goes through bind parameters."""
from sqlalchemy import text

from extensions import db


def fetch_all(sql, params=None):
    result = db.session.execute(text(sql), params or {})
    return [dict(row) for row in result.mappings().all()]


def fetch_one(sql, params=None):
    result = db.session.execute(text(sql), params or {})
    row = result.mappings().first()
    return dict(row) if row else None


def run(sql, params=None):
    return db.session.execute(text(sql), params or {})


def commit():
    db.session.commit()


def sqlstate(exc):
    return getattr(getattr(exc, "orig", None), "sqlstate", None)


def haversine_sql(lat1, lng1, lat2, lng2):
    """SQL expression for the great-circle distance in km. Arguments are column
    names or bind placeholders chosen by our code, never user input."""
    return (
        "(2 * 6371.0088 * asin(sqrt(least(CAST(1 AS float8), "
        f"power(sin(radians({lat2} - {lat1}) / 2), 2) + "
        f"cos(radians({lat1})) * cos(radians({lat2})) * "
        f"power(sin(radians({lng2} - {lng1}) / 2), 2)))))"
    )