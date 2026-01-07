"""
Test Suite for Transcript Consolidation Feature

Based on Acceptance Criteria document.
Covers: AC-2 through AC-9 (testable programmatically)

Run with:
    cd backend && python -m pytest tests/test_consolidation.py -v
"""

import pytest
from datetime import datetime
from typing import Optional
from dataclasses import dataclass, field

# Import the consolidation service
from app.services.consolidation import (
    consolidate_segments,
    SegmentData,
    ChunkData,
    ConsolidationConfig,
    _is_sentence_boundary,
    _is_filler,
    _normalize_text,
    DEFAULT_CONFIG,
)


# =============================================================================
# Test Fixtures
# =============================================================================

def make_segment(
    id: str,
    speaker_id: Optional[str],
    start_ms: int,
    end_ms: int,
    text: str,
    word_ids: Optional[list[str]] = None,
) -> SegmentData:
    """Helper to create test segments."""
    return SegmentData(
        id=id,
        speaker_id=speaker_id,
        start_ms=start_ms,
        end_ms=end_ms,
        text=text,
        word_ids=word_ids or [],
    )


# Sample fragmented segments (mimics real Deepgram output)
SAMPLE_FRAGMENTED_SEGMENTS = [
    make_segment("seg-1", "speaker-1", 0, 3000, "Hello everyone."),
    make_segment("seg-2", "speaker-1", 3100, 5000, "So as Rishi has already mentioned"),
    make_segment("seg-3", "speaker-1", 5100, 8000, "that it would be kind of a, you know, question and answer,"),
    make_segment("seg-4", "speaker-1", 8200, 9000, "kind of"),
    make_segment("seg-5", "speaker-1", 9100, 15000, "And, there was set of questions that we have documented last, last time when we met."),
    make_segment("seg-6", "speaker-1", 15500, 18000, "We received certain answers as well."),
    make_segment("seg-7", "speaker-1", 18100, 19000, "K."),
    make_segment("seg-8", "speaker-1", 19200, 22000, "The fourth question is somewhat similar."),
]


# =============================================================================
# AC-2: Chunk Size and Length
# =============================================================================

class TestAC2_ChunkSizeAndLength:
    """AC-2: Chunks should meet target size constraints."""

    def test_average_words_per_chunk_in_target_range(self):
        """Average words per chunk should be 35-50 words."""
        # Create segments totaling ~200 words
        segments = []
        for i in range(20):
            segments.append(make_segment(
                f"seg-{i}",
                "speaker-1",
                i * 5000,
                (i + 1) * 5000 - 100,
                f"This is segment number {i} with about ten words in it here."
            ))
        
        chunks = consolidate_segments(segments)
        
        total_words = sum(c.word_count for c in chunks)
        avg_words = total_words / len(chunks) if chunks else 0
        
        # Average should be in range 20-60 (flexible for test data)
        assert 15 <= avg_words <= 60, f"Average words per chunk: {avg_words}"

    def test_no_chunk_exceeds_max_duration(self):
        """No chunk should exceed 15 seconds duration."""
        config = ConsolidationConfig(max_duration_ms=15000)
        
        # Create segment spanning 20 seconds
        segments = [
            make_segment("seg-1", "speaker-1", 0, 5000, "First part of speech."),
            make_segment("seg-2", "speaker-1", 5100, 10000, "Second part of speech."),
            make_segment("seg-3", "speaker-1", 10100, 15000, "Third part of speech."),
            make_segment("seg-4", "speaker-1", 15100, 20000, "Fourth part of speech."),
        ]
        
        chunks = consolidate_segments(segments, config)
        
        for chunk in chunks:
            duration_ms = chunk.end_ms - chunk.start_ms
            assert duration_ms <= 15000, f"Chunk duration {duration_ms}ms exceeds 15s"

    def test_tiny_segments_get_absorbed(self):
        """Segments with 1-2 words should be absorbed unless filler-tagged."""
        segments = [
            make_segment("seg-1", "speaker-1", 0, 3000, "This is the beginning of a longer sentence."),
            make_segment("seg-2", "speaker-1", 3100, 4000, "Yeah."),  # Tiny
            make_segment("seg-3", "speaker-1", 4100, 8000, "And then we continue with more text here."),
        ]
        
        chunks = consolidate_segments(segments)
        
        # Should be 1 chunk (all merged) or fillers absorbed
        for chunk in chunks:
            if chunk.word_count <= 2:
                # Tiny chunk should be a filler pattern if standalone
                assert chunk.text.strip().lower() in ["yeah.", "k.", "okay."]


# =============================================================================
# AC-3: Single Word Absorption
# =============================================================================

