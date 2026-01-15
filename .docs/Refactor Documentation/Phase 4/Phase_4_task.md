# Phase 4: Inngest Setup and Webhook Handler

## Objective
Set up Inngest for background job processing with skeleton functions for the transcription lifecycle.

---

## Tasks

### Setup and Configuration
- [x] Install `inngest` package in frontend
- [x] Create Inngest client (`lib/inngest/client.ts`)
- [x] Create API route handler (`app/api/inngest/route.ts`)
- [x] Add environment variables to `.env.example` and `.env.local`

### Event Model and Functions
- [x] Define TypeScript types for transcription events
- [x] Create `transcription.requested` function (skeleton)
- [x] Create `transcription.webhook` function (skeleton)
- [x] Create `transcription.completed` function (skeleton)
- [x] Create `transcription.failed` function (skeleton)

### Webhook Endpoint
- [x] Create Deepgram webhook handler (`app/api/webhooks/deepgram/route.ts`)
- [x] Implement `dg-token` header verification (Deepgram official method)
- [x] Add `DEEPGRAM_API_KEY_IDENTIFIER` env var for verification
- [x] Forward webhook payload to Inngest event

### Job Lifecycle Integration
- [x] Add idempotency handling for job triggers
- [x] Add configurable concurrency via `DEEPGRAM_CONCURRENCY_LIMIT` env var
- [x] Create `/api/projects/[id]/start` route to trigger transcription

### Documentation
- [x] Update `.env.example` with Inngest variables
- [x] Update PHASE_STATUS.md with handoff notes
- [x] Create Phase 4 walkthrough document

---

## Verification
- [x] Build passes without errors
- [x] Inngest Dev Server connects to API route (manual test required)
- [x] Test event triggers show in Inngest Dev UI (manual test required)
- [x] Webhook endpoint responds correctly (manual test required)
