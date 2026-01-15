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

### Phase 0 - Discovery and Decisions (2 to 3 days)
Deliverables:
- Confirm file size and duration expectations.
- Confirm desired auth methods (email/password, magic link, social).
- Decide on realtime strategy (Supabase Realtime vs explicit polling fallback).
- Decide where exports will run (Vercel Node runtime vs separate function).
- Decide on Deepgram integration mode (async required for longer files).
- **Consolidation port spike completed and decision made.**

Tasks:
- Inventory all current API routes and map to target endpoints or direct Supabase access.
- Inventory all DB tables and relationships for Supabase schema.
- Determine which endpoints must remain server-side (service role key).
- **Spike: Port consolidation logic to TypeScript and test on sample data.**
- **Decision: Keep consolidation in TypeScript OR use Python via Inngest Python functions.**

Risks:
- Underestimating long audio duration and serverless timeouts.
- Export library limitations in serverless runtime.
- **Consolidation port complexity may require keeping Python implementation.**

Decisions Made:
- Max file size: 50MB default (free tier limit, configurable via `NEXT_PUBLIC_MAX_FILE_SIZE_MB`) / 4 hours
- Auth: Email/password + magic link (Google OAuth post-launch)
- Realtime: Supabase Realtime for project/job status with polling fallback
- Exports: Vercel Node runtime for DOCX/VTT (PDF optional/post-launch)
- Storage: Signed URLs for Deepgram access (not public)

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

### Phase 4 - Inngest Setup and Webhook Handler (3 to 5 days)
Deliverables:
- Inngest project configured (dev and prod).
- Webhook handler skeleton for Deepgram callbacks.
- Job lifecycle event structure.

Tasks:
- Set up Inngest project and signing keys.
- Create Inngest event model:
  - transcription.requested
  - transcription.webhook (for Deepgram callbacks)
  - transcription.completed
  - transcription.failed
- Create skeleton webhook handler function in Inngest.
- Add idempotency for job triggers and updates.
- Add concurrency controls and rate limits (Deepgram quotas).
- Configure Inngest dev server for local development.

### Phase 5 - Deepgram Async Integration (4 to 7 days)
Deliverables:
- Async transcription handling.
- Webhook receiver triggering Inngest function.
- Storage of transcription results in DB (segments, words).

Tasks:
- Create Next.js API route or Inngest function to initiate transcription.
- Call Deepgram async endpoint using signed URL from Supabase Storage.
- Store Deepgram request_id and map it to job in Supabase.
- Implement webhook endpoint (Next.js API route) that triggers Inngest `transcription.webhook` event.
- In Inngest webhook handler:
  - Parse Deepgram utterances/words
  - Store segments with speaker mapping
  - Store words with timestamps and confidence
  - Update project duration based on max end time
  - Trigger consolidation pipeline
  - Mark job and project status as completed or error
- Port error classification logic from worker (key term errors vs general).
- Update job status with timestamps throughout pipeline.

### Phase 6 - Consolidation Pipeline Port (2 to 5 days)
Deliverables:
- Consolidation algorithm parity with current Python logic.
- Chunk + chunk_words generation.

Tasks:
- Implement consolidation logic (TypeScript in Inngest OR Python via Inngest Python functions).
- Preserve behavior: gap/duration breaks, filler detection, sentence boundary handling.
- Preserve chunk metadata: source_segment_ids, is_edited, is_filler, algo_version.
- Ensure consolidation runs after every transcription import.
- Add comprehensive tests comparing outputs with current Python implementation.

> **Note**: If Phase 0 spike reveals complexity, keep this as a Python function called by Inngest. Inngest supports Python natively, avoiding risky rewrites of tuned algorithms.

### Phase 7 - Frontend Data Flow Updates (4 to 7 days)
Deliverables:
- Supabase data access in all pages.
- Realtime updates for job status and project list with polling fallback.
- Editor operations wired to new backend or direct DB access.

Tasks:
- Replace SWR polling with Supabase Realtime subscriptions:
  - projects status updates (primary)
  - jobs status updates (primary)
  - **Add polling fallback (5s interval) if subscription fails**
- Update Projects page for realtime status with loading states.
- Update Editor page to read chunks and speakers via Supabase client.
- Update speaker creation/rename and chunk edits with optimistic UI.
- Update key terms editing with Supabase tables.
- Update Import flow to insert segments and words in Supabase.
- Update Export flow to call server route.
- Add error handling for network failures and subscription disconnects.

### Phase 8 - Export Parity (2 to 4 days)
Deliverables:
- DOCX and VTT exports with current formatting.
- PDF export optional (post-launch if needed).

Tasks:
- Implement server-side export in Next.js API route handler (Node runtime, not Edge).
- Use Node libraries:
  - `docx` for DOCX generation ✅
  - Plain text formatting for VTT ✅
  - (PDF: `pdf-lib` or keep in Python if complex)
- Preserve formatting used in Python exports:
  - Title, metadata, duration
  - Speaker labels and timestamps
  - VTT speaker cues and timing
- Ensure server routes are authenticated (Supabase auth) and authorized (RLS).
- Test export file validity with sample projects.



### Phase 9 - Local Dev via Docker-Only (2 to 4 days)
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

### Phase 10 - Deployment and Release (2 to 4 days)
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

