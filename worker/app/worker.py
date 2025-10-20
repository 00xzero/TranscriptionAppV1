import os
from celery import Celery
import time
import psycopg2
import uuid

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://app:app@postgres:5432/meeting")

app = Celery("transcription_worker", broker=REDIS_URL, backend=REDIS_URL)


@app.task(name="health.ping")
def ping(x: int = 1) -> str:
    return "pong"


def _exec(sql: str, params: tuple):
    conn = psycopg2.connect(DATABASE_URL)
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(sql, params)
    finally:
        conn.close()


@app.task(name="pipeline.transcribe_project")
def transcribe_project(project_id: str) -> str:
    # Mark processing
    _exec("UPDATE projects SET status='processing', updated_at=NOW() WHERE id=%s", (project_id,))
    # Simulate work
    time.sleep(2)
    # Insert a stub segment so the Editor can display something
    seg_id = str(uuid.uuid4())
    _exec(
        """
        INSERT INTO segments (id, project_id, speaker_id, start_ms, end_ms, text, created_at, updated_at)
        VALUES (%s, %s, NULL, %s, %s, %s, NOW(), NOW())
        """,
        (seg_id, project_id, 0, 5000, "This is a stub transcript segment. Real transcription will replace this."),
    )
    # Mark completed
    _exec("UPDATE projects SET status='completed', updated_at=NOW() WHERE id=%s", (project_id,))
    return project_id
