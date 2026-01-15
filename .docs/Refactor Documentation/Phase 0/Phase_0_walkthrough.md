# Phase 0 Walkthrough: Discovery and Decisions

## Summary

Completed Phase 0 discovery work for the stack refactor (FastAPI/Celery/Redis/MinIO → Vercel/Supabase/Inngest).

---

## Deliverables Created

### 1. API Route Mapping

[API_ROUTE_MAPPING.md](./API_ROUTE_MAPPING.md)

| Category | Count |
|:---|:---:|
| Supabase Direct | 13 |
| Next.js API | 7 |
| Inngest Functions | 2 |
| **Total Endpoints** | **22** |

### 2. Database Schema Mapping

[SCHEMA_MAPPING.md](./SCHEMA_MAPPING.md)

- 8 tables documented with column mappings
- RLS policies defined for all tables
- `user_id` addition planned for `projects` table (see `backend/app/routers/projects.py`)

### 3. TypeScript Consolidation Algorithm

`frontend/lib/consolidation.ts`

Ported Python consolidation logic (~350 lines) to TypeScript (~250 lines).

**Features preserved:**
- Speaker change breaks
- Gap-based breaks (>2000ms)
- Duration limits (15s max)
- Sentence boundary soft breaks
- Filler detection (20+ patterns)
- Text normalization

---

## Test Results

```
PASS __tests__/consolidation.test.ts
  isSentenceBoundary          6 tests
  isFiller                    5 tests
  normalizeText               5 tests
  getWordCount                3 tests
  consolidateSegments        10 tests
  consolidateAndProcess       5 tests
  custom configuration        3 tests

Test Suites: 1 passed, 1 total
Tests:       38 passed, 38 total
```

---

## Key Decisions

| Decision | Choice | Rationale |
|:---|:---|:---|
| Consolidation | **TypeScript** | Unified stack, runs in Inngest Node.js |
| Auth | Email + Magic Link | Simpler; Google OAuth post-launch |
| Realtime | Supabase + Polling | Robustness for reliability |
| Exports | Vercel Node | docx/VTT libs work in Node runtime |
| Storage | Signed URLs | Security over convenience |

---

## Files Changed

| File | Action |
|:---|:---|
| `.docs/Refactor Documentation/API_ROUTE_MAPPING.md` | Created |
| `.docs/Refactor Documentation/SCHEMA_MAPPING.md` | Created |
| `.docs/Refactor Documentation/PHASE_STATUS.md` | Updated |
| `.docs/Refactor Documentation/REFACTOR_README.md` | Updated |
| `frontend/lib/consolidation.ts` | Created |
| `frontend/__tests__/consolidation.test.ts` | Created |

---

## Next Steps: Phase 1

Ready to begin **Phase 1: Supabase Foundation**:
1. Create Supabase project (dev + prod)
2. Write SQL migrations per SCHEMA_MAPPING.md
3. Implement RLS policies
4. Set up storage buckets
5. Create seed data for local dev
