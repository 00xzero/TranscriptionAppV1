from fastapi import FastAPI
from datetime import datetime, timezone
import logging

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


@app.on_event("startup")
async def startup_event():
    logger.info("Starting API in %s environment", settings.env)
    # Create DB tables (simple auto-create for dev; replace with Alembic in later phases)
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables ensured")
    except Exception as e:
        logger.warning("DB auto-create failed: %s", e)
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
