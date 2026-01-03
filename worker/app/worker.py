import os
from celery import Celery
import time
import psycopg2
import uuid
import requests
import boto3
import mimetypes
from typing import Optional, Dict, Any
import json

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://app:app@postgres:5432/meeting")

# S3 / MinIO
S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL", "http://minio:9000")
S3_ACCESS_KEY_ID = os.getenv("S3_ACCESS_KEY_ID", "minioadmin")
S3_SECRET_ACCESS_KEY = os.getenv("S3_SECRET_ACCESS_KEY", "minioadmin")
S3_BUCKET = os.getenv("S3_BUCKET", "media")

# Deepgram
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")
DEEPGRAM_MODEL = os.getenv("DEEPGRAM_MODEL", "nova-3")
DEEPGRAM_ENDPOINT = "https://api.deepgram.com/v1/listen"

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


def _fetchone(sql: str, params: tuple) -> Optional[tuple]:
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return row
    finally:
        conn.close()


def _fetchall(sql: str, params: tuple) -> list[tuple]:
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
            return rows
    finally:
        conn.close()


def _s3_client():
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT_URL,
        aws_access_key_id=S3_ACCESS_KEY_ID,
        aws_secret_access_key=S3_SECRET_ACCESS_KEY,
    )


def _download_object_bytes(object_key: str) -> bytes:
    client = _s3_client()
    resp = client.get_object(Bucket=S3_BUCKET, Key=object_key)
    body = resp["Body"].read()
    return body


def _guess_mime(object_key: str) -> str:
    mime, _ = mimetypes.guess_type(object_key)
    return mime or "application/octet-stream"


def _get_or_create_speaker(project_id: str, label: str) -> str:
    row = _fetchone(
        "SELECT id FROM speakers WHERE project_id=%s AND label=%s LIMIT 1",
        (project_id, label),
    )
    if row:
        return row[0]
    new_id = str(uuid.uuid4())
    _exec(
        """
        INSERT INTO speakers (id, project_id, label, color, created_at, updated_at)
        VALUES (%s, %s, %s, NULL, NOW(), NOW())
        """,
        (new_id, project_id, label),
    )
    return new_id


def _clear_existing_segments(project_id: str) -> None:
    _exec("DELETE FROM segments WHERE project_id=%s", (project_id,))


def _insert_segment(project_id: str, speaker_id: Optional[str], start_ms: int, end_ms: int, text: str) -> str:
    seg_id = str(uuid.uuid4())
    _exec(
        """
        INSERT INTO segments (id, project_id, speaker_id, start_ms, end_ms, text, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())
        """,
        (seg_id, project_id, speaker_id, start_ms, end_ms, text),
    )
    return seg_id


def _insert_word(segment_id: str, start_ms: int, end_ms: int, text: str, confidence: Optional[float], order_index: int) -> None:
    _exec(
        """
        INSERT INTO words (id, segment_id, start_ms, end_ms, text, confidence, order_index, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
        """,
        (str(uuid.uuid4()), segment_id, start_ms, end_ms, text, confidence, order_index),
    )


def _build_keywords_params(project_id: str) -> list[tuple[str, str]]:
    params: list[tuple[str, str]] = []
    # Load watchlist terms for boosting
    rows = _fetchall("SELECT term FROM watchlist WHERE project_id=%s", (project_id,))
    for (term,) in rows:
        # moderate boost
        params.append(("keywords", f"{term}:2"))
    return params


def _majority_speaker(words: list[Dict[str, Any]]) -> Optional[int]:
    counts: Dict[int, int] = {}
    for w in words:
        sp = w.get("speaker")
        if isinstance(sp, int):
            counts[sp] = counts.get(sp, 0) + 1
    if not counts:
        return None
    return max(counts, key=counts.get)