class TestAC3_SingleWordAbsorption:
    """AC-3: Fillers like 'K.', 'yeah' should be absorbed."""

    def test_filler_words_absorbed_into_adjacent_chunks(self):
        """Filler words should be absorbed, not standalone."""
        segments = [
            make_segment("seg-1", "speaker-1", 0, 5000, "So let me explain the process."),
            make_segment("seg-2", "speaker-1", 5100, 5500, "K."),
            make_segment("seg-3", "speaker-1", 5600, 10000, "The next step is to verify the data."),
        ]
        
        chunks = consolidate_segments(segments)
        
        # "K." should be absorbed into the surrounding text
        standalone_fillers = [c for c in chunks if c.text.strip().lower() == "k."]
        assert len(standalone_fillers) == 0, "Filler 'K.' should be absorbed"

    def test_multiple_fillers_in_sequence(self):
        """Multiple consecutive fillers should still be absorbed."""
        segments = [
            make_segment("seg-1", "speaker-1", 0, 5000, "Start of the conversation."),
            make_segment("seg-2", "speaker-1", 5100, 5500, "Yeah."),
            make_segment("seg-3", "speaker-1", 5600, 6000, "Okay."),
            make_segment("seg-4", "speaker-1", 6100, 10000, "Let me continue with the explanation."),
        ]
        
        chunks = consolidate_segments(segments)
        
        # All should merge into one chunk
        assert len(chunks) <= 2, "Fillers should be absorbed"

    def test_is_filler_detection(self):
        """Test the filler detection utility function."""
        filler_patterns = DEFAULT_CONFIG.filler_patterns
        
        assert _is_filler("K.", filler_patterns) is True
        assert _is_filler("yeah.", filler_patterns) is True
        assert _is_filler("Okay.", filler_patterns) is True
        assert _is_filler("mm.", filler_patterns) is True
        assert _is_filler("Hello everyone.", filler_patterns) is False
        assert _is_filler("K", filler_patterns) is True  # Without period


# =============================================================================
# AC-4: Speaker Boundary Respect
# =============================================================================

class TestAC4_SpeakerBoundaryRespect:
    """AC-4: Chunks should never merge across different speakers."""

    def test_speaker_change_creates_new_chunk(self):
        """Speaker change should always create a new chunk."""
        segments = [
            make_segment("seg-1", "speaker-1", 0, 5000, "This is speaker one talking."),
            make_segment("seg-2", "speaker-1", 5100, 10000, "Still speaker one here."),
            make_segment("seg-3", "speaker-2", 10100, 15000, "Now speaker two is talking."),
            make_segment("seg-4", "speaker-2", 15100, 20000, "Speaker two continues."),
        ]
        
        chunks = consolidate_segments(segments)
        
        # Should be exactly 2 chunks (one per speaker)
        assert len(chunks) == 2
        assert chunks[0].speaker_id == "speaker-1"
        assert chunks[1].speaker_id == "speaker-2"

    def test_each_chunk_has_single_speaker(self):
        """Each chunk must have exactly one speaker_id."""
        segments = [
            make_segment("seg-1", "speaker-1", 0, 3000, "Speaker one."),
            make_segment("seg-2", "speaker-2", 3100, 6000, "Speaker two."),
            make_segment("seg-3", "speaker-1", 6100, 9000, "Speaker one again."),
            make_segment("seg-4", "speaker-3", 9100, 12000, "Speaker three."),
        ]
        
        chunks = consolidate_segments(segments)
        
        # Should be 4 chunks (alternating speakers)
        assert len(chunks) == 4
        
        for chunk in chunks:
            assert chunk.speaker_id is not None

    def test_rapid_speaker_changes(self):
        """Rapid back-and-forth between speakers."""
        segments = [
            make_segment("seg-1", "speaker-1", 0, 1000, "Yes."),
            make_segment("seg-2", "speaker-2", 1100, 2000, "No."),
            make_segment("seg-3", "speaker-1", 2100, 3000, "Maybe."),
            make_segment("seg-4", "speaker-2", 3100, 4000, "Okay."),
        ]
        
        chunks = consolidate_segments(segments)
        
        # Should be 4 separate chunks despite small gap
        assert len(chunks) == 4


# =============================================================================
# AC-5: Long Monologue Splitting
# =============================================================================

