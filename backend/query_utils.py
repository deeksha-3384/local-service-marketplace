import math

from flask import request

from errors import ApiError


def _bad(name, message):
    return ApiError(
        422, "VALIDATION_ERROR", f"Invalid query parameter '{name}'.",
        [{"field": name, "message": message}],
    )


def parse_choice(name, allowed):
    value = request.args.get(name)
    if value is None or value == "":
        return None
    if value not in allowed:
        raise _bad(name, "must be one of: " + ", ".join(sorted(allowed)))
    return value


def parse_float(name, minimum=None, maximum=None):
    raw = request.args.get(name)
    if raw is None or raw == "":
        return None
    try:
        value = float(raw)
    except ValueError:
        raise _bad(name, "must be a number")
    if not math.isfinite(value):
        raise _bad(name, "must be a finite number")
    if minimum is not None and value < minimum:
        raise _bad(name, f"must be at least {minimum}")
    if maximum is not None and value > maximum:
        raise _bad(name, f"must be at most {maximum}")
    return value