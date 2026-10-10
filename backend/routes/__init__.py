from .health import bp as health_bp

API_PREFIX = "/api/v1"


def register_blueprints(app):
    app.register_blueprint(health_bp, url_prefix=API_PREFIX)

    if app.config["DEBUG"]:
        from .dev import bp as dev_bp

        app.register_blueprint(dev_bp, url_prefix=API_PREFIX)