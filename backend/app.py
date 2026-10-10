import logging
import os

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from json_provider import ApiJSONProvider
from werkzeug.exceptions import NotFound

from config import Config
from errors import register_error_handlers
from extensions import db
from routes import register_blueprints


def create_app(config_class=Config):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    app = Flask(__name__, static_folder=None)
    app.json = ApiJSONProvider(app)
    app.config.from_object(config_class)
    _validate_config(app)

    CORS(
        app,
        resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
        allow_headers=["Authorization", "Content-Type"],
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        max_age=600,
    )

    db.init_app(app)
    register_error_handlers(app)
    register_blueprints(app)
    _register_frontend(app)
    return app


def _validate_config(app):
    if (
        app.config["APP_ENV"] == "production"
        and app.config["SECRET_KEY"] == "dev-only-change-me"
    ):
        raise RuntimeError("FLASK_SECRET_KEY must be set in production.")


def _register_frontend(app):
    """Serve the static frontend from ../frontend (same origin as the API)."""
    frontend_dir = app.config["FRONTEND_DIR"]

    @app.get("/")
    def index():
        if (frontend_dir / "index.html").is_file():
            return send_from_directory(frontend_dir, "index.html")
        return jsonify({"service": "local-service-marketplace-api", "health": "/api/v1/health"})

    @app.get("/<path:filename>")
    def frontend_files(filename):
        # Unknown API paths must give the JSON 404, never a frontend file
        if filename == "api" or filename.startswith("api/"):
            raise NotFound()
        return send_from_directory(frontend_dir, filename)


app = create_app()

if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=int(os.getenv("PORT", "5000")),
        debug=app.config["DEBUG"],
    )