#!/usr/bin/env python3
"""
Quick test script for export functions.
Run from backend directory: python test_exports_manual.py
"""
import sys
from datetime import datetime
from pathlib import Path

# Add app to path
sys.path.insert(0, str(Path(__file__).parent / "app"))

from services.exports import format_duration, generate_docx, generate_vtt, generate_pdf

# Sample data
sample_chunks = [
    {
        "id": "chunk1",
        "speaker_id": "speaker1",
        "start_ms": 4205,
        "end_ms": 10243,
        "text": "Here onwards we started an exercise on transformation readiness for EMEA sites.",
    },
    {
        "id": "chunk2",
        "speaker_id": "speaker1",
        "start_ms": 10243,
        "end_ms": 14546,
        "text": "mostly Helsingborg, Val De Reuil, Sezanne and Wuppertal.",
    },
    {
        "id": "chunk3",
        "speaker_id": "speaker2",
        "start_ms": 37725,
        "end_ms": 43278,
        "text": "Right. So just a few other things, right. So these are the big rocks that we're going to look at.",
    },
]

sample_speakers = {
    "speaker1": {"label": "Mirza, Hafeez", "color": "#6366F1"},
    "speaker2": {"label": "Hamza Abikar", "color": "#10B981"},
}

def test_format_duration():
    """Test duration formatting"""
    print("Testing format_duration...")
    assert format_duration(3898) == "1h 4m 58s"
    assert format_duration(125) == "2m 5s"
    assert format_duration(45) == "45s"
    assert format_duration(3600) == "1h"
    assert format_duration(0) == "0s"
    print("✓ format_duration tests passed")

def test_docx_generation():
    """Test DOCX generation"""
    print("\nTesting DOCX generation...")
    try:
        buffer = generate_docx(
            project_title="Test Transcript",
            chunks=sample_chunks,
            speakers_map=sample_speakers,
            transcription_date=datetime(2025, 8, 12, 12, 42),
            duration_seconds=3898,
        )
        # Save to file for manual inspection
        with open("/tmp/test_export.docx", "wb") as f:
            f.write(buffer.read())
        print("✓ DOCX generated successfully -> /tmp/test_export.docx")
    except Exception as e:
        print(f"✗ DOCX generation failed: {e}")
        raise

def test_vtt_generation():
    """Test VTT generation"""
    print("\nTesting VTT generation...")
    try:
        vtt_content = generate_vtt(
            chunks=sample_chunks,
            speakers_map=sample_speakers,
            project_id="test-project-123"
        )
        # Save to file for manual inspection
        with open("/tmp/test_export.vtt", "w") as f:
            f.write(vtt_content)
        print("✓ VTT generated successfully -> /tmp/test_export.vtt")
        
        # Basic validation
        assert vtt_content.startswith("WEBVTT")
        assert "<v Mirza, Hafeez>" in vtt_content
        assert "<v Hamza Abikar>" in vtt_content
        print("✓ VTT format validation passed")
    except Exception as e:
        print(f"✗ VTT generation failed: {e}")
        raise

def test_pdf_generation():
    """Test PDF generation"""
    print("\nTesting PDF generation...")
    try:
        buffer = generate_pdf(
            project_title="Test Transcript",
            chunks=sample_chunks,
            speakers_map=sample_speakers,
            transcription_date=datetime(2025, 8, 12, 12, 42),
            duration_seconds=3898,
        )
        # Save to file for manual inspection
        with open("/tmp/test_export.pdf", "wb") as f:
            f.write(buffer.read())
        print("✓ PDF generated successfully -> /tmp/test_export.pdf")
    except Exception as e:
        print(f"✗ PDF generation failed: {e}")
        raise

if __name__ == "__main__":
    print("=" * 60)
    print("Testing Export Functions")
    print("=" * 60)
    
    test_format_duration()
    test_docx_generation()
    test_vtt_generation()
    test_pdf_generation()
    
    print("\n" + "=" * 60)
    print("All tests passed! ✓")
    print("=" * 60)
    print("\nGenerated files in /tmp:")
    print("  - test_export.docx")
    print("  - test_export.vtt")
    print("  - test_export.pdf")
    print("\nOpen these files to verify the formatting matches requirements.")
