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

*   Multi-user support with secure data isolation (RLS).
*   Provide accurate, timestamped transcription.
*   Automatically detect and tag speakers.
*   Support exports: DOCX and VTT.
*   Enable custom vocabularies for domain-specific terms.
*   Offer an inline editor with bulk edit capabilities.

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
*   Support files up to **1.5 GB** or **4 hours** (Capped at 50MB by default for Supabase Free plan; configurable up to 1.5GB+ via `NEXT_PUBLIC_MAX_FILE_SIZE_MB`).
*   **Sensible cap enforced**: Validation on frontend and backend rejects files beyond the configured limit.

### 4.2 Speech-to-Text

* **API: Deepgram Nova 3 (prerecorded transcription)**

  * Upload of recorded audio or video, or provide a pre-signed URL.
  * Strong accuracy, supports async/batch transcription.
  * Features include diarization, paragraphs/utterances, smart formatting, and keyword boosting (custom vocabulary).
  * Cost: refer to vendor pricing page for the latest rates.

### 4.3 Speaker Diarization

* Use Deepgram’s built-in **speaker diarization**.
* Editable speaker labels in UI.

### 4.4 Vocabulary Watchlist / Key Terms

* ✅ Users add key terms during upload (e.g., "PAS-X", "Val de Reuil").
* ✅ Terms sent to Deepgram via `keyterm` parameter for improved recognition.
* ✅ Limit: 100 terms, 64 chars each (within Deepgram's 500-token limit).
* ✅ Edit & retry flow for failed transcriptions due to term errors.
* ⏳ Post-processing watchlist correction in editor (planned).

### 4.5 Transcript Editing

* ✅ Inline editor with debounced autosave (500ms).
* ✅ Word-level timestamps displayed per segment.
* ✅ **Bulk Find & Replace** with case-sensitivity toggle, match highlighting, and preview.
* ✅ Replace single or replace all.
* ✅ **Speaker reassignment UI**: click avatar to rename globally, create new speaker, or reassign segment.
* ⏳ Segment split/merge (planned).
* ⏳ Undo/redo history beyond browser native (planned).
* ⏳ Regex support in find/replace (planned).

### 4.6 Export Options

* ⏳ **PDF**: (Coming Soon) Print-friendly format with metadata
* ✅ **DOCX**: Structured by speaker turns with timestamps and metadata
* ✅ **VTT**: WebVTT format with speaker voice tags and proper cue identifiers
* ✅ **Filename format**: `{title}_{FORMAT}_{YYYY-MM-DD}.ext` for easy organization
* ✅ **Export modal**: User-friendly interface with format selection and download feedback
* ✅ **Metadata included**: Date of Transcription and Duration (when available)

---

## 5. User Experience

### Pages

1. **Upload**: upload file, choose options (language, diarization, watchlist terms).
2. **Projects List**: list of processed/transcribing projects.
3. **Editor**: waveform, transcript, speakers, find/replace, exports.

### Editor Layout

* **Left/Top**: waveform with playhead (wavesurfer.js).
* **Center/Bottom**: transcript grouped by speaker turns with avatar, initials, and color.
* **Toolbar**: find/replace panel with case sensitivity, playback controls, rate selector.
* ✅ **Speaker popover**: click avatar to rename, reassign, or create new speaker.
* ✅ **Export button**: opens modal for format selection (DOCX, VTT).

### Playback Sync

* ✅ **Sync to audio button**: Floating button appears when user scrolls away from active segment.
* ✅ **Auto-follow mode**: Clicking sync re-enables automatic transcript scrolling with audio.
* ✅ **Directional arrows**: Button shows ↑/↓ indicating direction to active segment.
* ✅ **Smart detection**: Only user scroll (wheel/touch) breaks follow mode, not programmatic scroll.
* ✅ **Edit/popover aware**: Button hidden during editing or when speaker popover is open.

### Shortcuts (Implemented)

* Space = play/pause.
* J/L = seek ±2s.
* ,/. = fine seek ±0.25s.
* Click segment/word = seek to timestamp.
* Scroll transcript = break follow mode, show sync button.

### Shortcuts (Planned)

* Ctrl/Cmd+F = find.
* Ctrl/Cmd+H = replace.
* Ctrl/Cmd+S = save.

---

## 6. Architecture

### Frontend

*   Framework: **Next.js 14 (App Router)**, TypeScript.
*   Styling: Tailwind CSS.
*   Audio player: **wavesurfer.js** (WebAudio backend).
*   Data Fetching: **Supabase SDK** + **SWR** (polling fallback).
*   Realtime: **Supabase Realtime** for project/job status updates.

### Backend (Serverless)

*   Database: **Supabase Postgres** with Row Level Security (RLS).
*   Auth: **Supabase Auth** (Email/Password, Magic Link).
*   Storage: **Supabase Storage** (S3-compatible, signed URLs).
*   Background Jobs: **Inngest** (event-driven functions).
*   Transcription Pipeline: **Deepgram Async API** + Webhook handlers.

### Infrastructure

*   Deployment: Vercel (Frontend/API), Supabase Cloud, Inngest Cloud.
*   Local Dev: **Supabase CLI** + Docker Compose + **ngrok** (for webhooks).

---

## 7. Data Model (simplified)

* **Project**: metadata (title, status, source file, duration, user_id).
* **Speaker**: label, color, linked to project.
* **Segment**: raw transcript segments (from STT provider).
* **Word**: raw word timings (linked to segments).
* **Chunk**: consolidated segments for editing (idempotent generation).
* **Chunk_word**: words mapped to consolidated chunks.
* **Watchlist**: key terms and canonical forms for transcription boosting.
* **Job**: background task records (queued, processing, completed, error).

---

## 8. API Endpoints

### Next.js API Routes (Server-side)
* `POST /api/projects` → Create project and initiate storage upload.
* `POST /api/projects/[id]/start` → Trigger Inngest transcription flow.
* `GET /api/projects/[id]/media-url` → Generate signed URL for playback.
* `POST /api/inngest` → Inngest function execution endpoint.
* `POST /api/webhooks/deepgram` → Deepgram transcription callback handler.
* `GET /api/projects/[id]/export/docx` → Native Node.js DOCX generation.
* `GET /api/projects/[id]/export/vtt` → Native Node.js VTT generation.

### Direct Supabase Access (Client-side)
* `SELECT * FROM projects` → RLS-filtered project list.
* `SELECT * FROM chunks` → Fetch transcript data with Realtime subscription.
* `PATCH /projects` → Update project title or status.
* `UPSERT /speakers` → Rename or create speakers.

---

## 9. Performance Targets

* 60-min file processed via Deepgram Nova 3 in **≤ 5 min** (async mode typically handles 1 hour in under 2 minutes).
* Bulk replace applied in **< 1s** for 1-hour transcript.
* Editor autosave: debounced updates (500ms) with optimistic UI.

---

## 10. Privacy & Security

*   **Data Isolation**: Row Level Security (RLS) ensures users only access their own data.
*   **Secure Storage**: Supabase Storage with owner-folder policies; signed URLs for Deepgram and playback.
*   Media retention: 1-day retention policy (Policy stated; enforcement via automated cleanup task in progress).
*   **Authentication**: Multi-user support via **Supabase Auth** (Email/Password).
*   **Encryption**: HTTPS/TLS enforced for all transit; storage encrypted at rest.

---

## 11. Acceptance Criteria

### ✅ Completed
* Multi-user authentication and secure data isolation.
* Upload file → Deepgram (Nova 3) async transcript generation.
* Realtime status updates with polling fallback.
* TypeScript-based consolidation pipeline (v1.3-ts).
* Key terms supported during upload for improved recognition.
* Editor supports inline edits with autosave and Optimistic UI.
* Editor supports bulk find & replace with case sensitivity.
* Native Node.js exports for DOCX and VTT.
* Waveform playback (WebAudio) with robust VBR sync.
* Speaker avatars with color coding and global renaming.
* Sync to audio button for user-controlled transcript following.

### ⏳ Planned
* Post-transcription watchlist correction.
* Segment split/merge.
* Undo/redo history.
* Regex in find/replace.

---

## 12. Stretch Features (Future)

*   Automatic summarization.
*   Entity highlighting (e.g., legal codes, product names).
*   Real-time transcription for live calls (Deepgram real-time API).
*   Advanced export formats (PDF, JSON).

---

## 13. Open Questions

* None at this stage; Deepgram Nova 3 selected as the STT provider.
* Retention set to 1 day.
* Sensible cap on file size/duration replaces fallback self-hosted Whisper.
