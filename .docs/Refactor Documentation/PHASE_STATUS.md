# Phase Status Tracker

> **Update this file at the start and end of each phase.**

## Current Phase

| Field | Value |
|:---|:---|
| **Phase** | 5 - Deepgram Async Integration |
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
| 5 | Deepgram Async Integration | ⏳ Not Started | - |
| 6 | Consolidation Pipeline Port | ⏳ Not Started | - |
| 7 | Frontend Data Flow | ⏳ Not Started | - |
| 8 | Export Parity | ⏳ Not Started | - |
| 9 | Local Dev Docker | ⏳ Not Started | - |
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

*(Continue for each phase transition)*

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
