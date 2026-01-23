# Phase Status Tracker

> **Update this file at the start and end of each phase.**

## Current Phase

| Field | Value |
|:---|:---|
| **Phase** | 10 - Deployment |
| **Status** | Not Started |
| **Owner** | TBD |
| **Started** | - |
| **Target Completion** | - |

## Phase Progress

| Phase | Name | Status | Completion Date |
|:---|:---|:---|:---|
| 0 | Discovery + Consolidation Spike | ✅ Complete | 2026-01-13 |
| 1 | Supabase Foundation | ✅ Complete | 2026-01-14 |
| 2 | Auth and Session Wiring | ✅ Complete | 2026-01-14 |
| 3 | Storage and Upload Flow | ✅ Complete | 2026-01-15 |
| 4 | Inngest Setup | ✅ Complete | 2026-01-15 |
| 5 | Deepgram Async Integration | ✅ Complete | 2026-01-15 |
| 6 | Consolidation Pipeline Port | ✅ Complete | 2026-01-16 |
| 7 | Frontend Data Flow | ✅ Complete | 2026-01-17 |
| 8 | Export Parity | ✅ Complete | 2026-01-19 |
| 9 | Local Dev Docker | ✅ Complete | 2026-01-19 |
| 10 | Deployment | ⏳ Not Started | - |
| 11 | Cleanup | ⏳ Not Started | - |

**Legend**: ⏳ Not Started | 🔄 In Progress | ✅ Complete | ⚠️ Blocked

## Phase Handoff Notes

> Engineers completing a phase should document key decisions, gotchas, and context for the next phase here.

### Phase 0 → Phase 1

**Key Deliverables Created:**
- `API_ROUTE_MAPPING.md` - 23 endpoints mapped (13 Supabase Direct, 7 Next.js API, 2 Inngest)
- `SCHEMA_MAPPING.md` - 8 tables with RLS policies documented
- `frontend/lib/consolidation.ts` - TypeScript consolidation algorithm (38 tests passing)

**Decisions Made:**
- **Consolidation**: Use TypeScript (unified stack, runs in Inngest Node.js functions)
- All other decisions confirmed per REFACTOR_PLAN.md

**For Phase 1:**
- Use SCHEMA_MAPPING.md as reference for SQL migrations
- Add `user_id UUID` column to projects table
- Create RLS policies per the documented patterns
- Note: Use `inngest_event_id` instead of `celery_task_id` in jobs table

### Phase 1 → Phase 2

**Key Deliverables Created:**
- Supabase project: `transcription-app` (`svzeffnmlqbdnjzhcgyx`) in eu-west-1
- 8 tables with RLS policies: projects, speakers, segments, words, chunks, chunk_words, watchlist, jobs
- Storage bucket: `media` with owner-folder policies
- Local migration file: `infra/supabase/migrations/20260114000000_initial_schema.sql`
- Seed data: `infra/supabase/seed.sql`

