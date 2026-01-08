from __future__ import annotations

from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import datetime


# Constants for key terms validation
MAX_KEY_TERMS = 100
MAX_KEY_TERM_LENGTH = 64


def _parse_and_validate_key_terms(
    v: Optional[list[str]],
    allow_empty: bool = False,
) -> Optional[list[str]]:
    """Parse, dedupe, and validate key terms."""
    if v is None or len(v) == 0:
        return [] if allow_empty else None

    # Deduplicate case-insensitively, preserving first-seen casing
    seen_canonical: dict[str, str] = {}
    for term in v:
        if not isinstance(term, str):
            continue
        trimmed = term.strip()
        if not trimmed:
            continue
        canonical = trimmed.casefold()
        if canonical not in seen_canonical:
            seen_canonical[canonical] = trimmed

    terms = list(seen_canonical.values())

    if not terms:
        return [] if allow_empty else None

    # Validate limits
    if len(terms) > MAX_KEY_TERMS:
        raise ValueError(f"Too many key terms: {len(terms)} exceeds limit of {MAX_KEY_TERMS}")

    for term in terms:
        if len(term) > MAX_KEY_TERM_LENGTH:
            raise ValueError(f"Key term too long: '{term[:20]}...' exceeds {MAX_KEY_TERM_LENGTH} characters")

    return terms


class ProjectBase(BaseModel):
    title: Optional[str] = None


class ProjectCreate(ProjectBase):
    filename: str = Field(..., description="Original filename for the uploaded media")
    content_type: Optional[str] = Field(default="application/octet-stream")
    key_terms: Optional[list[str]] = Field(
        default=None,
        description="Optional key terms to improve transcription accuracy for obscure words"
    )

    @field_validator("key_terms", mode="before")
    @classmethod
    def parse_and_validate_key_terms(cls, v: Optional[list[str]]) -> Optional[list[str]]:
        return _parse_and_validate_key_terms(v, allow_empty=False)


class ProjectRead(ProjectBase):
    id: str
    status: str
    source_object_key: str
    duration_seconds: Optional[int] = None
    key_terms: Optional[list[str]] = None
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


class KeyTermsUpdate(BaseModel):
    """Schema for updating key terms on an existing project."""
    key_terms: list[str] = Field(
        default_factory=list,
        description="New key terms to replace existing ones"
    )

    @field_validator("key_terms", mode="before")
    @classmethod
    def parse_and_validate_key_terms(cls, v: Optional[list[str]]) -> list[str]:
        return _parse_and_validate_key_terms(v, allow_empty=True) or []


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


class ChunkRead(BaseModel):
    """Consolidated transcript chunk for front-end display."""
    id: str
    project_id: str
    speaker_id: str | None = None
    start_ms: int
    end_ms: int
    text: str
    is_edited: bool
    is_filler: bool
    source_segment_ids: list[str] | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ChunkUpdate(BaseModel):
    """Update a chunk (marks it as edited)."""
    text: str | None = None
    speaker_id: str | None = None
