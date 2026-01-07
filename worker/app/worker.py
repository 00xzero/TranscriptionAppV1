"""
Celery worker for transcription pipeline.

Uses shared SQLAlchemy models from backend_app for database access,
ensuring consistency with the API layer.
"""
import mimetypes
import requests
import boto3
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from celery import Celery

# Import shared backend code (models, config, db session)
from backend_app.core.config import settings
from backend_app.db import SessionLocal
from backend_app.models import Project, Segment, Word, Speaker, Watchlist, Job
from backend_app.services.consolidation import consolidate_and_save_chunks

DEEPGRAM_ENDPOINT = "https://api.deepgram.com/v1/listen"

app = Celery("transcription_worker", broker=settings.redis_url, backend=settings.redis_url)


@app.task(name="health.ping")
def ping(x: int = 1) -> str:
    return "pong"


def _get_db_session():
    """Create a new database session for worker tasks."""
    return SessionLocal()


def _s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
    )


def _download_object_bytes(object_key: str) -> bytes:
    """Download entire object into memory. Use only as fallback."""
    client = _s3_client()
    resp = client.get_object(Bucket=settings.s3_bucket, Key=object_key)
    body = resp["Body"].read()
    return body


def _presign_get_url(object_key: str, expires_in: int = 3600) -> str:
    """Generate a presigned GET URL for S3 object."""
    client = _s3_client()
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": object_key},
        ExpiresIn=expires_in,
    )
    # Replace internal endpoint with public base URL if configured
    if settings.s3_public_base_url and settings.s3_public_base_url != settings.s3_endpoint_url:
        url = url.replace(settings.s3_endpoint_url, settings.s3_public_base_url, 1)
    return url


def _can_use_url_fetch() -> bool:
    """
    Check if Deepgram URL fetch can be used.
    
    URL fetch requires S3 to be publicly accessible (not localhost).
    """
    public_url = settings.s3_public_base_url or settings.s3_endpoint_url
    # Can't use URL fetch if S3 is on localhost (Deepgram can't reach it)
    return not any(host in public_url for host in ["localhost", "127.0.0.1", "minio:"])


def _guess_mime(object_key: str) -> str:
    mime, _ = mimetypes.guess_type(object_key)
    return mime or "application/octet-stream"


def _get_or_create_speaker(db, project_id: str, label: str) -> str:
    """Get existing speaker or create new one using ORM."""
    existing = db.query(Speaker).filter(
        Speaker.project_id == project_id,
        Speaker.label == label
    ).first()
    if existing:
        return existing.id
    
    speaker = Speaker(project_id=project_id, label=label)
    db.add(speaker)
    db.flush()
    return speaker.id


def _clear_existing_segments(db, project_id: str) -> None:
    """Delete all segments for a project (words cascade via FK)."""
    db.query(Segment).filter(Segment.project_id == project_id).delete(synchronize_session=False)


def _insert_segment(db, project_id: str, speaker_id: Optional[str], start_ms: int, end_ms: int, text: str) -> str:
    """Insert a new segment using ORM."""
    segment = Segment(
        project_id=project_id,
        speaker_id=speaker_id,
        start_ms=start_ms,
        end_ms=end_ms,
        text=text,
    )
    db.add(segment)
    db.flush()
    return segment.id


def _insert_word(db, segment_id: str, start_ms: int, end_ms: int, text: str, confidence: Optional[float], order_index: int) -> None:
    """Insert a new word using ORM."""
    word = Word(
        segment_id=segment_id,
        start_ms=start_ms,
        end_ms=end_ms,
        text=text,
        confidence=confidence,
        order_index=order_index,
    )
    db.add(word)


def _build_keywords_params(db, project_id: str) -> list[tuple[str, str]]:
    """Load watchlist terms for Deepgram keyword boosting."""
    params: list[tuple[str, str]] = []
    watchlist_items = db.query(Watchlist).filter(Watchlist.project_id == project_id).all()
    for item in watchlist_items:
        params.append(("keywords", f"{item.term}:2"))
    return params


def _majority_speaker(words: list[Dict[str, Any]]) -> Optional[int]:
    """Determine the majority speaker from a list of words."""
    counts: Dict[int, int] = {}
    for w in words:
        sp = w.get("speaker")
        if isinstance(sp, int):
            counts[sp] = counts.get(sp, 0) + 1
    if not counts:
        return None
    return max(counts, key=counts.get)


