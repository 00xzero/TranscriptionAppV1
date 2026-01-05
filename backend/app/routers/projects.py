from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List
from uuid import uuid4
from io import BytesIO

from ..db import get_db
from ..core.auth import require_auth
from ..models import Project, Segment, Word, Speaker, Job
from ..schemas import (
    ProjectCreate,
    ProjectRead,
    PresignedUpload,
    JobEnqueued,
    JobRead,
    MediaUrl,
    SegmentRead,
    BulkImportSegments,
    SegmentUpsert,
    WordUpsert,
    SegmentUpdate,
    SpeakerRead,
    SpeakerCreate,
    SpeakerUpdate,
)
from ..services.s3 import presign_put_url, normalize_key_component, presign_get_url, delete_prefix
from ..services.tasks import enqueue_transcription
from ..services.exports import generate_docx, generate_vtt

# All routes in this router require authentication
router = APIRouter(dependencies=[Depends(require_auth)])


@router.post("/projects", response_model=PresignedUpload)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    # Compute an object key under uploads/<project_id>/<sanitized-filename>
    project_id = str(uuid4())
    sanitized = normalize_key_component(payload.filename)
    object_key = f"uploads/{project_id}/{sanitized}"

    proj = Project(
      id=project_id,
      title=payload.title,
      status="created",
      source_object_key=object_key,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)

    url = presign_put_url(object_key=object_key, content_type=payload.content_type or "application/octet-stream")

    return PresignedUpload(project=proj, upload_url=url, object_key=object_key)


@router.get("/projects", response_model=List[ProjectRead])
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).order_by(Project.created_at.desc()).limit(100).all()


@router.get("/projects/{project_id}", response_model=ProjectRead)
def get_project(project_id: str, db: Session = Depends(get_db)):
    proj = db.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj


@router.post("/projects/{project_id}/start", response_model=JobEnqueued)
def start_project(project_id: str, db: Session = Depends(get_db)):
    proj = db.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    if proj.status not in ("created", "queued", "error"):
        # already processing or finished
        raise HTTPException(status_code=409, detail=f"Cannot start from status '{proj.status}'")

    proj.status = "queued"
    db.add(proj)
    
    # Create a Job record to track this transcription
    job = Job(
        project_id=project_id,
        type="transcribe",
        status="queued",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    task_id = enqueue_transcription(project_id, job_id=job.id)
    
    # Update job with celery task ID
    job.celery_task_id = task_id
    db.commit()
    
    return JobEnqueued(project_id=project_id, task_id=task_id)


@router.get("/projects/{project_id}/media-url", response_model=MediaUrl)
def project_media_url(project_id: str, db: Session = Depends(get_db)):
    proj = db.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    url = presign_get_url(proj.source_object_key)
    return MediaUrl(project_id=project_id, object_key=proj.source_object_key, url=url)


@router.get("/projects/{project_id}/jobs", response_model=List[JobRead])
def list_project_jobs(project_id: str, db: Session = Depends(get_db)):
    """List all jobs for a project, ordered by creation time (newest first)."""
    proj = db.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    jobs = db.query(Job).filter(Job.project_id == project_id).order_by(Job.created_at.desc()).all()
    return jobs


@router.get("/projects/{project_id}/segments", response_model=list[SegmentRead])
def project_segments(project_id: str, db: Session = Depends(get_db)):
    proj = db.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    items = db.query(Segment).filter(Segment.project_id == project_id).order_by(Segment.start_ms.asc()).all()
    return items


@router.post("/projects/{project_id}/segments/import", response_model=list[SegmentRead])
def import_segments(project_id: str, payload: BulkImportSegments, db: Session = Depends(get_db)):
    import uuid

    proj = db.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    # Optionally replace existing segments
    if payload.replace_existing:
        # Delete existing segments (words cascade via FK)
        db.query(Segment).filter(Segment.project_id == project_id).delete(synchronize_session=False)
        db.commit()

    def get_or_create_speaker(label: str | None) -> str | None:
        if not label:
            return None
        existing = (
            db.query(Speaker)
            .filter(Speaker.project_id == project_id)
            .filter(Speaker.label == label)
            .first()
        )
        if existing:
            return existing.id
        sp = Speaker(project_id=project_id, label=label)
        db.add(sp)
        db.flush()
        return sp.id

    for s in payload.segments:
        if s.end_ms < s.start_ms:
            raise HTTPException(status_code=400, detail="end_ms must be >= start_ms")
        if s.words:
            for w in s.words:
                if w.end_ms < w.start_ms:
                    raise HTTPException(status_code=400, detail="end_ms must be >= start_ms")
        seg_id = s.id or str(uuid.uuid4())
        speaker_id = s.speaker_id or get_or_create_speaker(s.speaker_label)
        seg = Segment(
            id=seg_id,
            project_id=project_id,
            speaker_id=speaker_id,
            start_ms=s.start_ms,
            end_ms=s.end_ms,
            text=s.text,
        )
        db.add(seg)
        db.flush()
        if s.words:
            for idx, w in enumerate(s.words):
                db.add(
                    Word(
                        id=str(uuid.uuid4()),
                        segment_id=seg_id,
                        start_ms=w.start_ms,
                        end_ms=w.end_ms,
                        text=w.text,
                        order_index=idx,
                    )
                )

    db.commit()

    # Return imported segments
    items = db.query(Segment).filter(Segment.project_id == project_id).order_by(Segment.start_ms.asc()).all()
    return items


@router.patch("/segments/{segment_id}", response_model=SegmentRead)
def update_segment(segment_id: str, payload: SegmentUpdate, db: Session = Depends(get_db)):
    seg = db.get(Segment, segment_id)
    if not seg:
        raise HTTPException(status_code=404, detail="Segment not found")

    if payload.start_ms is not None:
        seg.start_ms = int(payload.start_ms)
    if payload.end_ms is not None:
        seg.end_ms = int(payload.end_ms)
    if payload.text is not None:
        seg.text = payload.text
    if payload.speaker_id is not None:
        seg.speaker_id = payload.speaker_id

    if seg.end_ms < seg.start_ms:
        raise HTTPException(status_code=400, detail="end_ms must be >= start_ms")

    db.add(seg)
    db.commit()
    db.refresh(seg)
    return seg


@router.get("/projects/{project_id}/speakers", response_model=list[SpeakerRead])
def list_speakers(project_id: str, db: Session = Depends(get_db)):
    proj = db.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    items = db.query(Speaker).filter(Speaker.project_id == project_id).order_by(Speaker.created_at.asc()).all()
    return items


@router.post("/projects/{project_id}/speakers", response_model=SpeakerRead)
def create_speaker(project_id: str, payload: SpeakerCreate, db: Session = Depends(get_db)):
    proj = db.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    sp = Speaker(project_id=project_id, label=payload.label, color=payload.color)
    db.add(sp)
    db.commit()
    db.refresh(sp)
    return sp


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db)):
    proj = db.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    # Best-effort: remove uploaded media objects under the project's prefix
    try:
        # uploads/<project_id>/...
        deleted_count = delete_prefix(f"uploads/{project_id}/")
        # Also attempt the exact source object key in case it was outside the standard prefix
        if proj.source_object_key and not proj.source_object_key.startswith(f"uploads/{project_id}/"):
            # import locally to avoid widening public API; delete_object may not always be needed
            from ..services.s3 import delete_object  # type: ignore
            delete_object(proj.source_object_key)
    except Exception:
        # Ignore storage errors to not block DB deletion
        pass
    db.delete(proj)
    db.commit()
    return {"ok": True}


