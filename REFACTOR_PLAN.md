# Simplified Stack Refactor Plan (Vercel + Supabase + Inngest)

## Purpose
Provide a thorough, phased plan to refactor the current stack (FastAPI + Celery + Redis + MinIO + Docker Compose) into a simpler, managed deployment: Vercel for the frontend, Supabase for auth/db/storage/realtime, and Inngest for background jobs. The goal is full feature parity with no data migration, plus a Docker-only local dev flow.

## Goals
- Full feature parity with current behavior and UX.
- Managed deployment with minimal ops (Vercel + Supabase + Inngest).
- Real-time updates instead of polling.
- Supabase Auth for multi-user support.
- Keep local dev as a single Docker command.
- No data migration (greenfield data after refactor).

## Non-Goals
- Migrating existing production data.
- New features beyond the scope required for parity (except necessary to match new stack, e.g., auth flows).
- Long-term scaling optimizations beyond basic quotas and concurrency limits.

## Current Feature Parity Inventory (Baseline)
Backend and worker features to preserve:
- Projects CRUD and list.
- Upload flow with presigned object storage PUT.
- Transcription job lifecycle: queued -> processing -> completed/error.
- Job tracking (job records + status + error payload).
- Key terms (watchlist) with validation.
- Deepgram transcription with diarization.
- Segments, words, chunk consolidation pipeline.
- Editor operations: chunk edit, speaker updates, reassign speaker, rename.
- Export: DOCX, PDF, VTT.
- Authentication (currently single token).
- Smart polling while jobs run.

Frontend features to preserve:
- Upload page (with key terms).
- Projects list and status display with error handling.
- Editor with waveform, live playback, and chunk editing.
- Speaker management UI.
- Export modal.
- Import page (bulk segment import).

## Target Architecture Summary
- Frontend: Next.js 14 (Vercel), Supabase client.
- Auth: Supabase Auth (JWT, social logins optional).
- Database: Supabase Postgres with RLS.
- Storage: Supabase Storage (signed uploads, signed download URLs).
- Background jobs: Inngest (event-driven functions).
- Realtime updates: Supabase Realtime subscriptions.
- Long-running transcription: Deepgram async API with webhook -> Inngest/Next handler.
- Local dev: Docker-only stack using Supabase local + Inngest dev + frontend container.

## High-Level Deployment Strategy
- Vercel hosts Next.js app (frontend + API route handlers for secure ops).
- Supabase hosts DB/Auth/Storage/Realtime.
- Inngest hosts job functions (or Vercel + Inngest infra for production).
- Deepgram async transcription + webhook to a Vercel endpoint or Inngest handler.

## Phased Plan of Attack

### Phase 0 - Discovery and Decisions (1 to 2 days)
Deliverables:
- Confirm file size and duration expectations.
- Confirm desired auth methods (email/password, magic link, social).
- Decide on realtime strategy (Supabase Realtime vs explicit polling fallback).
- Decide where exports will run (Vercel Node runtime vs separate function).
- Decide on Deepgram integration mode (async required for longer files).

Tasks:
- Inventory all current API routes and map to target endpoints or direct Supabase access.
- Inventory all DB tables and relationships for Supabase schema.
- Determine which endpoints must remain server-side (service role key).

Risks:
- Underestimating long audio duration and serverless timeouts.
- Export library limitations in serverless runtime.

### Phase 1 - Supabase Foundation (2 to 4 days)
Deliverables:
- Supabase project created (dev and prod).
- SQL schema and migrations checked into repo (Supabase local).
- RLS policies for all tables.
- Storage bucket(s) created and policies defined.
- Basic seed data for local dev.

Tasks:
- Translate current SQLAlchemy models to Postgres schema:
  - projects
  - jobs
  - speakers
  - segments
  - words
  - chunks
  - chunk_words
  - watchlist
- Add user_id to owner-scoped tables and define foreign keys.
- Add indexes for status and project_id fields.
- Implement RLS:
  - Users can only access their own projects and related data.
  - Jobs, segments, chunks, speakers are scoped by project owner.
  - Storage policies to restrict uploads/downloads to owner.
