import logging

from flask import jsonify, request
from werkzeug.exceptions import HTTPException

log = logging.getLogger(__name__)


class ApiError(Exception):
    """Raise this anywhere; it becomes { error: { code, message, details? } }."""

    def __init__(self, status, code, message, details=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def _json_error(status, code, message, details=None):
    body = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return jsonify(body), status


_HTTP_CODES = {
    400: "BAD_REQUEST",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    413: "FILE_TOO_LARGE",
    415: "UNSUPPORTED_MEDIA",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
}

_MESSAGES = {
    404: "The requested resource was not found.",
    405: "This method is not allowed for this endpoint.",
    413: "The uploaded file is too large.",
}


def register_error_handlers(app):
    @app.errorhandler(ApiError)
    def handle_api_error(exc):
        return _json_error(exc.status, exc.code, exc.message, exc.details)

    @app.errorhandler(HTTPException)
    def handle_http_error(exc):
        # Non-API paths (static files) keep Flask's normal response
        if not request.path.startswith("/api/"):
            return exc
        code = _HTTP_CODES.get(exc.code, "HTTP_ERROR")
        message = _MESSAGES.get(exc.code) or exc.description or exc.name
        return _json_error(exc.code, code, message)

    @app.errorhandler(Exception)
    def handle_unexpected(exc):
        log.exception("Unhandled error on %s %s", request.method, request.path)
        return _json_error(500, "INTERNAL_ERROR", "Something went wrong on our side.")