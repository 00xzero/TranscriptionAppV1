from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ProjectBase(BaseModel):
    title: Optional[str] = None


class ProjectCreate(ProjectBase):
    filename: str = Field(..., description="Original filename for the uploaded media")
    content_type: Optional[str] = Field(default="application/octet-stream")


class ProjectRead(ProjectBase):
    id: str
    status: str
    source_object_key: str
    duration_seconds: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PresignedUpload(BaseModel):
    project: ProjectRead
    upload_url: str
    object_key: str


class JobEnqueued(BaseModel):
    project_id: str
    task_id: str


class MediaUrl(BaseModel):
    project_id: str
    object_key: str
    url: str


class SegmentRead(BaseModel):
    id: str
    project_id: str
    speaker_id: str | None = None
    start_ms: int
    end_ms: int
    text: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SpeakerRead(BaseModel):
    id: str
    project_id: str
    label: str
    color: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SpeakerCreate(BaseModel):
    label: str
    color: str | None = None


class SpeakerUpdate(BaseModel):
    label: str | None = None
    color: str | None = None


class WordUpsert(BaseModel):
    start_ms: int
    end_ms: int
    text: str


class SegmentUpsert(BaseModel):
    id: Optional[str] = None
    speaker_id: Optional[str] = None
    speaker_label: Optional[str] = None
    start_ms: int
    end_ms: int
    text: str
    words: Optional[list[WordUpsert]] = None


class BulkImportSegments(BaseModel):
    replace_existing: bool = Field(default=True, description="If true, delete existing segments/words before import")
    segments: list[SegmentUpsert]


class SegmentUpdate(BaseModel):
    text: Optional[str] = None
    start_ms: Optional[int] = None
    end_ms: Optional[int] = None
    speaker_id: Optional[str] = None


class JobRead(BaseModel):
    id: str
    project_id: str
    celery_task_id: str | None = None
    type: str
    status: str
    payload: dict | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None

    class Config:
        from_attributes = True