- Add validation constraints that mirror current logic when possible.

### Phase 2 - Auth and Session Wiring (2 to 4 days)
Deliverables:
- Auth UI and session management in Next.js.
- Server-side auth helpers.
- Replace token-based headers in frontend.

Tasks:
- Add Supabase client setup for browser and server.
- Add sign in/up, session refresh, and protected routes.
- Update API calls to use Supabase auth instead of X-API-Key/Bearer token.
- Introduce route protection in Next.js app router.

### Phase 3 - Storage and Upload Flow (2 to 4 days)
Deliverables:
- Supabase Storage upload flow (signed URLs).
- Media URL retrieval for playback.
- CORS and content type handling.

Tasks:
- Replace presigned S3 logic with Supabase Storage signed upload.
- Update upload page to use Supabase Storage and store object key.
- Store media metadata in projects table.
- Implement signed download URLs for playback.
- Ensure Deepgram can access media (signed URL or object accessible by Deepgram).

### Phase 4 - Job Orchestration with Inngest (4 to 7 days)
Deliverables:
- Inngest functions for transcription pipeline.
- Job lifecycle updates persisted to Supabase.
- Retry and error classification parity.

Tasks:
- Create Inngest event model:
  - project.created
  - transcription.requested
  - transcription.started
  - transcription.completed
  - transcription.failed
- Replace Celery queue with Inngest function(s).
- Implement job status updates with timestamps.
- Port error classification logic from worker (key term errors vs general).
- Add idempotency for job triggers and updates.
- Add concurrency controls and rate limits (Deepgram quotas).

### Phase 5 - Deepgram Async Integration (3 to 6 days)
Deliverables:
- Async transcription handling.
- Webhook receiver for completion.
- Storage of transcription results in DB (segments, words, chunks).

Tasks:
- Call Deepgram async endpoint using signed URL.
- Store Deepgram request id and map it to job.
- Implement webhook endpoint to receive results.
- Parse utterances/words and store:
  - segments
  - words
  - speaker mapping
- Trigger consolidation pipeline after raw import.
- Update project duration based on max end time.
- Mark job and project status complete or error.

### Phase 6 - Consolidation Pipeline Port (2 to 4 days)
Deliverables:
- Consolidation algorithm parity with current Python logic.
- Chunk + chunk_words generation.

Tasks:
- Port consolidation logic to TypeScript (or SQL functions if desired).
- Preserve behavior: gap/duration breaks, filler detection, sentence boundary handling.
- Preserve chunk metadata: source_segment_ids, is_edited, is_filler, algo_version.
- Ensure consolidation runs after every transcription import.

### Phase 7 - Frontend Data Flow Updates (3 to 6 days)
Deliverables:
- Supabase data access in all pages.
- Realtime updates for job status and project list.
- Editor operations wired to new backend or direct DB access.

Tasks:
- Replace SWR polling with Supabase Realtime subscriptions:
  - projects status updates
  - jobs status updates
  - chunk edits (if needed)
- Update Projects page for realtime status.
- Update Editor page to read chunks and speakers via Supabase.
- Update speaker creation/rename and chunk edits.
- Update key terms editing with Supabase tables.
- Update Import flow to insert segments and words in Supabase.
- Update Export flow to call server route.

### Phase 8 - Export Parity (2 to 4 days)
Deliverables:
- DOCX, VTT, PDF exports with current formatting.

Tasks:
- Implement server-side export in Next route handler (Node runtime).
- Use suitable Node libraries (docx, pdfkit or equivalent).
- Preserve formatting used in Python exports:
  - Title, metadata, duration
  - Speaker labels and timestamps
  - VTT speaker cues
- Ensure server routes are authenticated and authorized.

### Phase 9 - Speaker Naming Upfront (1 to 2 days)
Deliverables:
- UI to input speaker names before transcription starts.
- Mapping logic from diarization speaker indices to user-provided names.

