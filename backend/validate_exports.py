"""Quick export function validation"""
from datetime import datetime
from app.services.exports import format_duration, generate_docx, generate_vtt, generate_pdf

# Test format_duration
print("Testing format_duration...")
assert format_duration(3898) == "1h 4m 58s", f"Expected '1h 4m 58s', got '{format_duration(3898)}'"
assert format_duration(125) == "2m 5s", f"Expected '2m 5s', got '{format_duration(125)}'"
assert format_duration(45) == "45s", f"Expected '45s', got '{format_duration(45)}'"
print("✓ format_duration works correctly")

# Sample data
chunks = [
    {"id": "1", "speaker_id": "s1", "start_ms": 4205, "end_ms": 10243, "text": "Test chunk 1"},
    {"id": "2", "speaker_id": "s2", "start_ms": 37725, "end_ms": 43278, "text": "Test chunk 2"},
]
speakers = {
    "s1": {"label": "Speaker One", "color": "#6366F1"},
    "s2": {"label": "Speaker Two", "color": "#10B981"},
}

# Test DOCX
print("\nTesting DOCX generation...")
docx_buf = generate_docx("Test", chunks, speakers, datetime.now(), 3898)
print(f"✓ DOCX generated ({len(docx_buf.read())} bytes)")

# Test VTT
print("\nTesting VTT generation...")
vtt = generate_vtt(chunks, speakers, "test-proj")
assert vtt.startswith("WEBVTT"), "VTT should start with WEBVTT"
assert "<v Speaker One>" in vtt, "VTT should have speaker tags"
print(f"✓ VTT generated ({len(vtt)} chars)")

# Test PDF
print("\nTesting PDF generation...")
pdf_buf = generate_pdf("Test", chunks, speakers, datetime.now(), 3898)
pdf_data = pdf_buf.read()
assert pdf_data.startswith(b"%PDF"), "PDF should start with %PDF header"
print(f"✓ PDF generated ({len(pdf_data)} bytes)")

print("\n" + "="*50)
print("All export functions validated successfully! ✓")
print("="*50)
