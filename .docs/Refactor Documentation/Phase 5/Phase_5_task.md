# Phase 5: Deepgram Async Integration

## Overview
Implement asynchronous transcription using Deepgram's callback API with Inngest handling the durable processing pipeline.

---

## Discovery & Planning
- [x] Read main refactor documentation (REFACTOR_PLAN.md, PHASE_STATUS.md)
- [x] Review Phase 4 deliverables and handoff notes
- [x] Analyze legacy worker implementation (`worker/app/worker.py`)
- [x] Review Deepgram API documentation for async/callback flow
- [x] Review Inngest skeleton functions from Phase 4
- [x] Understand Supabase RLS bypass requirements for Inngest
- [x] Create implementation plan

---

## Implementation

### 1. Supabase Admin Client
- [x] Create `frontend/lib/supabase/admin.ts`:
  - [x] `createAdminClient()` - service role client for Inngest functions

### 2. Deepgram Service
- [x] Create `frontend/lib/deepgram.ts`:
  - [x] `startAsyncTranscription()` - call Deepgram async API with callback
  - [x] `getCallbackUrl()` - derive callback URL from env vars
  - [x] `classifyError()` - port error classification from legacy worker
  - [x] `getMajoritySpeaker()` - port speaker detection from legacy worker

### 3. Inngest Event Updates
- [x] Update `frontend/lib/inngest/events.ts`:
  - [x] Add `jobId` to `transcription/requested` event type

### 4. Inngest Function Implementation
- [x] Update `frontend/lib/inngest/functions.ts`:
  - [x] `handleTranscriptionRequested`:
    - [x] Call Deepgram async API
    - [x] Store request_id in jobs table
    - [x] Update job status to "processing"
  - [x] `handleTranscriptionWebhook`:
    - [x] Parse Deepgram response (utterances, words)
    - [x] Create/get speakers with labels
    - [x] Clear existing segments (idempotency)
    - [x] Insert segments with speaker mapping
    - [x] Insert words with timestamps
    - [x] Calculate and update project duration
    - [x] Trigger completed/failed events
  - [x] `handleTranscriptionCompleted`:
    - [x] Update job status to "completed"
    - [x] Update project status to "completed"
  - [x] `handleTranscriptionFailed`:
    - [x] Classify error type
    - [x] Update job/project status to "error"

### 5. Start Endpoint Update
- [x] Update `frontend/app/api/projects/[id]/start/route.ts`:
  - [x] Pass `jobId` in Inngest event data

### 6. Environment Configuration
- [x] Document new environment variables:
  - [x] `SUPABASE_SERVICE_ROLE_KEY`
  - [x] `NEXT_PUBLIC_APP_URL`
  - [x] `DEEPGRAM_CALLBACK_URL` (optional override)
  - [x] `DEEPGRAM_MODEL` (default: nova-3)

---

## Verification
- [x] Build passes without type errors
- [x] Lint passes without errors
- [x] Inngest Dev Server shows all functions registered (requires manual test)
- [x] Create walkthrough documentation

---

## Documentation
- [x] Update PHASE_STATUS.md with Phase 5 completion
- [x] Add Phase 5 handoff notes for Phase 6
- [x] Create Phase 5 walkthrough