Tasks:
- Add speaker names to project creation flow.
- Store initial speakers in DB before transcription.
- Map diarization output to existing speaker rows.
- Allow edits to speaker names after transcription.

### Phase 10 - Local Dev via Docker-Only (2 to 4 days)
Deliverables:
- One-command local dev with Docker Compose.
- Supabase local stack inside Docker.
- Inngest dev server in Docker.

Tasks:
- Add new `infra/docker-compose.dev.yml`:
  - Supabase local services (db/auth/realtime/storage)
  - Frontend container
  - Inngest dev container
- Add Supabase config to repo:
  - `infra/supabase/config.toml`
  - `infra/supabase/migrations/`
  - `infra/supabase/seed.sql`
- Update env templates with Supabase and Inngest variables.
- Update README with new local dev command and URLs.

### Phase 11 - Deployment and Release (2 to 4 days)
Deliverables:
- Vercel project and env vars configured.
- Supabase project configured (prod).
- Inngest configured for production.
- Deepgram webhook endpoint reachable.

Tasks:
- Configure Vercel root directory to `frontend/`.
- Set env vars for Supabase keys and Deepgram API key.
- Deploy Inngest functions and set signing keys.
- Add CORS and allowed origins in Supabase/Next.
- Add health endpoints and basic smoke tests.

### Phase 12 - Cleanup and Documentation (1 to 2 days)
Deliverables:
- Updated README and architecture docs.
- Deprecation notice for old Docker Compose stack.
- Clear onboarding instructions.

Tasks:
- Mark old backend/worker as legacy (or move to branch).
- Update `README.md` with new stack and dev steps.
- Update `CHANGELOG.md`.

## Effort Estimate Summary
Total: ~13 to 27 dev days (2 to 4 weeks)

Estimated by phase (single engineer):
- Phase 0: 1 to 2 days
- Phase 1: 2 to 4 days
- Phase 2: 2 to 4 days
- Phase 3: 2 to 4 days
- Phase 4: 4 to 7 days
- Phase 5: 3 to 6 days
- Phase 6: 2 to 4 days
- Phase 7: 3 to 6 days
- Phase 8: 2 to 4 days
- Phase 9: 1 to 2 days
- Phase 10: 2 to 4 days
- Phase 11: 2 to 4 days
- Phase 12: 1 to 2 days

## Risks and Mitigations
- Serverless timeouts for long transcription:
  - Use Deepgram async + webhook flow.
- Export complexity in serverless:
  - Use Node runtime and select stable libs; avoid Edge for exports.
- RLS complexity:
  - Test policies with sample users; keep policies simple.
- Realtime consistency:
  - Use a fallback to polling if realtime is unavailable.
- Inngest reliability:
  - Idempotent handlers and retry-safe updates.

## Acceptance Criteria (Feature Parity)
- Upload flow works end-to-end and stores media in Supabase Storage.
- Transcription runs and updates status in realtime.
- Editor displays chunks and supports edits with autosave.
- Speaker creation, rename, and reassignment work.
- Exports (DOCX, PDF, VTT) match current output formatting.
- Key terms are validated and used in transcription.
- Import flow functions (segments and words).
- Auth protects all data with RLS.
- Local dev runs with a single Docker command.
- Production deploy is Vercel + Supabase + Inngest with no servers.

## Suggested Order (Strict)
1. Phase 0 (decisions)
2. Phase 1 (Supabase schema + RLS)
3. Phase 2 (Auth)
4. Phase 3 (Storage + upload)
5. Phase 4 + 5 (Inngest + Deepgram async)
6. Phase 6 (Consolidation)
7. Phase 7 (Frontend integration + realtime)
8. Phase 8 (Exports)
9. Phase 9 (Speaker naming upfront)
10. Phase 10 (Docker-only local dev)
11. Phase 11 (Deployment)
12. Phase 12 (Cleanup)

## Open Questions to Resolve Early
- Expected max audio duration and file size.
- Which auth providers to enable.
- Is realtime required for all views or only project status?
- Should exports run in Vercel Node runtime or external service?
- Which storage policy is acceptable for Deepgram URL access (signed vs public)?