@router.patch("/speakers/{speaker_id}", response_model=SpeakerRead)
def update_speaker(speaker_id: str, payload: SpeakerUpdate, db: Session = Depends(get_db)):
    sp = db.get(Speaker, speaker_id)
    if not sp:
        raise HTTPException(status_code=404, detail="Speaker not found")
    if payload.label is not None:
        sp.label = payload.label
    if payload.color is not None:
        sp.color = payload.color
    db.add(sp)
    db.commit()
    db.refresh(sp)
    return sp


@router.get("/projects/{project_id}/export/docx")
def export_docx(project_id: str, include_timestamps: bool = True, db: Session = Depends(get_db)):
    proj = db.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Load segments and speakers
    segments = db.query(Segment).filter(Segment.project_id == project_id).order_by(Segment.start_ms.asc()).all()
    speakers = db.query(Speaker).filter(Speaker.project_id == project_id).all()
    
    # Build speakers map
    speakers_map = {sp.id: {"label": sp.label, "color": sp.color} for sp in speakers}
    
    # Convert segments to dicts
    segments_data = [
        {
            "speaker_id": seg.speaker_id,
            "start_ms": seg.start_ms,
            "end_ms": seg.end_ms,
            "text": seg.text
        }
        for seg in segments
    ]
    
    # Generate DOCX
    buffer = generate_docx(proj.title or f"Project {project_id}", segments_data, speakers_map, include_timestamps)
    
    filename = f"{proj.title or project_id}_transcript.docx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/projects/{project_id}/export/vtt")
def export_vtt(project_id: str, db: Session = Depends(get_db)):
    proj = db.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Load segments and speakers
    segments = db.query(Segment).filter(Segment.project_id == project_id).order_by(Segment.start_ms.asc()).all()
    speakers = db.query(Speaker).filter(Speaker.project_id == project_id).all()
    
    # Build speakers map
    speakers_map = {sp.id: {"label": sp.label, "color": sp.color} for sp in speakers}
    
    # Convert segments to dicts
    segments_data = [
        {
            "speaker_id": seg.speaker_id,
            "start_ms": seg.start_ms,
            "end_ms": seg.end_ms,
            "text": seg.text
        }
        for seg in segments
    ]
    
    # Generate VTT
    vtt_content = generate_vtt(segments_data, speakers_map)
    
    filename = f"{proj.title or project_id}_captions.vtt"
    return StreamingResponse(
        BytesIO(vtt_content.encode("utf-8")),
        media_type="text/vtt",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
