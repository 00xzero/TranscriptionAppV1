# Phase Status Tracker

> **Update this file at the start and end of each phase.**

## Current Phase

| Field | Value |
|:---|:---|
| **Phase** | 2 - Auth and Session Wiring |
| **Status** | Not Started |
| **Owner** | TBD |
| **Started** | - |
| **Target Completion** | - |

## Phase Progress

| Phase | Name | Status | Completion Date |
|:---|:---|:---|:---|
| 0 | Discovery + Consolidation Spike | ✅ Complete | 2026-01-13 |
| 1 | Supabase Foundation | ✅ Complete | 2026-01-14 |
| 2 | Auth and Session Wiring | ⏳ Not Started | - |
| 3 | Storage and Upload Flow | ⏳ Not Started | - |
| 4 | Inngest Setup | ⏳ Not Started | - |
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
- URL: `https://svzeffnmlqbdnjzhcgyx.supabase.co`
- Anon Key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2emVmZm5tbHFiZG5qemhjZ3l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzNDI4ODAsImV4cCI6MjA4MzkxODg4MH0.bW_kkfhxlZFwjxkbcQXBF_kVdnKCEM-5Oo1VZpxop1g`
- Publishable Key: `sb_publishable__UhRdEdXQnMz3og1J18kKQ__mOaK5q3`

**For Phase 2:**
- Set up Supabase client in Next.js (browser + server)
- Add auth UI (sign in/up, magic link)
- Replace X-API-Key header with Supabase auth
- Add route protection in app router

**Gotchas:**
- Storage path convention: `{user_id}/{project_id}/{filename}`
- RLS uses `auth.uid()` - ensure client sends valid JWT
- Service role key needed for Inngest (bypasses RLS)

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
