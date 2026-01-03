from io import BytesIO
from typing import List
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_PARAGRAPH_ALIGNMENT
from datetime import datetime


def generate_docx(
    project_title: str,
    segments: List[dict],
    speakers_map: dict,
    include_timestamps: bool = True
) -> BytesIO:
    """Generate a DOCX file from transcript segments."""
    doc = Document()
    
    # Title
    title = doc.add_paragraph()
    title.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
    run = title.add_run(project_title or "Transcript")
    run.bold = True
    run.font.size = Pt(16)
    
    # Metadata
    meta = doc.add_paragraph()
    meta.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
    meta_run = meta.add_run(f"Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    meta_run.font.size = Pt(10)
    meta_run.font.color.rgb = RGBColor(128, 128, 128)
    
    doc.add_paragraph()  # Spacer
    
    # Group segments by speaker turns
    current_speaker_id = None
    current_paragraph = None
    
    for seg in segments:
        speaker_id = seg.get("speaker_id")
        speaker_label = speakers_map.get(speaker_id, {}).get("label", "Unknown Speaker")
        
        # New speaker or first segment
        if speaker_id != current_speaker_id:
            current_speaker_id = speaker_id
            current_paragraph = doc.add_paragraph()
            
            # Speaker label
            speaker_run = current_paragraph.add_run(f"{speaker_label}: ")
            speaker_run.bold = True
            speaker_run.font.size = Pt(12)
            
        # Add timestamp if requested
        if include_timestamps and current_paragraph:
            start_ms = seg.get("start_ms", 0)
            end_ms = seg.get("end_ms", 0)
            ts = f"[{ms_to_timestamp(start_ms)} - {ms_to_timestamp(end_ms)}] "
            ts_run = current_paragraph.add_run(ts)
            ts_run.font.size = Pt(10)
            ts_run.font.color.rgb = RGBColor(100, 100, 100)
        
        # Add text
        if current_paragraph:
            text_run = current_paragraph.add_run(seg.get("text", ""))
            text_run.font.size = Pt(11)
            current_paragraph.add_run(" ")  # Space between segments
    
    # Save to BytesIO
    buffer = BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer


def generate_vtt(segments: List[dict], speakers_map: dict) -> str:
    """Generate a VTT file from transcript segments."""
    lines = ["WEBVTT", ""]
    
    for idx, seg in enumerate(segments, 1):
        speaker_id = seg.get("speaker_id")
        speaker_label = speakers_map.get(speaker_id, {}).get("label", "Speaker")
        
        start_ms = seg.get("start_ms", 0)
        end_ms = seg.get("end_ms", 0)
        text = seg.get("text", "")
        
        # VTT timestamp format: HH:MM:SS.mmm
        start_vtt = ms_to_vtt_timestamp(start_ms)
        end_vtt = ms_to_vtt_timestamp(end_ms)
        
        lines.append(f"{idx}")
        lines.append(f"{start_vtt} --> {end_vtt}")
        lines.append(f"<v {speaker_label}>{text}")
        lines.append("")
    
    return "\n".join(lines)


def ms_to_timestamp(ms: int) -> str:
    """Convert milliseconds to HH:MM:SS or MM:SS format."""
    total_sec = ms // 1000
    s = total_sec % 60
    m = (total_sec // 60) % 60
    h = total_sec // 3600
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def ms_to_vtt_timestamp(ms: int) -> str:
    """Convert milliseconds to VTT timestamp format (HH:MM:SS.mmm)."""
    total_sec = ms // 1000
    millis = ms % 1000
    s = total_sec % 60
    m = (total_sec // 60) % 60
    h = total_sec // 3600
    return f"{h:02d}:{m:02d}:{s:02d}.{millis:03d}"
