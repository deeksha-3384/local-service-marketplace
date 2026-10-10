from flask import request
from pydantic import BaseModel, ConfigDict, ValidationError

from errors import ApiError


class Schema(BaseModel):
    """Base for every request body. Unknown fields are rejected on purpose so a
    typo like 'descripton' fails loudly instead of being silently ignored."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _format_errors(exc):
    return [
        {
            "field": ".".join(str(part) for part in err["loc"]) or "body",
            "message": err["msg"],
        }
        for err in exc.errors()
    ]


def parse_body(model):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError(422, "VALIDATION_ERROR", "Request body must be a JSON object.")
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        raise ApiError(422, "VALIDATION_ERROR", "Some fields are invalid.", _format_errors(exc))