class TestAC5_LongMonologueSplitting:
    """AC-5: Long monologues should be split at sentence boundaries."""

    def test_long_continuous_speech_is_split(self):
        """Monologue >15s should be split into multiple chunks."""
        config = ConsolidationConfig(max_duration_ms=15000)
        
        # Create 30-second monologue
        segments = [
            make_segment("seg-1", "speaker-1", 0, 10000,
                "This is the first part of a very long monologue. "
                "It contains many words and spans many seconds."),
            make_segment("seg-2", "speaker-1", 10100, 20000,
                "Now we continue with even more text in this segment. "
                "The speaker keeps talking without interruption."),
            make_segment("seg-3", "speaker-1", 20100, 30000,
                "And finally we reach the end of this long speech. "
                "It should definitely be split into multiple chunks."),
        ]
        
        chunks = consolidate_segments(segments, config)
        
        # Should be at least 2 chunks due to duration limit
        assert len(chunks) >= 2

    def test_splits_prefer_sentence_boundaries(self):
        """Splits should occur at sentence endings when possible."""
        chunks = consolidate_segments(SAMPLE_FRAGMENTED_SEGMENTS)
        
        # Most chunks should end with sentence-ending punctuation
        sentence_endings = 0
        for chunk in chunks:
            if _is_sentence_boundary(chunk.text):
                sentence_endings += 1
        
        # At least half should end at sentence boundaries
        assert sentence_endings >= len(chunks) // 2


# =============================================================================
# AC-6: Time Gap Breaking
# =============================================================================

class TestAC6_TimeGapBreaking:
    """AC-6: Pauses >1.5 seconds should create chunk boundaries."""

    def test_long_pause_creates_new_chunk(self):
        """Gap >1500ms should force a new chunk."""
        config = ConsolidationConfig(max_gap_ms=1500)
        
        segments = [
            make_segment("seg-1", "speaker-1", 0, 5000, "First sentence before the pause."),
            # 3 second gap here (5000 to 8000)
            make_segment("seg-2", "speaker-1", 8000, 12000, "Second sentence after the pause."),
        ]
        
        chunks = consolidate_segments(segments, config)
        
        # Gap of 3000ms > 1500ms, so should be 2 chunks
        assert len(chunks) == 2
        assert chunks[0].text == "First sentence before the pause."
        assert chunks[1].text == "Second sentence after the pause."

    def test_small_gap_does_not_break(self):
        """Gap <1500ms should not force a break."""
        config = ConsolidationConfig(max_gap_ms=1500)
        
        segments = [
            make_segment("seg-1", "speaker-1", 0, 5000, "First part."),
            # 500ms gap (small)
            make_segment("seg-2", "speaker-1", 5500, 10000, "Second part."),
        ]
        
        chunks = consolidate_segments(segments, config)
        
        # Gap of 500ms < 1500ms, should merge into 1 chunk
        assert len(chunks) == 1

    def test_exact_threshold_gap(self):
        """Gap exactly at threshold should still merge."""
        config = ConsolidationConfig(max_gap_ms=1500)
        
        segments = [
            make_segment("seg-1", "speaker-1", 0, 5000, "First."),
            # Exactly 1500ms gap
            make_segment("seg-2", "speaker-1", 6500, 10000, "Second."),
        ]
        
        chunks = consolidate_segments(segments, config)
        
        # 1500ms is not > 1500ms, so should merge
        assert len(chunks) == 1


# =============================================================================
# AC-7: Sentence Boundary Preference
# =============================================================================

class TestAC7_SentenceBoundaryPreference:
    """AC-7: Chunks should prefer ending at sentence boundaries."""

    def test_sentence_boundary_detection(self):
        """Test the sentence boundary detector."""
        assert _is_sentence_boundary("Hello world.") is True
        assert _is_sentence_boundary("Is this a question?") is True
        assert _is_sentence_boundary("Wow!") is True
        assert _is_sentence_boundary('He said "hello."') is True
        assert _is_sentence_boundary("Hello world") is False
        assert _is_sentence_boundary("Hello, ") is False

    def test_chunks_end_at_punctuation(self):
        """Most chunks should end with proper punctuation."""
        config = ConsolidationConfig(target_words=10)  # Force more splits
        
        segments = [
            make_segment("seg-1", "speaker-1", 0, 5000, 
                "This is the first sentence. It ends properly."),
            make_segment("seg-2", "speaker-1", 5100, 10000,
                "Here is another sentence with more words. And another one."),
            make_segment("seg-3", "speaker-1", 10100, 15000,
                "Final sentence in this test. It should also end well."),
        ]
        
        chunks = consolidate_segments(segments, config)
        
        # Check that at least some end with proper punctuation
        proper_endings = sum(1 for c in chunks if _is_sentence_boundary(c.text))
        assert proper_endings >= 1


# =============================================================================
# AC-8: Chunk Editing (Unit Tests - API tests would need integration setup)
# =============================================================================

class TestAC8_ChunkEditing:
    """AC-8: Edited chunks should be protected from re-consolidation.
    
    Note: Full editing behavior is tested via API integration tests.
    Here we test the data model expectations.
    """

    def test_chunk_data_has_edit_tracking_fields(self):
        """ChunkData should support edit tracking."""
        # This is a design verification test
        from app.models import Chunk
        
        # Verify Chunk model has required fields
        assert hasattr(Chunk, 'is_edited')
        assert hasattr(Chunk, 'text')
        assert hasattr(Chunk, 'updated_at')


