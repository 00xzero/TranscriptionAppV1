# Product Requirements Document (PRD)

## Product: Lightweight Transcription Web App

### Document Status

- Last updated: March 26, 2026
- Stack status: Active (Next.js + Supabase + Inngest)
- Scope: Current implementation plus near-term roadmap

---

## 1. Overview

A web application that ingests audio/video files and generates timestamped transcripts using Deepgram async transcription. The app supports speaker diarization, key term boosting, inline editing, and export to DOCX and VTT.

### One-liner

A privacy-focused transcription tool powered by Deepgram Nova 3, with speaker detection, editing, and fast exports.

---

## 2. Goals and Non-Goals

### Goals

- Multi-user support with secure data isolation via Supabase Auth + RLS.
- Accurate async transcription with speaker-aware output.
- Fast edit loop for transcript cleanup (inline editing + bulk find/replace).
- Export-ready outputs (DOCX and VTT) for publishing and downstream workflows.
- Reliable job lifecycle with clear statuses and retry-safe start behavior.

### Non-Goals (v1)

- Real-time collaborative editing.
- Billing/subscription/paywall features.
- Self-hosted model fallback (for example Whisper).
- Advanced document workflows (templating, approvals, redlining).

---

## 3. Primary User Stories

- As a researcher, I can upload interviews and receive speaker-labeled transcripts quickly.
- As a video editor, I can export VTT captions that align to media timing.
- As a consultant, I can provide key terms so domain vocabulary is recognized correctly.
- As an analyst, I can find and replace repeated errors across a long transcript in seconds.

---

## 4. Key Features

### 4.1 Capture and Upload

- Capture modal supports drag/drop and file picker.
- Supported formats: `mp3`, `wav`, `m4a`, `aac`, `flac`, `mp4`, `mov`, `webm`, `ogg`, `avi`.
- Configurable upload cap via `NEXT_PUBLIC_MAX_FILE_SIZE_MB` (default 50MB, can be raised for paid plans).
- User can set title and optional key terms at capture time.
- Capture flow creates project first, uploads media to Supabase Storage, then starts transcription.

Implementation notes:
- Language selector UI exists but is currently disabled (coming soon).
- Diarization toggle UI exists but is disabled; backend currently runs diarization by default.

### 4.2 Transcription Pipeline

- Deepgram async (`/listen` + callback webhook) with `nova-3`, smart formatting, utterances, diarization.
- Job lifecycle: `queued -> processing -> completed|error`.
- Project lifecycle status is DB-derived from job state via triggers (not manually set per code path).
- State machine enforces valid transitions; invalid inputs are rejected at the boundary.
- Optional idempotent start via `x-idempotency-key` to prevent duplicate jobs.
- Webhook receipt table (`webhook_receipts`) provides idempotent deduplication of Deepgram callbacks: completed duplicates return `200`, active in-flight duplicates return `503`, stale receipts are reclaimed.
- Start-route rate limiting is supported (`RATE_LIMIT_MODE`).
- Timeout watchdog marks stale jobs as `error` (default `TRANSCRIPTION_TIMEOUT_MINUTES=45`).

### 4.3 Speaker Handling

- Deepgram speaker diarization enabled in transcription request.
- Speaker labels shown in editor.
- User can rename speakers globally, create new speaker labels, reassign segment/chunk speaker, and untag to default naming.

### 4.4 Transcript Editing

- Inline transcript editing with debounced autosave (500ms).
- Word-level timing display in transcript cards.
- Transcript list rendered with `react-virtuoso` for smooth performance on long recordings (1hr+).
- Bulk Find/Replace supports:
  - case-sensitive matching
  - whole-word matching
  - replace one and replace all
  - match navigation and highlighted context snippets
- "Sync to audio" affordance helps recover follow mode after user scroll.

Planned:
- Segment split/merge.
- Undo/redo history beyond browser-native behavior.
- Regex-based find/replace.

### 4.5 Export

- DOCX export implemented through Next.js API route.
- VTT export implemented through Next.js API route.
- Export filename format: `{title}_{FORMAT}_{YYYY-MM-DD}.ext`.
- DOCX includes transcript metadata (date and duration when available).
- PDF option is visible in UI as "coming soon" and is not implemented yet.

---

## 5. User Experience and App Surfaces

### Main Surfaces

1. Auth (`/auth`): Email/password sign-in and sign-up via Supabase Auth UI.
2. Home/Library (`/`): Recent projects/files with status indicators.
3. Projects (`/projects`): Project list, start transcription, view errors, delete project.
4. Editor (`/editor/[id]`): Waveform, transcript editing, speaker tools, find/replace, export.

### Keyboard Shortcuts

Implemented:
- `Space`: play/pause
- `J` / `L`: seek -2s / +2s
- `,` / `.`: seek -0.25s / +0.25s
- `Cmd/Ctrl + F`: open Find/Replace
- `Cmd/Ctrl + E`: open Export modal
- Click segment/word: seek to timestamp

Planned:
- `Cmd/Ctrl + H`: explicit replace shortcut
- `Cmd/Ctrl + S`: explicit save shortcut

---

## 6. Architecture

### Frontend and API

- Next.js 14 App Router with TypeScript.
- Tailwind-based UI (Olivetti design system).
- API routes in the same Next.js app for project creation/start/export/webhooks. Route handlers are thin shells: auth → Zod parse → call `core/` service → return response.
- Client data layer uses Supabase SDK + realtime subscriptions with polling fallback.

### Layer Boundaries (`frontend/`)

