# Phase 5: Deepgram Async Integration - Walkthrough

> **Status**: ✅ Complete  
> **Date**: 2026-01-15

---

## Overview

Phase 5 implements asynchronous transcription using Deepgram's callback API with Inngest for durable processing. This replaces the legacy synchronous Celery worker approach.

---

## What We Did

### 1. Created Supabase Admin Client

| File | Purpose |
|:---|:---|
| `lib/supabase/admin.ts` | Service role client for Inngest (bypasses RLS) |

**Key features:**
- Singleton pattern for efficiency
- Uses `SUPABASE_SERVICE_ROLE_KEY` environment variable
- Clear error messages if not configured

### 2. Created Deepgram Service

| File | Purpose |
|:---|:---|
| `lib/deepgram.ts` | Async transcription API + error classification |

**Functions implemented:**
- `startAsyncTranscription()` - Call Deepgram async API with callback URL
- `getCallbackUrl()` - Derive from `DEEPGRAM_CALLBACK_URL` or `NEXT_PUBLIC_APP_URL`
- `getDeepgramModel()` - Get model from `DEEPGRAM_MODEL` env var (default: nova-3)
- `classifyError()` - Port error classification from legacy worker
- `getMajoritySpeaker()` - Port speaker detection from legacy worker

**TypeScript types exported:**
- `DeepgramAsyncOptions`, `DeepgramAsyncResponse`
- `DeepgramUtterance`, `DeepgramWord`, `DeepgramResponse`
- `ErrorType` ("keyterm_error" | "transcription_error")

### 3. Updated Inngest Functions

| File | Changes |
|:---|:---|
| `lib/inngest/events.ts` | Added `jobId` to requested event |
| `lib/inngest/functions.ts` | Replaced skeleton with full implementations |

**Function implementations:**

**`handleTranscriptionRequested`:**
1. Calls Deepgram async API with callback URL
2. Stores `request_id` in jobs table (`inngest_event_id` column)
3. Updates job status to "processing"
4. On failure: emits `transcription/failed` with error classification

**`handleTranscriptionWebhook`:**
1. Finds the processing job by `inngest_event_id` (requestId)
2. Parses Deepgram response (checks `results.utterances` then `alt.utterances`)
3. Clears existing segments for idempotency
4. Upserts speakers with "Speaker X" labels (cached, uses unique constraint)
5. Inserts segments with speaker mapping
6. Inserts words with timestamps and confidence
7. Triggers `transcription/completed` event
8. On failure: emits `transcription/failed` with job lookup

**`handleTranscriptionCompleted`:**
1. Updates job status to "completed" with `finished_at`
2. Updates project status to "completed"
3. Updates project `duration_seconds`

**`handleTranscriptionFailed`:**
1. Looks up job by `jobId` or falls back to finding processing job by `projectId`
2. Classifies error (`keyterm_error` vs `transcription_error`)
3. Updates job with error payload including `error_type`
4. Updates project status to "error"

### 4. Updated Start Endpoint

| File | Changes |
|:---|:---|
| `app/api/projects/[id]/start/route.ts` | Passes `jobId` to Inngest event |

### 5. Environment Configuration

**New environment variables:**
```plaintext
SUPABASE_SERVICE_ROLE_KEY=    # Required for Inngest DB writes
NEXT_PUBLIC_APP_URL=          # Base URL for callbacks
DEEPGRAM_CALLBACK_URL=        # Optional override for tunnels
DEEPGRAM_MODEL=nova-3         # Deepgram model selection
```

---

## Files Created/Modified

| File | Action | Purpose |
|:---|:---|:---|
| `lib/supabase/admin.ts` | NEW | Service role Supabase client |
| `lib/deepgram.ts` | NEW | Deepgram async API service |
| `lib/inngest/events.ts` | MODIFIED | Add jobId to event type |
| `lib/inngest/functions.ts` | MODIFIED | Full function implementations |
| `app/api/projects/[id]/start/route.ts` | MODIFIED | Pass jobId to event |

---

## Verification

### ✅ Build Passes

```
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Generating static pages (12/12)

Route (app)                              Size
├ ƒ /api/inngest                         0 B
├ ƒ /api/projects/[id]/start             0 B
├ ƒ /api/webhooks/deepgram               0 B
```

### Pending Manual Testing

The following require Inngest Dev Server + Deepgram API key:

1. **Inngest Dev Server**
   ```bash
   npx inngest-cli@latest dev
   ```
   Verify 4 functions registered at http://localhost:8288

2. **End-to-End Transcription**
   - Set up ngrok tunnel for local webhook
   - Upload file, start transcription
   - Verify Deepgram callback received
   - Verify segments/words stored in Supabase

3. **Error Handling**
   - Test with invalid key terms
   - Verify error classification works

---

## Architecture Decisions

**Async over Sync:**
- Deepgram async API chosen over sync for reliability with long files
- Webhook callbacks ensure no serverless timeout issues
- Inngest provides durability and automatic retries

**Service Role Key:**
- Required for Inngest functions to write to Supabase
- RLS policies don't apply to service role
- Key stored as secret environment variable

**Callback URL Strategy:**
- Default: `NEXT_PUBLIC_APP_URL` + `/api/webhooks/deepgram`
- Override: `DEEPGRAM_CALLBACK_URL` for local tunnel development

**Idempotency:**
- Segments are cleared before inserting new ones
- Prevents duplicate data on webhook retries

**Speaker Caching:**
- Speakers are cached during utterance processing
- Reduces database queries for repeat speakers

---

## Post-Implementation Fixes

