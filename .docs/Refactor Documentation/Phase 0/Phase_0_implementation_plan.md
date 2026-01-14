# Phase 0: Discovery and Decisions Implementation Plan

## Goal

Complete discovery work and make key architectural decisions before implementing Phase 1 (Supabase Foundation). This phase produces mapping documents and a consolidation algorithm spike.

---

## User Review Required

> [!IMPORTANT]
> **Consolidation Spike Decision**: The consolidation algorithm (~350 lines Python) needs to be evaluated for TypeScript port feasibility. Should we:
> 1. Port to TypeScript (run in Inngest Node.js functions)
> 2. Keep as Python (Inngest supports Python functions natively)
> 
> The spike will help inform this decision.

> [!NOTE]
> **Decisions Already Made** (per REFACTOR_PLAN.md):
> - Max file size: 1.5GB / 4 hours
> - Auth: Email/password + magic link (Google OAuth post-launch)
> - Realtime: Supabase Realtime with 5s polling fallback
> - Exports: Vercel Node runtime for DOCX/VTT (PDF optional)
> - Storage: Signed URLs for Deepgram access

---

## Proposed Deliverables

### 1. API Route Mapping Document

Create `.docs/Refactor Documentation/API_ROUTE_MAPPING.md`:

| Current Endpoint | Method | Target | Notes |
|:---|:---|:---|:---|
| `/projects` | POST | Next.js API + Supabase | Create project with RLS |
| `/projects` | GET | Supabase Direct | List with RLS filter |
| `/projects/{id}` | GET | Supabase Direct | Single project read |
| `/projects/{id}` | PATCH | Supabase Direct | Update title |
| `/projects/{id}` | DELETE | Supabase Direct | Cascade delete with RLS |
| `/projects/{id}/start` | POST | Next.js API → Inngest | Trigger transcription |
| `/projects/{id}/media-url` | GET | Next.js API | Generate signed URL |
| `/projects/{id}/key-terms` | PATCH | Supabase Direct | Update watchlist |
| `/projects/{id}/jobs` | GET | Supabase Direct | List jobs |
| `/projects/{id}/segments` | GET | Supabase Direct | List segments |
| `/projects/{id}/segments/import` | POST | Next.js API → Inngest | Bulk import + consolidate |
| `/projects/{id}/chunks` | GET | Supabase Direct | List chunks for editor |
| `/projects/{id}/speakers` | GET/POST | Supabase Direct | CRUD with RLS |
| `/segments/{id}` | PATCH | Supabase Direct | Edit segment |
| `/chunks/{id}` | PATCH | Supabase Direct | Edit chunk (marks is_edited) |
| `/speakers/{id}` | PATCH | Supabase Direct | Rename/update |
| `/projects/{id}/export/docx` | GET | Next.js API | Server-side generation |
| `/projects/{id}/export/vtt` | GET | Next.js API | Server-side generation |
| `/projects/{id}/export/pdf` | GET | Next.js API | Server-side generation |

---

### 2. Database Schema Mapping Document

Create `.docs/Refactor Documentation/SCHEMA_MAPPING.md`:

#### Tables Requiring user_id Addition
- [projects](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/backend/app/routers/projects.py#88-110) - owner of the project
- `watchlist` - inherits from project

#### Tables Scoped via Project Foreign Key
- [speakers](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/backend/app/routers/projects.py#355-362) (project_id)
- [segments](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/backend/app/routers/projects.py#262-329) (project_id)
- `words` (segment_id → project_id)
- [chunks](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/backend/app/routers/projects.py#553-572) (project_id)
- `chunk_words` (chunk_id → project_id)
- [jobs](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/backend/app/routers/projects.py#243-251) (project_id)

#### RLS Policy Summary

| Table | Policy | Rule |
|:---|:---|:---|
| projects | SELECT/INSERT/UPDATE/DELETE | `user_id = auth.uid()` |
| speakers | SELECT/INSERT/UPDATE/DELETE | `project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())` |
| segments | SELECT/INSERT/UPDATE/DELETE | Same as speakers |
| chunks | SELECT/INSERT/UPDATE/DELETE | Same as speakers |
| jobs | SELECT/INSERT/UPDATE/DELETE | Same as speakers |
| watchlist | SELECT/INSERT/UPDATE/DELETE | Same as speakers |
| words | SELECT/INSERT/UPDATE/DELETE | `segment_id IN (SELECT id FROM segments WHERE project_id IN (...))` |
| chunk_words | SELECT/INSERT/UPDATE/DELETE | Similar nested check |

---

### 3. Consolidation Algorithm Spike

#### [NEW] [consolidation.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code folder/CascadeProjects/TranscriptionAppV1/frontend/lib/consolidation.ts)

Port the core algorithm from Python:
- [ConsolidationConfig](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/backend/app/services/consolidation.py#32-57) interface
- [SegmentData](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/backend/app/services/consolidation.py#67-84) / [ChunkData](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/backend/app/services/consolidation.py#86-114) types
- `consolidateSegments()` function
- `isSentenceBoundary()` / `isFiller()` / `normalizeText()` helpers

#### [NEW] [consolidation.test.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code folder/CascadeProjects/TranscriptionAppV1/frontend/__tests__/consolidation.test.ts)

Test cases:
1. Empty input returns empty
2. Single segment becomes single chunk
3. Speaker change triggers break
4. Gap > 2000ms triggers break  
5. Duration > 15000ms triggers break
6. Word count + sentence boundary triggers soft break
7. Filler detection works
8. Compare outputs with Python implementation on sample data

---

## Verification Plan

### Automated Tests

1. **Consolidation TypeScript tests** (if spike proceeds):
   ```bash
   cd frontend && npm test -- --testPathPattern=consolidation
   ```

### Manual Verification

1. **API Route Mapping Review**: Review the generated `API_ROUTE_MAPPING.md` for completeness
2. **Schema Mapping Review**: Verify all tables and RLS policies are documented
3. **Consolidation Spike Review**: Compare TypeScript output with Python output on sample segment data

---

## Questions for You

Before I proceed, I have a few questions:

1. **Consolidation Spike Priority**: The consolidation spike is the main code work for Phase 0. Would you like me to:
   - (a) Complete the full TypeScript port and tests
   - (b) Just do a partial spike to assess complexity
   - (c) Skip the spike and decide to keep Python (Inngest supports Python)

2. **Sample Data for Testing**: Do you have a project with segments I can use to validate the consolidation spike, or should I create synthetic test data?

3. **Documentation Location**: Should the mapping documents go in `.docs/Refactor Documentation/` alongside the other refactor docs?
