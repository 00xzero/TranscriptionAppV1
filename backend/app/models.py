from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from sqlalchemy import String, DateTime, Integer, ForeignKey, Float, JSON, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    title: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="created", nullable=False, index=True)
    source_object_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    # relationships
    speakers: Mapped[list[Speaker]] = relationship("Speaker", back_populates="project", cascade="all, delete-orphan")  # type: ignore[name-defined]
    segments: Mapped[list[Segment]] = relationship("Segment", back_populates="project", cascade="all, delete-orphan")  # type: ignore[name-defined]
    watchlist_terms: Mapped[list[Watchlist]] = relationship("Watchlist", back_populates="project", cascade="all, delete-orphan")  # type: ignore[name-defined]
    jobs: Mapped[list[Job]] = relationship("Job", back_populates="project", cascade="all, delete-orphan")  # type: ignore[name-defined]
    chunks: Mapped[list["Chunk"]] = relationship("Chunk", back_populates="project", cascade="all, delete-orphan")  # type: ignore[name-defined]


class Speaker(Base):
    __tablename__ = "speakers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(128), default="Speaker")
    color: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    project: Mapped[Project] = relationship("Project", back_populates="speakers")
    segments: Mapped[list[Segment]] = relationship("Segment", back_populates="speaker")  # type: ignore[name-defined]
    chunks: Mapped[list["Chunk"]] = relationship("Chunk", back_populates="speaker")  # type: ignore[name-defined]


class Segment(Base):
    __tablename__ = "segments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    speaker_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("speakers.id", ondelete="SET NULL"), nullable=True, index=True)
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    project: Mapped[Project] = relationship("Project", back_populates="segments")
    speaker: Mapped[Optional[Speaker]] = relationship("Speaker", back_populates="segments")
    words: Mapped[list[Word]] = relationship("Word", back_populates="segment", cascade="all, delete-orphan")  # type: ignore[name-defined]


class Word(Base):
    __tablename__ = "words"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    segment_id: Mapped[str] = mapped_column(String(36), ForeignKey("segments.id", ondelete="CASCADE"), index=True)
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(String(256))
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    segment: Mapped[Segment] = relationship("Segment", back_populates="words")


class Chunk(Base):
    """
    Consolidated transcript chunks created by merging adjacent segments.
    
    This is the primary data source for front-end display. Raw segments
    are preserved for lineage/auditability but not shown in the UI.
    """
    __tablename__ = "chunks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    speaker_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("speakers.id", ondelete="SET NULL"), nullable=True, index=True)
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text, default="")
    
    # Lineage tracking
    source_segment_ids: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)  # Ordered list of original segment IDs
    
    # Edit state
    is_edited: Mapped[bool] = mapped_column(Boolean, default=False)
    is_filler: Mapped[bool] = mapped_column(Boolean, default=False)  # Tag short acknowledgements (e.g., "K.", "yeah")
    
    # Algorithm versioning for safe re-consolidation
    algo_version: Mapped[str] = mapped_column(String(16), default="v1.0")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    project: Mapped[Project] = relationship("Project", back_populates="chunks")
    speaker: Mapped[Optional[Speaker]] = relationship("Speaker", back_populates="chunks")
    chunk_words: Mapped[list["ChunkWord"]] = relationship("ChunkWord", back_populates="chunk", cascade="all, delete-orphan")


class ChunkWord(Base):
    """
    Junction table linking chunks to original words for word-level timing.
    
    Preserves the ability to highlight individual words during playback
    while working with consolidated chunks.
    """
    __tablename__ = "chunk_words"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    chunk_id: Mapped[str] = mapped_column(String(36), ForeignKey("chunks.id", ondelete="CASCADE"), index=True)
    word_id: Mapped[str] = mapped_column(String(36), ForeignKey("words.id", ondelete="CASCADE"), index=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    chunk: Mapped[Chunk] = relationship("Chunk", back_populates="chunk_words")
    word: Mapped[Word] = relationship("Word")


class Watchlist(Base):
    __tablename__ = "watchlist"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    term: Mapped[str] = mapped_column(String(256))
    canonical: Mapped[str] = mapped_column(String(256))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    project: Mapped[Project] = relationship("Project", back_populates="watchlist_terms")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    celery_task_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    type: Mapped[str] = mapped_column(String(32), default="transcribe")
    status: Mapped[str] = mapped_column(String(32), default="queued")
    payload: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    project: Mapped[Project] = relationship("Project", back_populates="jobs")
