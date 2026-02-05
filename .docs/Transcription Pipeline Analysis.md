# Transcription Pipeline Analysis

## Executive Summary

The pipeline is **not fully robust**. The original report is good, but it misses several silent-failure paths and a few important nuances. The biggest risk is **status updates that fail without retries**, which can leave projects/jobs stuck in "processing" or "queued" with no surfaced error. There are also **job-status mismatches** and **webhook edge cases** that can silently stall the pipeline.

Overall robustness: **6/10** (same ballpark), but several *critical* silent-failure gaps remain unaddressed.

---

## What the original report got right

- The pipeline is mostly structured with retries and onFailure handlers.
- Webhook errors can strand a project in "processing".
- Consolidation failures can cause user-visible failures despite partial data.
- UI error display is limited and alert-based.

---

## Missing or Understated Silent-Failure Scenarios (code-verified)

### Critical

1. **Completion/failure status updates can fail silently**
  - Both `handleTranscriptionCompleted` and `handleTranscriptionFailed` log DB update errors but do **not throw**, so Inngest considers the step successful and does not retry. This can leave jobs/projects stuck indefinitely with no surfaced error.
  - References:
    - `frontend/lib/inngest/functions.ts:441`
    - `frontend/lib/inngest/functions.ts:454`
    - `frontend/lib/inngest/functions.ts:499`
    - `frontend/lib/inngest/functions.ts:553`

2. **Job status mismatch hides errors from UI**
  - Start-route rollback sets job status to `failed`, but UI only fetches errors where `status = 'error'`, so the user sees an error state without any message.
  - References:
    - `frontend/app/api/projects/[id]/start/route.ts:148`
    - `frontend/app/api/projects/[id]/start/route.ts:151`
    - `frontend/lib/supabase/queries.ts:88`
    - `frontend/app/projects/page.tsx:34`

3. **Webhook auth/config errors never mark the job/project as failed**
  - Missing `dg-token`, invalid token, or missing `DEEPGRAM_API_KEY_IDENTIFIER` results in 401/500 responses without any fallback event or DB update. Projects remain stuck.
  - References:
    - `frontend/app/api/webhooks/deepgram/route.ts:40`
    - `frontend/app/api/webhooks/deepgram/route.ts:48`

4. **Webhook payload missing project_id/request_id leads to hard stop**
  - If Deepgram sends malformed payloads (or changes schema), webhook returns 400 and stops; no failure event is emitted, leaving jobs in limbo.
  - References:
    - `frontend/app/api/webhooks/deepgram/route.ts:87`

5. **Fallback job selection can bind a webhook to the wrong job**
  - If multiple jobs exist (e.g., re-queued or duplicate starts), the webhook fallback picks the latest queued/processing job. The original job may never complete and no error is surfaced.
  - References:
    - `frontend/app/api/webhooks/deepgram/route.ts:118`

### High

6. **"Queued" projects are not blocked in the start route**
  - The API only rejects `status === "processing"`. If `projects.status` failed to update or two clients start simultaneously, duplicate jobs can be created; webhook fallback can attach to the wrong one.
  - References:
    - `frontend/app/api/projects/[id]/start/route.ts:49`
    - `frontend/app/api/projects/[id]/start/route.ts:125`

7. **Failure handler lookup ignores queued jobs**
  - `handleTranscriptionFailed` only searches for `status = 'processing'`. If the failure happened before that transition (still `queued`), the job never gets error payload and the UI shows no details.
  - References:
    - `frontend/lib/inngest/functions.ts:511`

8. **Send event failure after segments are stored causes false failure**
  - If `transcription/completed` send fails, the webhook handler retries and then emits `transcription/failed`, even though segments already exist. This is a false-negative error state (not silent, but misleading).
  - References:
    - `frontend/lib/inngest/functions.ts:394`

### Medium

9. **No retry or fallback when UI error fetch fails**
  - If `fetchJobError` fails once, the UI never retries unless the project list changes. Users may see "error" status with no message.
  - References:
    - `frontend/app/projects/page.tsx:34`
    - `frontend/lib/supabase/queries.ts:88`

10. **Key term query errors are ignored**
  - If the watchlist query fails, transcription proceeds with empty key terms and no error is surfaced. Not catastrophic but still silent.
  - References:
    - `frontend/app/api/projects/[id]/start/route.ts:57`

---

## Corrections / Nuance vs Original Report

- **Consolidation failure is not silent today**: it bubbles to the webhook handler’s `onFailure`, which emits `transcription/failed`. The risk is *false failure after partial success*, not invisibility.
  - Reference: `frontend/lib/inngest/functions.ts:379`

---

## Updated Recommendations (prioritized)

### High Priority

1. **Make status updates retryable**
  - Throw on `jobError`/`projectError` in `handleTranscriptionCompleted` and `handleTranscriptionFailed` so Inngest retries.
  - If updates still fail after retries, emit a separate "status-update-failed" event and mark job/project with a fallback error.

2. **Normalize job failure status**
  - Use one status (preferably `error`) for all failed jobs, or update UI to treat `failed` as error.

3. **Add webhook failure fallback**
  - If webhook validation fails (401/400), persist an error to the job or emit a failure event keyed by request_id/project_id when possible.

4. **Prevent duplicate starts**
  - Treat `queued` as non-startable and enforce at the API layer, not just the UI.

### Medium Priority

5. **Improve failure lookup**
  - In `handleTranscriptionFailed`, lookup `queued` as well as `processing` jobs when jobId is missing.

6. **Explicitly handle "completed event" failure**
  - If `transcription/completed` send fails, consider marking job as completed with a "completion event failed" warning, or retry via a separate recovery job.

7. **Retry UI error fetches**
  - Add a retry button or periodic refetch for `fetchJobError` when it fails.

---

## Updated Test Matrix (focus on silent failure)

1. **DB update failure in completion handler**
  - Force Supabase update failure in `handleTranscriptionCompleted` and confirm retries or fallback error path.

2. **Job status mismatch**
  - Simulate Inngest send failure in start route and confirm UI can still show error details.

3. **Webhook auth failure**
  - Send webhook with missing/invalid dg-token; verify project/job transitions to error with message.

4. **Webhook payload missing metadata**
  - Send payload without `metadata.extra.project_id`; verify error propagation instead of silent stall.

5. **Duplicate start/queued state**
  - Start transcription twice quickly or from two clients; confirm second start is rejected.

6. **Queued-only failure**
  - Force error before job is marked `processing` and confirm `handleTranscriptionFailed` still finds and updates the job.

7. **Completed-event send failure**
  - Simulate failure sending `transcription/completed`; verify no false error state.

---

## Current Robustness Rating (updated)

| Stage | Error Handling | User Feedback | Recovery | Rating |
| --- | --- | --- | --- | --- |
| UI Trigger | Good | Poor (alert) | Manual retry | 6/10 |
| Start Route | Fair | Good | Partial rollback | 6/10 |
| Inngest Request | Good | Via DB | Automatic retry | 8/10 |
| Webhook Endpoint | Fair | None on failure | Deepgram retry only | 5/10 |
| Webhook Processing | Good | Via DB | Automatic retry | 7/10 |
| Consolidation | Fair | Via DB | None | 5/10 |
| Failure Handler | Fair | Via DB | Limited retries | 6/10 |
| UI Error Display | Fair | Good | Manual retry | 6/10 |

**Overall: 6/10** (moderately robust, with critical silent-failure gaps)