**Supabase Connection Details:**
- Configured via environment variables in `frontend/.env.local` (copy from `.env.example`)
- Required variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- See Supabase dashboard (Settings → API) for your project's keys
- For key rotation guidance, see [Supabase API Keys docs](https://supabase.com/docs/guides/platform/api-keys)

**For Phase 2:**
- Set up Supabase client in Next.js (browser + server)
- Add auth UI (sign in/up, magic link)
- Replace X-API-Key header with Supabase auth
- Add route protection in app router

**Gotchas:**
- Storage path convention: `{user_id}/{project_id}/{filename}`
- RLS uses `auth.uid()` - ensure client sends valid JWT
- Service role key needed for Inngest (bypasses RLS)

### Phase 2 → Phase 3

**Key Deliverables Created:**
- Supabase client utilities: `lib/supabase/client.ts`, `lib/supabase/server.ts`
- Middleware for session refresh and route protection: `middleware.ts`
- Auth UI with email/password: `app/auth/page.tsx`
- Sign out action: `app/auth/actions.ts`
- Auth status header component: `components/AuthStatus.tsx`
- Environment configuration: `.env.example`, `.env.local`

**For Phase 3:**
- Use `createClient` from `@/lib/supabase/client` for browser-side storage uploads
- Use `createClient` from `@/lib/supabase/server` for server-side signed URL generation
- Storage path convention (from Phase 1): `{user_id}/{project_id}/{filename}`
- User ID available via `supabase.auth.getUser()` after login

**Gotchas:**
- Auth UI requires email confirmation by default (configurable in Supabase dashboard)
- Protected routes: `/projects`, `/editor/*`, `/upload`, `/import`
- Legacy API still uses `X-API-Key` header - migration deferred to later phases

### Phase 3 → Phase 4

**Key Deliverables Created:**
- Storage helpers: `lib/supabase/storage.ts` (upload, signed URLs, delete, validation)
- API route: `app/api/projects/route.ts` (POST /api/projects)
- API route: `app/api/projects/[id]/media-url/route.ts` (GET /api/projects/[id]/media-url)
- Updated upload page with Supabase Storage flow + progress bar
- Updated editor to use new media URL endpoint

**For Phase 4:**
- Storage path is in `projects.source_object_key`
- Use `getSignedMediaUrl()` or server-side `createSignedUrl()` for Deepgram access
- Signed URLs have 1-hour expiry by default
- Service role key may be needed for Inngest functions to bypass RLS

**Gotchas:**
- Legacy API (FastAPI) still handles: chunks, speakers, segments, exports
- Upload and media-url endpoints are fully replaced by Next.js routes
- File size limit: 50MB default, due to Supabase free plan limit, can be upgraded to 500GB (configurable via `NEXT_PUBLIC_MAX_FILE_SIZE_MB`)

### Phase 4 → Phase 5

**Key Deliverables Created:**
- Inngest package installed (TypeScript upgraded to 5.8+)
- Event types: `lib/inngest/events.ts`
- Inngest client: `lib/inngest/client.ts`
- Skeleton functions: `lib/inngest/functions.ts`
- API routes: `/api/inngest`, `/api/webhooks/deepgram`, `/api/projects/[id]/start`
- Environment config updated with Inngest + Deepgram variables

**For Phase 5:**
- Call Deepgram async API with callback URL: `/api/webhooks/deepgram`
- Pass `project_id` in Deepgram metadata for callback matching
- Store `request_id` from Deepgram response in jobs table
- Parse webhook response for utterances/words
- Store segments with speaker mapping in Supabase

**Gotchas:**
- Signed URLs from `getSignedMediaUrl()` have 1-hour expiry
- Webhook uses `dg-token` header verification via `DEEPGRAM_API_KEY_IDENTIFIER`
- Concurrency configurable via `DEEPGRAM_CONCURRENCY_LIMIT` env var (default: 5)
- Service role key needed for Inngest functions to update DB (bypasses RLS)

### Phase 5 → Phase 6

**Key Deliverables Created:**
- Supabase admin client: `lib/supabase/admin.ts` (service role, bypasses RLS)
- Deepgram service: `lib/deepgram.ts` (async API, error classification)
- Full Inngest function implementations in `lib/inngest/functions.ts`
- Updated event types with `jobId` in `lib/inngest/events.ts`
- New migration: `20260115000000_speakers_unique_constraint.sql`

**Post-Implementation Fixes Applied:**
1. **Error string guard** - Coerce error to string before `.slice()` in handleTranscriptionFailed
2. **Job lookup validation** - Added `inngest_event_id` filter to prevent matching wrong job
3. **Delete error handling** - Check segment delete errors before proceeding with inserts
4. **Speaker race condition** - Added UNIQUE constraint + replaced SELECT/INSERT with upsert

**For Phase 6:**
- Segments and words are stored in Supabase after transcription
- Consolidation should trigger at end of `handleTranscriptionWebhook`
- TypeScript consolidation exists at `lib/consolidation.ts` (ported in Phase 0)
- Use `createAdminClient()` for consolidation DB operations

**Gotchas:**
- Consolidation must save chunks and chunk_words to Supabase
- Need to adapt consolidation.ts to use Supabase instead of in-memory data
- Consolidation runs after every transcription, before marking "completed"
- Speaker upsert uses `onConflict: "project_id,label"` - constraint must exist
- **Deepgram Metadata**: Must use `extra` query param, not JSON body `metadata`
- **Large Transcripts**: Fetching words by segment IDs requires batching to avoid URL limit errors

**Environment Variables Added:**
- `SUPABASE_SERVICE_ROLE_KEY` - Required for Inngest DB writes
- `NEXT_PUBLIC_APP_URL` - Base URL for Deepgram callbacks
- `DEEPGRAM_CALLBACK_URL` - Optional override for local tunnels
- `DEEPGRAM_MODEL` - Model selection (default: nova-3)

### Phase 6 → Phase 7

**Key Deliverables Created:**
- Consolidation service: `lib/inngest/consolidation-service.ts`
- Updated `handleTranscriptionWebhook` with consolidation step

**Implementation Details:**
- Consolidation runs as Step 3 in `handleTranscriptionWebhook`
- Uses admin client (service role) to bypass RLS
- Fetches segments with word IDs directly from Supabase (Option A)
- Clears existing chunks before insert (idempotency)
- Algorithm version: v1.3-ts

**For Phase 7:**
- Chunks are now generated automatically after transcription
- Editor should read from `chunks` table (not `segments`)
- Use `source_segment_ids` for linking back to raw data
- `is_filler` can be used to style filler chunks differently
- Replace SWR polling with Supabase Realtime subscriptions

**Gotchas:**
- Chunks cascade-delete chunk_words (no need for manual cleanup)
- `chunk_words.order_index` tracks word position within chunk
- Empty transcriptions result in 0 chunks (no error)

### Phase 7 → Phase 8

**Key Deliverables Created:**
- `lib/supabase/realtime.ts` - Generic Realtime hook with polling fallback
- `lib/supabase/queries.ts` - Typed query helpers for Supabase
- `lib/supabase/hooks.ts` - React hooks: useProjectsRealtime, useChunksRealtime, useSpeakersRealtime
- `lib/supabase/types.ts` - Generated TypeScript types from Supabase schema
- **Audio Sync Fix**: Updated `EditorPage` with `WebAudio` backend and robust seek logic to fix VBR sync issues

**Implementation Details:**
- Projects page uses `useProjectsRealtime()` with connection status indicator
- Editor page uses `fetchChunks()`, `fetchSpeakers()`, `fetchProjectById()` from Supabase
- All mutations (chunk edits, speaker ops, title save) use Supabase `update*()` functions
- Optimistic UI with rollback on error for all mutations
- 5-second polling fallback when Realtime connection fails

**For Phase 8:**
- Export endpoints should use the new Supabase queries, not legacy API
- Use `fetchChunks()` to get transcript data for export
- Use `fetchSpeakers()` to resolve speaker labels
- Export endpoints: `/api/projects/[id]/export/docx`, `/api/projects/[id]/export/vtt`

**Gotchas:**
- `lib/swr.ts` is deprecated but kept for test compatibility
- SpeakerPopover now imports Speaker type from shared types
- Connection status indicator shows Live/Connecting/Disconnected

### Phase 8 → Phase 9

**Key Deliverables Created:**
- `lib/exports.ts` - TypeScript export generators (DOCX, VTT)
- `app/api/projects/[id]/export/docx/route.ts` - DOCX export endpoint
- `app/api/projects/[id]/export/vtt/route.ts` - VTT export endpoint
- `__tests__/exports.test.ts` - 22 unit tests

**Implementation Details:**
- Uses `docx@^9.5.1` npm package for DOCX generation
- Exports use Blob → ArrayBuffer conversion for Response compatibility
- PDF export marked as "Coming Soon" in ExportModal

**For Phase 9:**
- Export endpoints are fully functional, no legacy FastAPI dependencies
- All export routes use Supabase session auth (cookie-based)
- Docker compose should expose port 3000 for frontend

**Gotchas:**
- `Packer.toBuffer()` returns incompatible type; use `new Uint8Array(Packer.toBuffer())`
- Legacy `lib/api.ts` still exists but is no longer used by ExportModal
- `docx` library requires `runtime = 'nodejs'` in Next.js API route

### Phase 9 → Phase 10

**Key Deliverables Created:**
- `infra/supabase/config.toml` - Supabase CLI local configuration
- `infra/docker-compose.dev.yml` - Docker Compose for Inngest + Frontend
- `infra/.env.docker.example` - Environment template for Docker dev
- `infra/start-local.sh` - One-command startup script (with ngrok integration)
- `infra/stop-local.sh` - Stop script
- `frontend/app/auth/callback/route.ts` - Auth code exchange endpoint
- `frontend/app/api/media-proxy/route.ts` - Media proxy for Deepgram via ngrok

**Implementation Details:**
- Uses Supabase CLI (`supabase start`) for local Supabase services
- Frontend and Inngest run in Docker containers with hot reload
- `start-local.sh` auto-extracts Supabase keys and configures `.env.docker`
- Ports: Frontend=3000, Studio=54323, Inngest=8288, API=54321
- Fixed Docker auth cookie mismatch via explicit `cookieOptions.name` in all Supabase clients
- Added `SUPABASE_URL` env var for server-side Docker networking
- Media proxy enables Deepgram to access local storage through ngrok tunnel

**For Phase 10:**
- Deploy to Vercel: Set root directory to `frontend/`
- Configure Supabase production project via dashboard
- Set Inngest production keys
- Update DEEPGRAM_CALLBACK_URL to production Vercel URL

**Gotchas:**
- Supabase CLI must be installed (`brew install supabase/tap/supabase`)
- ngrok required for transcription (Deepgram needs public callback URL)
- All Supabase clients must use same `cookieOptions.name` for Docker auth to work
- Docker `host.docker.internal` used for cross-container communication
- Migrations apply automatically on `supabase start`
- `.env.docker` is gitignored (template provided)

## Blockers and Dependencies

| Blocker | Affects Phase | Owner | Status |
|:---|:---|:---|:---|
| None | - | - | - |

## Key Decisions Log

| Date | Phase | Decision | Reasoning |
|:---|:---|:---|:---|
| 2026-01-13 | 0 | Email/password + magic link for auth | Simpler than OAuth; Google OAuth post-launch |
| 2026-01-13 | 0 | Supabase Realtime with polling fallback | Robustness for unreliable connections |
| 2026-01-13 | 0 | Signed URLs for Deepgram | Security over convenience |
| 2026-01-13 | 0 | TypeScript for consolidation | Unified modern stack; runs in Inngest Node.js |
| 2026-01-14 | 1 | Supabase project in eu-west-1 (Ireland) | User preference for region |
| 2026-01-14 | 1 | Single shared migration set | Simpler than separate dev/prod migrations |
| 2026-01-14 | 1 | UUID primary keys with UUID[] arrays | Native Postgres types over VARCHAR(36) |
| 2026-01-14 | 1 | RLS with nested policies | Multi-tenant security via auth.uid() |
| 2026-01-14 | 1 | Private storage with owner-folder paths | Security over public access; path: {user_id}/{project_id}/{filename} |
| 2026-01-14 | 1 | Jobs table: inngest_event_id | Replaced celery_task_id for Inngest integration |
| 2026-01-14 | 1 | Trigger function security hardening | SECURITY DEFINER + SET search_path to prevent attacks |
| 2026-01-14 | 2 | Cookie-based sessions with @supabase/ssr | SSR-compatible auth; works with middleware |
| 2026-01-14 | 2 | Supabase pre-built Auth UI | Faster implementation; UI overhaul planned post-refactor |
| 2026-01-14 | 2 | Email/password only (for now) | Magic link + OAuth deferred to post-launch |
| 2026-01-14 | 2 | Theme-aware auth styling | Override Supabase UI with CSS variables for light/dark mode |
| 2026-01-15 | 3 | Replace legacy upload fully | Next.js API routes replace FastAPI for upload/media-url |
| 2026-01-15 | 3 | Client-side upload to Supabase | Direct upload via Supabase Storage SDK, not presigned URLs |
| 2026-01-15 | 3 | File size validation | 50MB default (Free plan), configurable for Pro plan upgrade (up to 500GB)  via env var |
| 2026-01-15 | 4 | Deepgram webhook via dg-token | Official Deepgram auth method; simpler than HMAC |
| 2026-01-15 | 4 | Configurable Deepgram concurrency | Account-scoped limit via `DEEPGRAM_CONCURRENCY_LIMIT` env var |
| 2026-01-15 | 4 | TypeScript 5.8+ upgrade | Required by Inngest 3.49+ for modern type features |
| 2026-01-15 | 5 | Deepgram async API with callbacks | Prevents serverless timeouts for long files |
| 2026-01-15 | 5 | Service role key for Inngest | Bypasses RLS for background job DB writes |
| 2026-01-15 | 5 | Callback URL derivation with override | Default from APP_URL, override for tunnels |
| 2026-01-15 | 5 | nova-3 as default model | Latest Deepgram model, configurable via env var |
| 2026-01-16 | 6 | Consolidation fetches word IDs from DB | Self-contained service, reusable for re-consolidation |
| 2026-01-16 | 6 | Consolidation step in webhook handler | Runs after segments/words stored, before completion event |
| 2026-01-16 | 6 | Idempotent chunk creation | Clear existing chunks before insert, cascade deletes chunk_words |
| 2026-01-16 | 6 | Deepgram `extra` param for metadata | Standard mechanism for passing metadata to webhook callbacks |
| 2026-01-16 | 6 | Batched word fetching | Prevents URL length errors for long transcripts (50 per batch) |
| 2026-01-17 | 7 | Supabase Realtime as primary | Replaces SWR polling; 5s polling fallback for reliability |
| 2026-01-17 | 7 | Shared types from Supabase schema | Single source of truth for TypeScript types |
| 2026-01-17 | 7 | Optimistic UI with rollback | Better UX for mutations; reverts on error |
| 2026-01-17 | 7 | Deprecate lib/swr.ts | Keep for backwards compatibility; new code uses hooks.ts |
| 2026-01-19 | 7 | Audio Sync: WebAudio backend | Fixes seek accuracy issues for VBR files; robust seek logic added |
| 2026-01-19 | 8 | Native Node.js DOCX generation | Moved from Python to `docx` npm package; better integration with Next.js |
| 2026-01-19 | 8 | Stable Speaker Grouping | Added fallback key for null speakers to fix missing headers in exports |
| 2026-01-19 | 8 | Shared Data Fetching | Centralized export data logic in `lib/exports/data.ts` to reduce duplication |
| 2026-01-19 | 9 | Supabase CLI for local dev | Official approach with guaranteed service compatibility and auto-migrations |
| 2026-01-19 | 9 | Hybrid Docker + CLI approach | Supabase via CLI, Inngest/Frontend via Docker for container isolation |
| 2026-01-19 | 9 | Convenience scripts | `start-local.sh` and `stop-local.sh` for one-command startup/shutdown |
| 2026-01-23 | 9 | Explicit cookie name for Docker auth | Fixes auth mismatch when server uses `host.docker.internal` but browser uses `localhost` |
| 2026-01-23 | 9 | Media proxy endpoint | Enables Deepgram to access local storage via single ngrok tunnel |
| 2026-01-23 | 9 | Auth callback route | Required for Supabase code exchange; middleware excludes from redirect logic |
| 2026-01-23 | 9 | SUPABASE_URL env var | Allows server-side to use Docker internal host while browser uses localhost |