@app.task(name="pipeline.transcribe_project")
def transcribe_project(project_id: str) -> str:
    # Prechecks
    if not DEEPGRAM_API_KEY:
        _exec("UPDATE projects SET status='error', updated_at=NOW() WHERE id=%s", (project_id,))
        return project_id

    # Mark processing
    _exec("UPDATE projects SET status='processing', updated_at=NOW() WHERE id=%s", (project_id,))

    # Load project source object key
    row = _fetchone("SELECT source_object_key FROM projects WHERE id=%s", (project_id,))
    if not row:
        _exec("UPDATE projects SET status='error', updated_at=NOW() WHERE id=%s", (project_id,))
        return project_id
    object_key = row[0]

    try:
        # Download audio from MinIO
        media_bytes = _download_object_bytes(object_key)
        content_type = _guess_mime(object_key)

        # Build query params
        params: list[tuple[str, str]] = [
            ("model", DEEPGRAM_MODEL),
            ("smart_format", "true"),
            ("diarize", "true"),
            ("utterances", "true"),
        ]
        params += _build_keywords_params(project_id)

        # Call Deepgram with binary audio
        headers = {
            "Authorization": f"Token {DEEPGRAM_API_KEY}",
            "Content-Type": content_type,
        }
        resp = requests.post(DEEPGRAM_ENDPOINT, params=params, headers=headers, data=media_bytes, timeout=600)
        resp.raise_for_status()
        dg = resp.json()

        # Parse response
        results = dg.get("results", {})
        channels = results.get("channels", [])
        alt = None
        if channels and channels[0].get("alternatives"):
            alt = channels[0]["alternatives"][0]

        utterances = results.get("utterances") or (alt.get("utterances") if alt else None)
        words = (alt.get("words") if alt else []) or []

        # Clear existing data
        _clear_existing_segments(project_id)

        max_end_ms = 0

        if utterances:
            for utt in utterances:
                utt_words = utt.get("words", [])
                # compute times
                start_ms = int(round(float(utt.get("start", 0)) * 1000))
                end_ms = int(round(float(utt.get("end", 0)) * 1000))
                max_end_ms = max(max_end_ms, end_ms)
                # majority speaker
                sp_num = _majority_speaker(utt_words)
                speaker_id = None
                if isinstance(sp_num, int):
                    speaker_id = _get_or_create_speaker(project_id, f"Speaker {sp_num}")
                seg_id = _insert_segment(project_id, speaker_id, start_ms, end_ms, utt.get("transcript", ""))
                for idx, w in enumerate(utt_words):
                    w_start = int(round(float(w.get("start", 0)) * 1000))
                    w_end = int(round(float(w.get("end", 0)) * 1000))
                    _insert_word(seg_id, w_start, w_end, w.get("word", ""), float(w.get("confidence", 0)) if w.get("confidence") is not None else None, idx)
        elif words:
            # Fallback: single segment covering all words
            if words:
                start_ms = int(round(float(words[0].get("start", 0)) * 1000))
                end_ms = int(round(float(words[-1].get("end", 0)) * 1000))
            else:
                start_ms = 0
                end_ms = 0
            max_end_ms = max(max_end_ms, end_ms)
            speaker_id = None
            sp_num = _majority_speaker(words)
            if isinstance(sp_num, int):
                speaker_id = _get_or_create_speaker(project_id, f"Speaker {sp_num}")
            transcript_text = alt.get("transcript", "") if alt else ""
            seg_id = _insert_segment(project_id, speaker_id, start_ms, end_ms, transcript_text)
            for idx, w in enumerate(words):
                w_start = int(round(float(w.get("start", 0)) * 1000))
                w_end = int(round(float(w.get("end", 0)) * 1000))
                _insert_word(seg_id, w_start, w_end, w.get("word", ""), float(w.get("confidence", 0)) if w.get("confidence") is not None else None, idx)
        else:
            # No words returned; create empty segment
            _insert_segment(project_id, None, 0, 0, alt.get("transcript", "") if alt else "")

        # Update duration if we have it
        if max_end_ms > 0:
            _exec("UPDATE projects SET duration_seconds=%s WHERE id=%s", (max_end_ms // 1000, project_id))

        # Done
        _exec("UPDATE projects SET status='completed', updated_at=NOW() WHERE id=%s", (project_id,))
        return project_id

    except Exception as e:
        # Store error state
        _exec("UPDATE projects SET status='error', updated_at=NOW() WHERE id=%s", (project_id,))
        # Optionally log job row
        _exec(
            """
            INSERT INTO jobs (id, project_id, type, status, payload, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s::jsonb, NOW(), NOW())
            """,
            (str(uuid.uuid4()), project_id, "transcribe", "error", json.dumps({"error": str(e)}) ),
        )
        return project_id
