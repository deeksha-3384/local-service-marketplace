import logging

from sqlalchemy import create_engine
from sqlalchemy.orm import scoped_session, sessionmaker

log = logging.getLogger(__name__)


def normalize_database_url(url):
    """Supabase gives postgresql://...; SQLAlchemy needs the psycopg driver named."""
    url = url.strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


class Database:
    def __init__(self):
        self.engine = None
        self.session = None

    @property
    def configured(self):
        return self.engine is not None

    def init_app(self, app):
        url = app.config.get("DATABASE_URL", "")
        if not url:
            log.warning("DATABASE_URL is not set; database features are disabled.")
            return

        self.engine = create_engine(
            normalize_database_url(url),
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
            pool_recycle=300,
            # Required for Supabase's transaction pooler (port 6543)
            connect_args={"prepare_threshold": None},
        )
        self.session = scoped_session(
            sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)
        )

        @app.teardown_appcontext
        def _cleanup(exc):
            self.session.remove()


db = Database()