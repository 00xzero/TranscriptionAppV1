"""
Transcript Consolidation Service

Merges fragmented transcription segments into larger, readable chunks.
This post-processing step runs after raw segments are imported from
the transcription API.

Key features:
- Time-gap and duration guardrails
- Speaker boundary enforcement
- Filler detection ("K.", "yeah", etc.)
- Sentence boundary awareness
- Word-level timing preservation via ChunkWord junction
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional
from uuid import uuid4

from sqlalchemy.orm import Session

from ..models import Segment, Word, Chunk, ChunkWord


# ============================================================================
# Configuration
# ============================================================================

@dataclass
class ConsolidationConfig:
    """Tunable parameters for the consolidation algorithm."""
    
    # Soft target for words per chunk (triggers break at sentence boundary)
    target_words: int = 60
    
    # Hard break if pause between segments exceeds this (milliseconds)
    max_gap_ms: int = 2000
    
    # Hard cap on chunk duration (milliseconds)
    max_duration_ms: int = 15000  # Reduced from 18s to enforce 15s limit (AC-5)
    
    # Fragments with <= this many words get absorbed into adjacent chunks
    min_absorb_words: int = 3
    
    # Patterns to tag as filler (case-insensitive, matched at start after strip)
    filler_patterns: tuple[str, ...] = (
        "k.", "okay.", "ok.", "yeah.", "yes.", "no.", "mm.", "mhmm.", 
        "uh.", "um.", "hmm.", "right.", "sure.", "so.", "well.",
        "yep.", "nope.", "oh.", "ah.", "alright.",
    )
    
    # Algorithm version for lineage tracking
    algo_version: str = "v1.3"


# Default configuration instance
DEFAULT_CONFIG = ConsolidationConfig()


# ============================================================================
# Data Structures
# ============================================================================

@dataclass
class SegmentData:
    """Lightweight segment representation for consolidation logic."""
    id: str
    speaker_id: Optional[str]
    start_ms: int
    end_ms: int
    text: str
    word_ids: list[str] = field(default_factory=list)
    
    @property
    def word_count(self) -> int:
        return len(self.text.split())
    
    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms


@dataclass
class ChunkData:
    """Accumulated chunk during the merging process."""
    speaker_id: Optional[str]
    start_ms: int
    end_ms: int
    texts: list[str] = field(default_factory=list)
    source_segment_ids: list[str] = field(default_factory=list)
    word_ids: list[str] = field(default_factory=list)
    
    @property
    def text(self) -> str:
        return " ".join(self.texts)
    
    @property
    def word_count(self) -> int:
        return len(self.text.split())
    
    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms
    
    def merge(self, segment: SegmentData) -> None:
        """Absorb a segment into this chunk."""
        self.texts.append(segment.text.strip())
        self.source_segment_ids.append(segment.id)
        self.word_ids.extend(segment.word_ids)
        self.end_ms = segment.end_ms


# ============================================================================
# Core Algorithm
# ============================================================================

def _is_sentence_boundary(text: str) -> bool:
    """Check if text ends at a natural sentence boundary."""
    stripped = text.rstrip()
    return stripped.endswith(('.', '?', '!', '"', "'"))


def _is_filler(text: str, patterns: tuple[str, ...]) -> bool:
    """Check if text matches a filler pattern."""
    normalized = text.strip().lower()
    # Exact match for short fillers
    if normalized in patterns:
        return True
    # Check if it's just the filler word
    for pattern in patterns:
        if normalized == pattern.rstrip('.'):
            return True
    return False


def _normalize_text(texts: list[str]) -> str:
    """
    Concatenate texts with proper spacing and punctuation.
    
    Handles:
    - Double spaces
    - Missing spaces after punctuation
    - Excessive punctuation
    """
    combined = " ".join(t.strip() for t in texts if t.strip())
    
    # Fix double spaces
    combined = re.sub(r'\s+', ' ', combined)
    
    # Ensure space after sentence-ending punctuation if followed by letter
    combined = re.sub(r'([.!?])([A-Za-z])', r'\1 \2', combined)
    
    return combined.strip()


def consolidate_segments(
    segments: list[SegmentData],
    config: ConsolidationConfig = DEFAULT_CONFIG,
) -> list[ChunkData]:
    """
    Main consolidation algorithm.
    
    Groups segments by speaker and merges adjacent segments into chunks
    based on timing, duration, and sentence boundaries.
    
    Args:
        segments: List of segment data, should be pre-sorted by start_ms
        config: Consolidation parameters
    
    Returns:
        List of consolidated chunks
    """
    if not segments:
        return []
    
    # Sort by start time (should already be sorted, but be safe)
    segments = sorted(segments, key=lambda s: s.start_ms)
    
    chunks: list[ChunkData] = []
    current_chunk: Optional[ChunkData] = None
    
    for segment in segments:
        # Start first chunk
        if current_chunk is None:
            current_chunk = ChunkData(
                speaker_id=segment.speaker_id,
                start_ms=segment.start_ms,
                end_ms=segment.end_ms,
                texts=[segment.text.strip()],
                source_segment_ids=[segment.id],
                word_ids=list(segment.word_ids),
            )
            continue
        
        # Calculate gap from previous segment
        gap_ms = segment.start_ms - current_chunk.end_ms
        
        # Check for speaker change
        speaker_changed = segment.speaker_id != current_chunk.speaker_id
        
        # Check hard break conditions
        should_break = (
            speaker_changed
            or gap_ms > config.max_gap_ms
            or current_chunk.duration_ms + segment.duration_ms > config.max_duration_ms
        )
        
        # Check soft break conditions (word count + sentence boundary)
        soft_break = (
            current_chunk.word_count >= config.target_words
            and _is_sentence_boundary(current_chunk.text)
        )
        
        if should_break or soft_break:
            # Finalize current chunk and start new one
            chunks.append(current_chunk)
            current_chunk = ChunkData(
                speaker_id=segment.speaker_id,
                start_ms=segment.start_ms,
                end_ms=segment.end_ms,
                texts=[segment.text.strip()],
                source_segment_ids=[segment.id],
                word_ids=list(segment.word_ids),
            )
        else:
            # Merge into current chunk
            current_chunk.merge(segment)
    
    # Don't forget the last chunk
    if current_chunk is not None:
        chunks.append(current_chunk)
    
    return chunks


# ============================================================================
# Database Operations
# ============================================================================

def consolidate_and_save_chunks(
    db: Session,
    project_id: str,
    config: ConsolidationConfig = DEFAULT_CONFIG,
) -> list[Chunk]:
    """
    Load segments from database, consolidate them, and save as chunks.
    
    This is the main entry point called from the worker after transcription.
    
    Args:
        db: SQLAlchemy session
        project_id: Project to consolidate
        config: Consolidation parameters
    
    Returns:
        List of created Chunk objects
    """
    # Load segments with their words
    segments = (
        db.query(Segment)
        .filter(Segment.project_id == project_id)
        .order_by(Segment.start_ms.asc())
        .all()
    )
    
    if not segments:
        return []
    
    # Build segment data with word IDs
    segment_data_list: list[SegmentData] = []
    for seg in segments:
        words = (
            db.query(Word)
            .filter(Word.segment_id == seg.id)
            .order_by(Word.order_index.asc())
            .all()
        )
        segment_data_list.append(SegmentData(
            id=seg.id,
            speaker_id=seg.speaker_id,
            start_ms=seg.start_ms,
            end_ms=seg.end_ms,
            text=seg.text,
            word_ids=[w.id for w in words],
        ))
    
    # Run consolidation algorithm
    chunk_data_list = consolidate_segments(segment_data_list, config)
    
    # Clear any existing UNEDITED chunks for this project (preserve user edits)
    # P1 FIX: Filter by is_edited=False to avoid data loss on re-consolidation
    db.query(ChunkWord).filter(
        ChunkWord.chunk_id.in_(
            db.query(Chunk.id).filter(
                Chunk.project_id == project_id,
                Chunk.is_edited == False  # Only delete unedited chunks
            )
        )
    ).delete(synchronize_session=False)
    db.query(Chunk).filter(
        Chunk.project_id == project_id,
        Chunk.is_edited == False  # Only delete unedited chunks
    ).delete(synchronize_session=False)
    
    # Create new chunks
    created_chunks: list[Chunk] = []
    
    for chunk_data in chunk_data_list:
        # Normalize and clean the text
        normalized_text = _normalize_text(chunk_data.texts)
        
        # Detect filler
        is_filler = (
            chunk_data.word_count <= config.min_absorb_words
            and _is_filler(normalized_text, config.filler_patterns)
        )
        
        chunk = Chunk(
            id=str(uuid4()),
            project_id=project_id,
            speaker_id=chunk_data.speaker_id,
            start_ms=chunk_data.start_ms,
            end_ms=chunk_data.end_ms,
            text=normalized_text,
            source_segment_ids=chunk_data.source_segment_ids,
            is_edited=False,
            is_filler=is_filler,
            algo_version=config.algo_version,
        )
        db.add(chunk)
        db.flush()  # Get the ID
        
        # Create ChunkWord links
        for idx, word_id in enumerate(chunk_data.word_ids):
            chunk_word = ChunkWord(
                id=str(uuid4()),
                chunk_id=chunk.id,
                word_id=word_id,
                order_index=idx,
            )
            db.add(chunk_word)
        
        created_chunks.append(chunk)
    
    return created_chunks
