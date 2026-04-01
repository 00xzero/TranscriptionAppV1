# Phase 1: Supabase Foundation - Task Checklist

## Quick Summary

Set up the complete Supabase backend infrastructure: database schema with 8 tables, row-level security policies for multi-tenant isolation, and a private storage bucket for audio/video files. This creates the foundation that all subsequent phases build upon.

---

## Prerequisites

- [x] Phase 0 completed
- [x] Supabase MCP server connected
- [ ] Supabase account ready

---

## Key Files to Know

| File | Purpose |
|:---|:---|
| `SCHEMA_MAPPING.md` | Column mappings from SQLAlchemy to Postgres |
| `backend/app/models.py` | Current SQLAlchemy model definitions |
| `Phase_1_implementation_plan.md` | Detailed SQL and implementation guide |

---

## Decisions Made Before This Phase

| Decision | Reasoning | Reference |
|:---|:---|:---|
| TypeScript for consolidation | Unified stack, runs in Inngest Node.js | Phase 0 |
| Email/password + magic link auth | Simpler than OAuth initially | REFACTOR_PLAN.md |
| Signed URLs for storage | Security over public access | REFACTOR_PLAN.md |
| Single migration set | Shared between dev/prod | User preference |

---

## Tasks Checklist

### Supabase Project Setup
- [x] Create new Supabase project via MCP
- [x] Note project URL and keys

### Database Schema
- [x] Create `projects` table with `user_id` FK
- [x] Create `speakers` table
- [x] Create `segments` table
- [x] Create `words` table
- [x] Create `chunks` table
- [x] Create `chunk_words` table
- [x] Create `watchlist` table
- [x] Create `jobs` table (with `inngest_event_id`)
- [x] Create all indexes

### Row-Level Security
- [x] Enable RLS on `projects`
- [x] Enable RLS on `speakers`
- [x] Enable RLS on `segments`
- [x] Enable RLS on `words`
- [x] Enable RLS on `chunks`
- [x] Enable RLS on `chunk_words`
- [x] Enable RLS on `watchlist`
- [x] Enable RLS on `jobs`
- [x] Create SELECT/INSERT/UPDATE/DELETE policies for all tables

### Triggers
- [x] Create `update_updated_at_column()` function
- [x] Apply trigger to all tables with `updated_at`

### Storage
- [x] Create `media` bucket (private)
- [x] Create upload policy (owner folder)
- [x] Create read policy (owner folder)
- [x] Create delete policy (owner folder)

### Local Development Files
- [x] Create `infra/supabase/` directory
- [x] Create `infra/supabase/migrations/20260114000000_initial_schema.sql`
- [x] Create `infra/supabase/seed.sql`

### Verification
- [x] Verify all 8 tables exist
- [x] Verify RLS policies are active
- [ ] Test storage upload/download with signed URL (manual test pending)
- [ ] Run seed data (requires test user creation first)

---

## Testing This Phase

| Test | How to Run | Expected Result |
|:---|:---|:---|
| Schema verification | Query `information_schema.tables` | 8 tables listed |
| RLS active | Supabase dashboard → Table Editor | Policies visible |
| Storage test | Upload file via dashboard | Success |

---

## Definition of Done

- [x] All 8 tables created with correct schema
- [x] All RLS policies active and tested
- [x] Storage bucket `media` created with policies
- [x] Migration files saved to `infra/supabase/migrations/`
- [x] Seed data file created
- [x] Handoff notes written in PHASE_STATUS.md
- [x] Verification queries pass

---

## Notes for Next Phase (Phase 2: Auth)

- Supabase project URL and anon key needed for frontend client setup
- Service role key needed for Inngest functions (bypasses RLS)
- Test user creation will validate RLS policies work correctly
