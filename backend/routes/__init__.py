from .bookings import bp as bookings_bp
from .health import bp as health_bp
from .me import bp as me_bp
from .offers import bp as offers_bp
from .requests import bp as requests_bp
from .updates import bp as updates_bp

API_PREFIX = "/api/v1"


def register_blueprints(app):
    for blueprint in (health_bp, me_bp, requests_bp, offers_bp, bookings_bp, updates_bp):
        app.register_blueprint(blueprint, url_prefix=API_PREFIX)

    if app.config["DEBUG"]:
        from .dev import bp as dev_bp

        app.register_blueprint(dev_bp, url_prefix=API_PREFIX)