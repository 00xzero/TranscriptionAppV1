from fastapi import FastAPI
from datetime import datetime, timezone
import logging
import os

from .core.config import settings
from .services.s3 import ensure_bucket, ensure_bucket_cors
from .db import Base, engine
from .routers import projects


logger = logging.getLogger("uvicorn")

app = FastAPI(title="Meeting Transcription API", version="0.1.0")

# CORS for frontend dev on http://localhost:3000
try:
    from fastapi.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://localhost:3001"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
except Exception as e:
    # If CORS middleware import fails for any reason, continue without it
    logger.warning("CORS middleware not enabled: %s", e)


def run_migrations():
    """Run Alembic migrations to ensure database schema is up to date."""
    from alembic.config import Config
    from alembic import command
    
    # Get the directory where alembic.ini is located
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    alembic_ini = os.path.join(backend_dir, "alembic.ini")
    
    if not os.path.exists(alembic_ini):
        logger.warning("alembic.ini not found at %s, skipping migrations", alembic_ini)
        return False
    
    alembic_cfg = Config(alembic_ini)
    alembic_cfg.set_main_option("script_location", os.path.join(backend_dir, "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", settings.database_url)
    
    command.upgrade(alembic_cfg, "head")
    return True


@app.on_event("startup")
async def startup_event():
    logger.info("Starting API in %s environment", settings.env)
    
    # Run database migrations
    try:
        if run_migrations():
            logger.info("Database migrations completed successfully")
        else:
            if settings.env == "dev":
                logger.info("Falling back to create_all for database setup")
                Base.metadata.create_all(bind=engine)
            else:
                raise RuntimeError("alembic.ini not found; refusing to run create_all outside dev")
    except Exception as e:
        if settings.env == "dev":
            logger.warning("Database migration failed: %s, falling back to create_all", e)
            try:
                Base.metadata.create_all(bind=engine)
                logger.info("Database tables ensured via create_all fallback")
            except Exception as e2:
                logger.error("Database setup failed: %s", e2)
        else:
            logger.error("Database migration failed: %s", e)
            raise
    
    # Ensure MinIO bucket exists
    try:
        ensure_bucket()
        ensure_bucket_cors()
        logger.info("S3 bucket and CORS ensured: %s", settings.s3_bucket)
    except Exception as e:
        logger.warning("S3 bucket ensure failed: %s", e)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "time": datetime.now(timezone.utc).isoformat(),
        "env": settings.env,
    }


# Routers
app.include_router(projects.router)
