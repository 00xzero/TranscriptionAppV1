# Phase 6: Consolidation Pipeline Port

## Overview
Integrate TypeScript consolidation algorithm into Inngest transcription pipeline. The consolidation code was ported in Phase 0 (`frontend/lib/consolidation.ts`) and needs to be wired into the webhook handler.

## Tasks

### Planning
- [x] Review Phase 5 walkthrough and handoff notes
- [x] Review existing consolidation code (`frontend/lib/consolidation.ts`)
- [x] Review current Inngest functions (`frontend/lib/inngest/functions.ts`)
- [x] Review database schema for chunks and chunk_words tables
- [x] Create implementation plan

### Implementation
- [x] Create consolidation service module (`frontend/lib/inngest/consolidation-service.ts`)
  - Fetch segments and words from Supabase after transcription
  - Transform to `SegmentData` format required by consolidation
  - Call `consolidateAndProcess()` from `frontend/lib/consolidation.ts` 
  - Save chunks and chunk_words to Supabase
- [x] Update `handleTranscriptionWebhook`
  - Add consolidation step after segments/words are stored
  - Emit completion event after consolidation
- [x] Handle idempotency (clear existing chunks before insert)

### Verification
- [x] Build passes with no TypeScript errors
- [x] Run Inngest dev server and verify functions registered
- [x] Test consolidation on sample transcription data
- [x] Verify chunks and chunk_words stored correctly in Supabase
- [x] Create Phase 6 walkthrough document

### Documentation
- [x] Update PHASE_STATUS.md
- [x] Create Phase 6 folder with walkthrough
- [x] Update REFACTOR_README.md with Phase 6 link
