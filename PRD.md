# Product Requirements Document (PRD)

## Product: Lightweight Transcription Web App

---

## 1. Overview

A web application that ingests audio/video files and generates high-quality transcripts using state-of-the-art speech-to-text APIs. The app will support **speaker diarization**, **custom vocabulary correction**, **export formats (DOCX, VTT)**, and an **inline transcript editor** with bulk edit capabilities.

### One-liner

A privacy-friendly transcription tool powered by **Deepgram Nova 3**, with speaker detection, watchlist correction, editing, and easy export.

---

## 2. Goals & Non-Goals

### Goals

* Provide accurate, timestamped transcription.
* Automatically detect and tag speakers.
* Support exports: DOCX and VTT.
* Enable custom vocabularies for domain-specific terms.
* Offer an inline editor with bulk edit capabilities.

### Non-Goals

* No collaboration or real-time co-editing (v1).
* No billing/subscription/paywall features (v1).
* No fallback to self-hosted Whisper (cost controlled by sensible file cap).

---

## 3. User Stories

* **As a researcher**, I want to upload a long interview and get an accurate transcript with speakers labeled, so I can analyze it quickly.
* **As a video editor**, I want to export a .vtt file, so I can sync captions with my video.
* **As a consultant**, I want to define terms like “PAS-X” so they’re always spelled correctly.
* **As a user**, I want to correct multiple misrecognized words at once, so I don’t waste time editing line by line.

---

## 4. Key Features

### 4.1 Upload & Transcription

* Drag-and-drop audio/video files (.mp3, .wav, .m4a, .aac, .flac, .mp4, .mov, .mkv).
* Automatic extraction of audio from video.
* Support files up to **1.5 GB** or **4 hours**.
* **Sensible cap enforced**: files beyond this are rejected.

### 4.2 Speech-to-Text

* **API: Deepgram Nova 3 (prerecorded transcription)**

  * Upload of recorded audio or video, or provide a pre-signed URL.
  * Strong accuracy, supports async/batch transcription.
  * Features include diarization, paragraphs/utterances, smart formatting, and keyword boosting (custom vocabulary).
  * Cost: refer to vendor pricing page for the latest rates.

### 4.3 Speaker Diarization

* Use Deepgram’s built-in **speaker diarization**.
* Editable speaker labels in UI.

### 4.4 Vocabulary Watchlist

* Users add terms (e.g., “PAS-X”, “Val de Reuil”).
* Deepgram supports **keywords (boosted terms)**.
* Post-processing correction available as fallback.

### 4.5 Transcript Editing

* Inline editor with autosave.
* Word-level timestamps from API.
* Speaker reassignment, segment split/merge.
* **Bulk Find & Replace** with regex and preview.
* Undo/redo history.

### 4.6 Export Options

* **DOCX**: structured by speaker turns, optional timestamps.
* **VTT**: segmented by 3–6 seconds with proper formatting.
* Metadata footer (watchlist applied, generation date).

---

## 5. User Experience

### Pages

1. **Upload**: upload file, choose options (language, diarization, watchlist terms).
2. **Projects List**: list of processed/transcribing projects.
3. **Editor**: waveform, transcript, speakers, find/replace, exports.

### Editor Layout

* **Left**: waveform with playhead.
* **Center**: transcript grouped by speaker turns.
* **Right**: speaker list (rename/color).
* **Toolbar**: find/replace, apply watchlist, export dropdown.

### Shortcuts

* Space = play/pause.
* ←/→ = seek ±2s.
* Ctrl/Cmd+F = find.
* Ctrl/Cmd+H = replace.
* Ctrl/Cmd+S = save.

---

## 6. Architecture

### Frontend

* Framework: **Next.js 14 (App Router)**, TypeScript.
* Styling: Tailwind CSS.
* Audio player: **wavesurfer.js**.
* State: Zustand or React Query.

### Backend

* Framework: **FastAPI (Python 3.11)**.
* Workers: Celery + Redis.
* Storage: PostgreSQL + MinIO (S3-compatible).
* **Speech-to-text pipeline**: via Deepgram API (Nova 3 model).
* Media handling: ffmpeg for preprocessing.

### Deployment

* Dockerized services (frontend, API, worker, Redis, Postgres, MinIO).
* Nginx reverse proxy.
* Scales horizontally by queueing Deepgram transcription jobs.

---

## 7. Data Model (simplified)

* **Project**: metadata (title, status, source file, duration).
* **Speaker**: label, color.
* **Segment**: text, timestamps, linked to speaker.
* **Word**: per-segment with timestamps/confidence.
* **Watchlist**: terms and canonical forms.
* **Job**: background tasks (transcribe, diarize, export).

---

## 8. API Endpoints (examples)

* `POST /projects` → create project, return upload URL.
* `POST /projects/{id}/start` → send media URL to Deepgram (Nova 3) for transcription.
* `GET /projects/{id}` → project metadata.
* `GET /projects/{id}/segments` → transcript data.
* `PATCH /speakers/{id}` → rename speaker.
* `POST /projects/{id}/bulk-replace` → run bulk edit.
* `POST /projects/{id}/export/vtt` → generate VTT file.
* `POST /projects/{id}/export/docx` → generate DOCX file.

---

## 9. Performance Targets

* 60-min file processed via Deepgram Nova 3 in **≤ 30 min** (async mode).
* Bulk replace applied in **< 1s** for 1-hour transcript.
* Editor autosave every 5s; no more than 1s data loss on crash.

---

## 10. Privacy & Security

* Signed S3 upload/download URLs.
* Media auto-deletion enforced: **1 day retention period**.
* HTTPS enforced.
* JWT authentication (v2), single-user locked in v1.

---

## 11. Acceptance Criteria

* Upload file → Deepgram (Nova 3) transcript generated with labeled speakers.
* Watchlist terms recognized/corrected.
* Editor supports inline edits, bulk replace, undo/redo.
* Exports produce valid DOCX and VTT files.
* Meets performance and privacy requirements.

---

## 12. Stretch Features (Future)

* Multi-user collaboration.
* Automatic summarization.
* Entity highlighting (e.g., legal codes, product names).
* Real-time transcription for live calls (Deepgram real-time API).

---

## 13. Open Questions

* None at this stage; Deepgram Nova 3 selected as the STT provider.
* Retention set to 1 day.
* Sensible cap on file size/duration replaces fallback self-hosted Whisper.
