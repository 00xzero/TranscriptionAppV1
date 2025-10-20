from celery import Celery
from ..core.config import settings

celery_app = Celery(broker=settings.redis_url, backend=settings.redis_url)


def enqueue_transcription(project_id: str) -> str:
    # Fire-and-forget task dispatch
    res = celery_app.send_task("pipeline.transcribe_project", args=[project_id])
    return res.id