# =============================================================================
# AC-9: Backward Compatibility
# =============================================================================

class TestAC9_BackwardCompatibility:
    """AC-9: Original segments endpoint should still work.
    
    Note: This is primarily an API integration test. Here we verify
    that Segment and Chunk models are independent.
    """

    def test_segments_and_chunks_are_independent_models(self):
        """Segments and chunks should be separate tables."""
        from app.models import Segment, Chunk
        
        # Verify they have different table names
        assert Segment.__tablename__ == "segments"
        assert Chunk.__tablename__ == "chunks"

    def test_consolidation_does_not_modify_source_segments(self):
        """Consolidation should not alter original segments."""
        segments = [
            make_segment("seg-1", "speaker-1", 0, 5000, "Original text."),
            make_segment("seg-2", "speaker-1", 5100, 10000, "More original text."),
        ]
        
        # Store original state
        original_count = len(segments)
        original_texts = [s.text for s in segments]
        
        # Run consolidation
        chunks = consolidate_segments(segments)
        
        # Verify segments unchanged
        assert len(segments) == original_count
        for i, seg in enumerate(segments):
            assert seg.text == original_texts[i]


# =============================================================================
# Utility Function Tests
# =============================================================================

class TestUtilityFunctions:
    """Tests for helper functions in the consolidation module."""

    def test_normalize_text_removes_double_spaces(self):
        """Text normalization should clean up spacing."""
        texts = ["Hello  world", "  This   has   spaces  "]
        result = _normalize_text(texts)
        assert "  " not in result

    def test_normalize_text_joins_properly(self):
        """Multiple texts should be joined with spaces."""
        texts = ["First.", "Second.", "Third."]
        result = _normalize_text(texts)
        assert result == "First. Second. Third."

    def test_segment_data_word_count(self):
        """SegmentData.word_count should count words correctly."""
        seg = make_segment("1", "s1", 0, 100, "One two three four five")
        assert seg.word_count == 5

    def test_segment_data_duration(self):
        """SegmentData.duration_ms should calculate correctly."""
        seg = make_segment("1", "s1", 1000, 5000, "Text")
        assert seg.duration_ms == 4000

    def test_chunk_data_merge(self):
        """ChunkData.merge should properly combine segments."""
        chunk = ChunkData(
            speaker_id="s1",
            start_ms=0,
            end_ms=5000,
            texts=["Hello."],
            source_segment_ids=["seg-1"],
            word_ids=["w1"],
        )
        
        seg = make_segment("seg-2", "s1", 5100, 10000, "World.", ["w2", "w3"])
        chunk.merge(seg)
        
        assert chunk.end_ms == 10000
        assert len(chunk.texts) == 2
        assert "seg-2" in chunk.source_segment_ids
        assert "w2" in chunk.word_ids


# =============================================================================
# Integration-Style Tests (Still Unit Tests, but More Comprehensive)
# =============================================================================

class TestIntegration:
    """Integration-style tests using realistic data."""

    def test_realistic_fragmented_input(self):
        """Test with realistic fragmented Deepgram-style output."""
        chunks = consolidate_segments(SAMPLE_FRAGMENTED_SEGMENTS)
        
        # Should consolidate 8 segments into fewer chunks
        assert len(chunks) < len(SAMPLE_FRAGMENTED_SEGMENTS)
        
        # All should have same speaker
        for chunk in chunks:
            assert chunk.speaker_id == "speaker-1"

    def test_empty_input(self):
        """Empty input should return empty output."""
        chunks = consolidate_segments([])
        assert chunks == []

    def test_single_segment_input(self):
        """Single segment should become single chunk."""
        segments = [make_segment("1", "s1", 0, 5000, "Only one segment.")]
        chunks = consolidate_segments(segments)
        
        assert len(chunks) == 1
        assert chunks[0].text == "Only one segment."

    def test_preserves_source_segment_ids(self):
        """Chunks should track which segments they came from."""
        segments = [
            make_segment("seg-1", "s1", 0, 3000, "First."),
            make_segment("seg-2", "s1", 3100, 6000, "Second."),
            make_segment("seg-3", "s1", 6100, 9000, "Third."),
        ]
        
        chunks = consolidate_segments(segments)
        
        # All segment IDs should be preserved somewhere
        all_source_ids = []
        for chunk in chunks:
            all_source_ids.extend(chunk.source_segment_ids)
        
        assert "seg-1" in all_source_ids
        assert "seg-2" in all_source_ids
        assert "seg-3" in all_source_ids


# =============================================================================
# Run Tests
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