### Phase 11 - Cleanup and Documentation (1 to 2 days)
Deliverables:
- Updated README and architecture docs.
- Deprecation notice for old Docker Compose stack.
- Clear onboarding instructions.

Tasks:
- Mark old backend/worker as legacy (or move to branch).
- Update `README.md` with new stack and dev steps.
- Update `CHANGELOG.md`.

## Effort Estimate Summary
Total: ~26 to 53 dev days (4 to 8 weeks for single engineer)

Estimated by phase (single engineer):
- Phase 0: 2 to 3 days (includes consolidation spike)
- Phase 1: 2 to 4 days
- Phase 2: 2 to 4 days
- Phase 3: 2 to 4 days
- Phase 4: 3 to 5 days (Inngest setup)
- Phase 5: 4 to 7 days (Deepgram async + webhook)
- Phase 6: 2 to 5 days (consolidation port)
- Phase 7: 4 to 7 days (frontend + realtime)
- Phase 8: 2 to 4 days (exports)
- Phase 9: 2 to 4 days (Docker local dev)
- Phase 10: 2 to 4 days (deployment)
- Phase 11: 1 to 2 days (cleanup)

**Post-Launch Enhancements** (not in critical path):
- Speaker naming upfront: 1 to 2 days
- PDF export (if needed): 1 to 2 days
- Google OAuth: 1 day

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
1. **Phase 0**: Discovery + consolidation spike
2. **Phase 1**: Supabase schema + RLS
3. **Phase 2**: Auth
4. **Phase 3**: Storage + upload
5. **Phase 4**: Inngest setup + webhook handler skeleton
6. **Phase 5**: Deepgram async + webhook → Inngest
7. **Phase 6**: Consolidation (TypeScript or Python)
8. **Phase 7**: Frontend integration + realtime (with polling fallback)
9. **Phase 8**: Exports (DOCX, VTT)
10. **Phase 9**: Docker-only local dev
11. **Phase 10**: Deployment
12. **Phase 11**: Cleanup

**Post-Launch** (Phase 12+):
- Speaker naming upfront
- PDF export
- Google OAuth

## Decisions Made (Phase 0)
✅ **Max file size**: 50MB default (configurable via `NEXT_PUBLIC_MAX_FILE_SIZE_MB`) / 4 hours    
✅ **Auth providers**: Email/password only (magic link + Google OAuth post-launch)  
✅ **Realtime strategy**: Supabase Realtime for project/job status with 5s polling fallback  
✅ **Exports**: Vercel Node runtime for DOCX/VTT (PDF optional/post-launch)  
✅ **Storage policy**: Signed URLs for Deepgram access (not public)  
✅ **Consolidation**: TypeScript (unified stack, runs in Inngest Node.js functions)

## Decisions Made (Phase 1)
✅ **Supabase project**: Created `transcription-app` (ID: `svzeffnmlqbdnjzhcgyx`) in eu-west-1 (Ireland)  
✅ **Database schema**: 8 tables with native UUID primary keys, JSONB for flexible data, UUID[] for arrays  
✅ **RLS strategy**: Direct ownership on `projects` table, project-scoped for related tables, nested for deeply related tables  
✅ **Storage bucket**: Private `media` bucket with configurable limit (50MB Free, up to 1.5GB Pro via `NEXT_PUBLIC_MAX_FILE_SIZE_MB`), owner-folder path convention (`{user_id}/{project_id}/{filename}`)  
✅ **Migration strategy**: Single shared migration set for dev/prod (no separate local/cloud migrations)  
✅ **Jobs table**: Renamed `celery_task_id` → `inngest_event_id` for Inngest integration  
✅ **Trigger security**: Applied `SECURITY DEFINER` and `SET search_path = public` to prevent search_path attacks

## Decisions Made (Phase 2)
✅ **Auth package**: `@supabase/ssr` for cookie-based sessions (SSR-compatible)  
✅ **Auth UI**: Supabase pre-built Auth UI (faster implementation; UI overhaul planned post-refactor)  
✅ **Auth methods**: Email/password only (magic link + Google OAuth deferred to post-launch)  
✅ **Route protection**: Middleware-based with protected routes: `/projects`, `/editor/*`, `/upload`, `/import`  
✅ **Session refresh**: Automatic via middleware on every request  

## Decisions Made (Phase 3)
✅ **Upload Strategy**: Replaced legacy FastAPI upload with Next.js API routes (full replacement)  
✅ **Client Upload**: Direct upload to Supabase Storage via SDK (bypassing presigned URLs for simpler flow)  
✅ **File Limits**: 50MB default limit (Free plan compatible), configurable to 1.5GB+ via `NEXT_PUBLIC_MAX_FILE_SIZE_MB`  

## Decisions Made (Phase 4)
✅ **Inngest Integration**: Upgraded TypeScript to 5.8+ to support latest Inngest SDK features  
✅ **Webhook Security**: Used `dg-token` header (API Key Identifier) for Deepgram verification instead of HMAC (simpler, official method)  
✅ **Concurrency**: Account-scoped concurrency limit for Deepgram, configurable via `DEEPGRAM_CONCURRENCY_LIMIT` (default: 5)  
✅ **Job Queueing**: Synchronous job record creation in Start endpoint before triggering async Inngest event (ensures ID availability)


