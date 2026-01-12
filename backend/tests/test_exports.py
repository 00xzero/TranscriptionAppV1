"""
Unit tests for export service functions.
Run with: pytest tests/test_exports.py -v
"""
import pytest
from datetime import datetime
from io import BytesIO

from app.services.exports import (
    format_duration,
    generate_docx,
    generate_vtt,
    generate_pdf,
    ms_to_timestamp,
    ms_to_vtt_timestamp,
)


class TestFormatDuration:
    """Tests for format_duration helper function."""
    
    def test_hours_minutes_seconds(self):
        """Test duration with hours, minutes, and seconds."""
        assert format_duration(3898) == "1h 4m 58s"
    
    def test_minutes_seconds(self):
        """Test duration with minutes and seconds only."""
        assert format_duration(125) == "2m 5s"
    
    def test_seconds_only(self):
        """Test duration with seconds only."""
        assert format_duration(45) == "45s"
    
    def test_exact_hour(self):
        """Test exact hour."""
        assert format_duration(3600) == "1h"
    
    def test_exact_minute(self):
        """Test exact minute."""
        assert format_duration(60) == "1m"
    
    def test_zero_seconds(self):
        """Test zero duration."""
        assert format_duration(0) == "0s"
    
    def test_negative_value(self):
        """Test negative value returns 0s."""
        assert format_duration(-100) == "0s"


class TestTimestampConversions:
    """Tests for timestamp conversion helpers."""
    
    def test_ms_to_timestamp_short(self):
        """Test short timestamp (< 1 hour)."""
        assert ms_to_timestamp(4205) == "0:04"
        assert ms_to_timestamp(65000) == "1:05"
    
    def test_ms_to_timestamp_long(self):
        """Test long timestamp (>= 1 hour)."""
        assert ms_to_timestamp(3665000) == "1:01:05"
    
    def test_ms_to_vtt_timestamp(self):
        """Test VTT timestamp format."""
        assert ms_to_vtt_timestamp(4205) == "00:00:04.205"
        assert ms_to_vtt_timestamp(65000) == "00:01:05.000"
        assert ms_to_vtt_timestamp(3665000) == "01:01:05.000"


class TestGenerateDocx:
    """Tests for DOCX generation."""
    
    @pytest.fixture
    def sample_chunks(self):
        return [
            {"speaker_id": "s1", "start_ms": 4205, "end_ms": 10243, "text": "Hello world."},
            {"speaker_id": "s2", "start_ms": 10500, "end_ms": 15000, "text": "Response text."},
        ]
    
    @pytest.fixture
    def sample_speakers(self):
        return {
            "s1": {"label": "Speaker One", "color": "#FF0000"},
            "s2": {"label": "Speaker Two", "color": "#00FF00"},
        }
    
    def test_returns_bytesio(self, sample_chunks, sample_speakers):
        """Test that generate_docx returns a BytesIO buffer."""
        result = generate_docx(
            project_title="Test",
            chunks=sample_chunks,
            speakers_map=sample_speakers,
            transcription_date=datetime(2025, 1, 15, 10, 30),
            duration_seconds=3600,
        )
        assert isinstance(result, BytesIO)
    
    def test_generates_valid_docx(self, sample_chunks, sample_speakers):
        """Test that output is valid DOCX (starts with PK ZIP header)."""
        result = generate_docx(
            project_title="Test",
            chunks=sample_chunks,
            speakers_map=sample_speakers,
            transcription_date=datetime.now(),
        )
        data = result.read()
        assert data[:2] == b"PK"  # ZIP file header (DOCX is a ZIP archive)
    
    def test_works_without_duration(self, sample_chunks, sample_speakers):
        """Test DOCX generation works when duration is None."""
        result = generate_docx(
            project_title="Test",
            chunks=sample_chunks,
            speakers_map=sample_speakers,
            transcription_date=datetime.now(),
            duration_seconds=None,
        )
        assert isinstance(result, BytesIO)
        assert len(result.read()) > 0


class TestGenerateVtt:
    """Tests for VTT generation."""
    
    @pytest.fixture
    def sample_chunks(self):
        return [
            {"speaker_id": "s1", "start_ms": 4205, "end_ms": 10243, "text": "Hello world."},
            {"speaker_id": "s2", "start_ms": 10500, "end_ms": 15000, "text": "Response."},
        ]
    
    @pytest.fixture
    def sample_speakers(self):
        return {
            "s1": {"label": "Speaker One"},
            "s2": {"label": "Speaker Two"},
        }
    
    def test_returns_string(self, sample_chunks, sample_speakers):
        """Test that generate_vtt returns a string."""
        result = generate_vtt(sample_chunks, sample_speakers, "test-project")
        assert isinstance(result, str)
    
    def test_starts_with_webvtt(self, sample_chunks, sample_speakers):
        """Test VTT starts with WEBVTT header."""
        result = generate_vtt(sample_chunks, sample_speakers, "test-project")
        assert result.startswith("WEBVTT")
    
    def test_contains_speaker_tags(self, sample_chunks, sample_speakers):
        """Test VTT contains speaker voice tags."""
        result = generate_vtt(sample_chunks, sample_speakers, "test-project")
        assert "<v Speaker One>" in result
        assert "<v Speaker Two>" in result
    
    def test_contains_cue_identifiers(self, sample_chunks, sample_speakers):
        """Test VTT contains cue identifiers."""
        result = generate_vtt(sample_chunks, sample_speakers, "test-project")
        assert "test-project/0" in result
        assert "test-project/1" in result
    
    def test_contains_timestamps(self, sample_chunks, sample_speakers):
        """Test VTT contains properly formatted timestamps."""
        result = generate_vtt(sample_chunks, sample_speakers, "test-project")
        assert "00:00:04.205 --> 00:00:10.243" in result


class TestGeneratePdf:
    """Tests for PDF generation."""
    
    @pytest.fixture
    def sample_chunks(self):
        return [
            {"speaker_id": "s1", "start_ms": 4205, "end_ms": 10243, "text": "Hello world."},
        ]
    
    @pytest.fixture
    def sample_speakers(self):
        return {"s1": {"label": "Speaker One"}}
    
    def test_returns_bytesio(self, sample_chunks, sample_speakers):
        """Test that generate_pdf returns a BytesIO buffer."""
        result = generate_pdf(
            project_title="Test",
            chunks=sample_chunks,
            speakers_map=sample_speakers,
            transcription_date=datetime.now(),
        )
        assert isinstance(result, BytesIO)
    
    def test_generates_valid_pdf(self, sample_chunks, sample_speakers):
        """Test that output is valid PDF (starts with %PDF header)."""
        result = generate_pdf(
            project_title="Test",
            chunks=sample_chunks,
            speakers_map=sample_speakers,
            transcription_date=datetime.now(),
            duration_seconds=3600,
        )
        data = result.read()
        assert data[:4] == b"%PDF"
    
    def test_works_without_duration(self, sample_chunks, sample_speakers):
        """Test PDF generation works when duration is None."""
        result = generate_pdf(
            project_title="Test",
            chunks=sample_chunks,
            speakers_map=sample_speakers,
            transcription_date=datetime.now(),
            duration_seconds=None,
        )
        assert isinstance(result, BytesIO)
        assert len(result.read()) > 0