After initial implementation, the following issues were identified and fixed:

### 1. Error String Guard
**Issue**: `error.slice(0, 500)` in `handleTranscriptionFailed` would throw if error wasn't a string  
**Fix**: Added type coercion before slicing:
```typescript
const errorString = typeof error === "string" ? error : String(error);
```

### 2. Job Lookup Validation
**Issue**: Job lookup could match wrong processing job without verifying requestId  
**Fix**: Added `.eq("inngest_event_id", requestId)` filter to ensure correct job match

### 3. Delete Error Handling
**Issue**: Segment delete operation ignored errors, could proceed with inserts after failed delete  
**Fix**: Check `deleteError` and throw before continuing to inserts for proper idempotency

### 4. Speaker Race Condition
**Issue**: SELECT+INSERT pattern caused race conditions creating duplicate speakers  
**Fix**: 
- Added `UNIQUE (project_id, label)` constraint via migration
- Replaced SELECT+INSERT with `.upsert()` using `onConflict: "project_id,label"`

### 5. Documentation Portability
**Issue**: Implementation plan used developer-specific absolute file URLs  
**Fix**: Replaced with relative repository paths for portability

### 6. Keyterm Parameter Alignment
**Issue**: Deepgram async request used `keywords` param, but legacy worker and Deepgram docs use `keyterm`  
**Fix**: Changed param name in `startAsyncTranscription()`:
```typescript
// Before: params.append("keywords", term);
params.append("keyterm", term);
```

### 7. Error Type Enum Alignment
**Issue**: Error types used `"keyterm"` / `"general"` but UI checks for `"keyterm_error"` / `"transcription_error"`  
**Fix**: Updated constants in `deepgram.ts` and `events.ts`:
```typescript
export const ERROR_TYPE_KEYTERM = "keyterm_error" as const;
export const ERROR_TYPE_GENERAL = "transcription_error" as const;
```

### 8. Webhook onFailure Handler
**Issue**: When webhook handler fails (e.g., DB insert error), job stayed stuck in "processing"  
**Fix**: Added `onFailure` callback to `handleTranscriptionWebhook`:
- Looks up jobId by requestId before emitting
- Emits `transcription/failed` event
- Job/project status updated to error

### 9. Request onFailure Handler
**Issue**: When Deepgram API rejects request (e.g., invalid key terms), job stayed stuck in "queued"  
**Fix**: Added `onFailure` callback to `handleTranscriptionRequested`:
- Uses `classifyError()` to detect keyterm errors
- Emits `transcription/failed` with appropriate error type
- UI shows "Edit Key Terms" CTA for keyterm errors

### 10. JobId Fallback in Failed Handler
**Issue**: If `jobId` was empty in `transcription/failed` event, job row wasn't updated  
**Fix**: Added fallback lookup in `handleTranscriptionFailed`:
```typescript
if (!jobId) {
    const { data: job } = await supabase
        .from("jobs")
        .eq("project_id", projectId)
        .eq("status", "processing")
        .maybeSingle();
    if (job) jobId = job.id;
}
```

### 11. Utterances Fallback Path
**Issue**: Webhook parser only checked `results.utterances`, missing `alt.utterances`  
**Fix**: Added fallback matching legacy worker behavior:
```typescript
const utterances = results.utterances || (alt as { utterances?: DeepgramUtterance[] })?.utterances;
```

### 12. Migration Deduplication
**Issue**: Adding UNIQUE constraint would fail if duplicate speaker labels already exist  
**Fix**: Migration now deduplicates before adding constraint:
1. Creates temp table with duplicate→keeper mapping
2. Updates segments to point to keeper speaker
3. Updates chunks to point to keeper speaker
4. Deletes duplicate speakers
5. Adds UNIQUE constraint

### New Migration (Updated)
Created `infra/supabase/migrations/20260115000000_speakers_unique_constraint.sql`:
```sql
-- Create temp table with dedup mapping
CREATE TEMP TABLE speaker_dedup_map AS
WITH duplicates AS (
    SELECT id, project_id, label,
           ROW_NUMBER() OVER (PARTITION BY project_id, label 
                              ORDER BY created_at ASC, id ASC) as rn
    FROM speakers
),
keepers AS (SELECT id, project_id, label FROM duplicates WHERE rn = 1)
SELECT d.id as old_id, k.id as new_id
FROM duplicates d
JOIN keepers k ON d.project_id = k.project_id AND d.label = k.label
WHERE d.rn > 1;

-- Update foreign key references
UPDATE segments SET speaker_id = m.new_id FROM speaker_dedup_map m WHERE speaker_id = m.old_id;
UPDATE chunks SET speaker_id = m.new_id FROM speaker_dedup_map m WHERE speaker_id = m.old_id;

-- Delete duplicates and add constraint
DELETE FROM speakers WHERE id IN (SELECT old_id FROM speaker_dedup_map);
DROP TABLE speaker_dedup_map;
ALTER TABLE speakers ADD CONSTRAINT speakers_project_id_label_unique UNIQUE (project_id, label);
```

---

## What's Next (Phase 6)

Phase 6 will port the consolidation pipeline:

1. Integrate TypeScript consolidation from `lib/consolidation.ts`
2. Run consolidation after webhook processing
3. Generate chunks and chunk_words
4. Test output matches legacy Python implementation

**Handoff Notes for Phase 6:**
- Segments and words now stored in Supabase after transcription
- Consolidation should trigger at end of `handleTranscriptionWebhook`
- TypeScript consolidation already exists (ported in Phase 0)
- Use admin client for consolidation DB operations