@app.task(name="pipeline.transcribe_project")
def transcribe_project(project_id: str, job_id: str) -> str:
    """Main transcription task using Deepgram API and SQLAlchemy ORM."""
    db = _get_db_session()
    job = None
    
    try:
        # Load project and job
        project = db.get(Project, project_id)
        job = db.get(Job, job_id) if job_id else None
        
        if not project:
            return project_id
        
        # Prechecks
        if not settings.deepgram_api_key:
            project.status = "error"
            if job:
                job.status = "error"
                job.finished_at = datetime.now(timezone.utc)
                job.payload = {"error": "Missing DEEPGRAM_API_KEY"}
            db.commit()
            return project_id

        # Mark processing
        project.status = "processing"
        if job:
            job.status = "processing"
            job.started_at = datetime.now(timezone.utc)
        db.commit()

        object_key = project.source_object_key

        # Build query params for Deepgram
        params: list[tuple[str, str]] = [
            ("model", settings.deepgram_model),
            ("smart_format", "true"),
            ("diarize", "true"),
            ("utterances", "true"),
        ]
        params += _build_keywords_params(db, project_id)

        # Choose between URL fetch (memory-efficient) or byte upload (fallback)
        if _can_use_url_fetch():
            # URL fetch: Deepgram downloads directly from S3 (no RAM pressure)
            presigned_url = _presign_get_url(object_key)
            headers = {
                "Authorization": f"Token {settings.deepgram_api_key}",
                "Content-Type": "application/json",
            }
            resp = requests.post(
                DEEPGRAM_ENDPOINT,
                params=params,
                headers=headers,
                json={"url": presigned_url},
                timeout=600,
            )
        else:
            # Fallback: Download to RAM and upload (for local dev)
            media_bytes = _download_object_bytes(object_key)
            content_type = _guess_mime(object_key)
            headers = {
                "Authorization": f"Token {settings.deepgram_api_key}",
                "Content-Type": content_type,
            }
            resp = requests.post(
                DEEPGRAM_ENDPOINT,
                params=params,
                headers=headers,
                data=media_bytes,
                timeout=600,
            )
        
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
        _clear_existing_segments(db, project_id)

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
                    speaker_id = _get_or_create_speaker(db, project_id, f"Speaker {sp_num}")
                seg_id = _insert_segment(db, project_id, speaker_id, start_ms, end_ms, utt.get("transcript", ""))
                for idx, w in enumerate(utt_words):
                    w_start = int(round(float(w.get("start", 0)) * 1000))
                    w_end = int(round(float(w.get("end", 0)) * 1000))
                    conf = float(w.get("confidence", 0)) if w.get("confidence") is not None else None
                    _insert_word(db, seg_id, w_start, w_end, w.get("word", ""), conf, idx)
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
                speaker_id = _get_or_create_speaker(db, project_id, f"Speaker {sp_num}")
            transcript_text = alt.get("transcript", "") if alt else ""
            seg_id = _insert_segment(db, project_id, speaker_id, start_ms, end_ms, transcript_text)
            for idx, w in enumerate(words):
                w_start = int(round(float(w.get("start", 0)) * 1000))
                w_end = int(round(float(w.get("end", 0)) * 1000))
                conf = float(w.get("confidence", 0)) if w.get("confidence") is not None else None
                _insert_word(db, seg_id, w_start, w_end, w.get("word", ""), conf, idx)
        else:
            # No words returned; create empty segment
            _insert_segment(db, project_id, None, 0, 0, alt.get("transcript", "") if alt else "")

        # Update duration if we have it
        if max_end_ms > 0:
            project.duration_seconds = max_end_ms // 1000

        # Run consolidation post-processing to create chunks
        # This merges fragmented segments into larger, readable chunks
        consolidate_and_save_chunks(db, project_id)

        # Done - mark both project and job as completed
        project.status = "completed"
        if job:
            job.status = "completed"
            job.finished_at = datetime.now(timezone.utc)
        db.commit()
        return project_id

    except Exception as e:
        # Store error state
        db.rollback()
        try:
            project = db.get(Project, project_id)
            if project:
                project.status = "error"
            # Update job with error details (job was already created by API)
            if job_id:
                job = db.get(Job, job_id)
                if job:
                    job.status = "error"
                    job.finished_at = datetime.now(timezone.utc)
                    job.payload = {"error": str(e)}
            db.commit()
        except Exception:
            pass  # Best effort error logging
        return project_id
    finally:
        db.close()
