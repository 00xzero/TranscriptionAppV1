# Phase 7: Frontend Data Flow Updates - Implementation Plan

> **Status**: ✅ Complete  
> **Date**: 2026-01-17

---

## What We Did

### 1. Created Supabase Infrastructure

| File | Purpose |
|:---|:---|
| `frontend/lib/supabase/realtime.ts` | Generic Realtime subscription hook with polling fallback |
| `frontend/lib/supabase/queries.ts` | Typed query helpers for projects, chunks, speakers |
| `frontend/lib/supabase/hooks.ts` | React hooks: useProjectsRealtime, useChunksRealtime, useSpeakersRealtime |
| `frontend/lib/supabase/types.ts` | TypeScript types from Supabase schema |

### 2. Updated Projects Page

- Replaced SWR polling with `useProjectsRealtime()` 
- Added connection status indicator (Live/Connecting/Disconnected)
- Delete uses Supabase `deleteProject()`
- Jobs fetched via `fetchProjectJobs()`

### 3. Updated Editor Page

- Chunks loaded via `fetchChunks()` (not legacy API)
- Speakers loaded via `fetchSpeakers()`
- Chunk edits use `updateChunk()` with optimistic UI
- Speaker operations use `createSpeaker()`, `updateSpeaker()`, `deleteSpeaker()`
- Title saves via `updateProject()`

### 4. Verified Upload Page

Already using Next.js API routes and Supabase Storage (from Phase 3).

### 5. Updated Shared Types

- SpeakerPopover now imports Speaker type from `lib/supabase/types.ts`
- Added deprecation notice to legacy `lib/swr.ts`

---

## Files Created/Modified

| File | Action | Purpose |
|:---|:---|:---|
| `lib/supabase/realtime.ts` | NEW | Generic Realtime hook |
| `lib/supabase/queries.ts` | NEW | Query helpers |
| `lib/supabase/hooks.ts` | NEW | React hooks |
| `lib/supabase/types.ts` | NEW | TypeScript types |
| `app/projects/page.tsx` | MODIFIED | Use Realtime hooks |
| `app/editor/[id]/page.tsx` | MODIFIED | Use Supabase queries |
| `components/SpeakerPopover.tsx` | MODIFIED | Import shared Speaker type |
| `lib/swr.ts` | MODIFIED | Added deprecation notice |

---

## Verification

### ✅ Build Passes

```text
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Generating static pages (12/12)

Route (app)                              Size
├ ○ /projects                            5.08 kB
├ ƒ /editor/[id]                         18.7 kB
```

### Pending Manual Testing

1. **Projects List Realtime** - Update project status in Supabase, verify it updates in browser within 1-2s
2. **Editor Loads from Supabase** - Verify Network tab shows no calls to `localhost:8000`
3. **Chunk Edit Persistence** - Edit text, refresh, verify changes persist
4. **Speaker Operations** - Rename speaker, verify optimistic update and persistence

---

## What's Next (Phase 8)

Phase 8 will add export parity:
- DOCX export via Next.js API route
- VTT export via Next.js API route
- PDF export (optional/post-launch)
