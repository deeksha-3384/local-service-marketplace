from flask import request

from errors import ApiError

DEFAULT_LIMIT = 20
MAX_LIMIT = 100


def _bad(name, message):
    return ApiError(
        422,
        "VALIDATION_ERROR",
        f"Invalid query parameter '{name}'.",
        [{"field": name, "message": message}],
    )


def _int_arg(name, default, minimum, maximum=None):
    raw = request.args.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        raise _bad(name, "must be an integer")
    if value < minimum:
        raise _bad(name, f"must be at least {minimum}")
    if maximum is not None and value > maximum:
        raise _bad(name, f"must be at most {maximum}")
    return value


def parse_pagination():
    """Returns (page, limit, offset)."""
    page = _int_arg("page", 1, 1)
    limit = _int_arg("limit", DEFAULT_LIMIT, 1, MAX_LIMIT)
    return page, limit, (page - 1) * limit


def parse_sort(allowed, default, default_order="desc"):
    """Returns (field, order). 'allowed' is a whitelist of sortable fields."""
    field = request.args.get("sort") or default
    if field not in allowed:
        raise _bad("sort", "must be one of: " + ", ".join(sorted(allowed)))
    order = (request.args.get("order") or default_order).lower()
    if order not in ("asc", "desc"):
        raise _bad("order", "must be 'asc' or 'desc'")
    return field, order


def paginated(items, page, limit, total):
    return {"items": items, "page": page, "limit": limit, "total": total}