- `contracts/` — Single source of truth for all Zod schemas and inferred TypeScript types (DB shapes, API bodies, Inngest events, Deepgram webhook format, editor pipeline).
- `core/` — Domain logic and application services: transcription state machine, project creation, consolidation, exports, rate limiting.
- `infra/` — External service adapters: Supabase client factories (browser, server, admin), Deepgram client, Inngest client.
- `lib/` — Cross-cutting utilities: Inngest function handlers, Supabase hooks/queries/realtime, ModalContext.

### Data/Auth/Storage

- Supabase Postgres with RLS-enabled project-scoped access.
- Supabase Auth (email/password flow in current UI).
- Supabase Storage private `media` bucket with signed URL access.

### Async Processing

- Inngest functions orchestrate transcription lifecycle. Functions are modularized into a `functions/` directory (one file per handler).
- Deepgram webhook uses receipt-based idempotency to prevent duplicate processing, then emits processing events.
- Optional local media proxy for Docker/ngrok callback compatibility.

### Infra

- Local: Supabase CLI + Docker Compose + ngrok.
- Deployment target: Vercel (app/API), Supabase Cloud, Inngest Cloud.

---

## 7. Data Model (Simplified)

- `projects`: project metadata and user ownership. Status is derived from job state via DB triggers.
- `speakers`: speaker labels/colors per project.
- `segments`: raw utterance-level transcript data.
- `words`: word-level timings.
- `chunks`: consolidated editable transcript units.
- `chunk_words`: mapping between chunks and words.
- `watchlist`: key terms for recognition boosting.
- `jobs`: transcription job state and payload metadata. Transitions audited in `job_events`.
- `webhook_receipts`: one receipt per Deepgram `request_id` for idempotent callback handling.
- `failed_events`: dead-letter/event failure records for operational debugging.

---

## 8. API and Integration Contracts

### Next.js API Routes

- `POST /api/projects` - Create project and return storage path.
- `POST /api/projects/[id]/start` - Queue transcription (supports idempotency key header).
- `GET /api/projects/[id]/media-url` - Generate signed URL for playback.
- `GET /api/projects/[id]/export/docx` - Generate DOCX export.
- `GET /api/projects/[id]/export/vtt` - Generate VTT export.
- `POST /api/inngest` - Inngest handler endpoint.
- `POST /api/webhooks/deepgram` - Deepgram callback ingest + forwarding.
- `GET /api/webhooks/deepgram/health` - Webhook/system health endpoint.
- `GET /api/media-proxy` - Optional local callback media proxy.

### Client-Side Supabase Access

- Project list/status and editor data are fetched directly via Supabase SDK.
- Realtime subscriptions are used where possible with timed polling fallback.
- Optimistic updates are used for key editor interactions.

---

## 9. Performance, Reliability, and Operational Targets

- Target user experience: 60-minute media should usually complete transcription in minutes, not tens of minutes.
- UI responsiveness target: bulk replace operations and transcript scrolling complete fast enough for interactive use on long transcripts (react-virtuoso handles 1hr+ recordings).
- Duplicate start protection through idempotency key + DB unique index.
- Stale job auto-fail via scheduled timeout checks.
- State machine with DB-enforced transitions prevents job/project status desynchronization across the start route, webhook path, timeout handler, and completion handler.
- Webhook receipt-based idempotency guards against duplicate Deepgram callbacks without reprocessing.
- Webhook authentication required via `dg-token` against `DEEPGRAM_API_KEY_IDENTIFIER`.
- Known platform limitation: Vercel function body cap can reject very large Deepgram callbacks (roughly multi-hour recordings).

---

## 10. Security and Privacy

- RLS enforces per-user data isolation for project-scoped tables.
- Auth middleware protects app routes and redirects unauthenticated users.
- Storage access is private; signed URLs are used for controlled media access.
- Service-role operations are restricted to server-side paths (Inngest/webhooks/admin helpers).
- Transport security is assumed via HTTPS in deployed environments.

Open operational policy item:
- Media retention automation is not finalized in code as a hard-enforced policy.

---

## 11. Acceptance Criteria Snapshot

### Completed

- Multi-user auth and RLS-backed tenant isolation.
- Upload -> create project -> store media -> start async transcription flow.
- Deepgram async integration with webhook-based completion path.
- Job lifecycle tracking with surfaced error states.
- Realtime project updates with polling fallback.
- Key term capture and forwarding to Deepgram `keyterm` parameters.
- Inline transcript editing with debounced autosave.
- Bulk find/replace with case and whole-word options.
- Speaker rename/reassign/create interactions in editor.
- DOCX and VTT export endpoints with downloadable files.
- Idempotent transcription start support.
- Start-route rate limiting and timeout-based stale job protection.
- State machine with DB-derived project status and idempotent replay handling.
- Webhook receipt-based idempotency for Deepgram callback deduplication.
- Transcript virtualization (react-virtuoso) for long-recording performance.

### Planned

- Language selection control in capture flow.
- User-facing diarization settings control in capture flow.
- Post-transcription watchlist correction pass.
- Segment split/merge editing.
- Undo/redo history.
- Regex-enabled replace.
- PDF export.
- Explicit automated retention workflow and policy enforcement.

---

## 12. Stretch Features (Future)

- AI-generated summaries.
- Named entity highlighting.
- Live transcription mode.
- Additional export targets (for example JSON and subtitle variants).

---

## 13. Open Questions

- What retention window should be enforced by automation in production, and where should deletion jobs run?
- Should long-recording webhook ingestion move to a higher body-limit runtime for production plans requiring multi-hour files?
- Should language selection and diarization options be exposed in v1.1, or remain backend-managed defaults?
