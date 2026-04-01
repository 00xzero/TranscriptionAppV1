# Phase 4: Inngest Setup and Webhook Handler - Walkthrough

> **Status**: ✅ Complete  
> **Date**: 2026-01-15

---

## Overview

Phase 4 set up Inngest for background job processing, replacing the legacy Celery/Redis worker. This creates the foundation for async transcription processing in Phase 5.

---

## What We Did

### 1. Installed Inngest Package

| Action | Details |
|:---|:---|
| Upgraded TypeScript | 5.4.5 → 5.8.x (required by Inngest) |
| Installed Inngest | `npm install inngest` |

### 2. Created Inngest Core Files

| File | Purpose |
|:---|:---|
| [lib/inngest/events.ts] | TypeScript event type definitions |
| [lib/inngest/client.ts] | Inngest client with typed schemas |
| [lib/inngest/functions.ts] | Skeleton functions for transcription lifecycle |

**Event Types Defined:**
- `transcription/requested` - User triggers transcription
- `transcription/webhook` - Deepgram sends results
- `transcription/completed` - Processing finished successfully
- `transcription/failed` - Processing failed with error

### 3. Created API Routes

| File | Endpoint | Purpose |
|:---|:---|:---|
| [app/api/inngest/route.ts] | `/api/inngest` | Inngest serve handler (GET/POST/PUT) |
| [app/api/webhooks/deepgram/route.ts] | `/api/webhooks/deepgram` | Deepgram callback with dg-token verification |
| [app/api/projects/[id]/start/route.ts] | `/api/projects/{id}/start` | Start transcription for a project |

### 4. Updated Environment Configuration

| File | Changes |
|:---|:---|
| [.env.example] | Added Inngest + Deepgram variables |
| [.env.local] | Added placeholder variables |

**New Environment Variables:**
```plaintext
INNGEST_EVENT_KEY=          # Production: Inngest Dashboard
INNGEST_SIGNING_KEY=        # Production: Inngest Dashboard
DEEPGRAM_API_KEY=           # Phase 5
DEEPGRAM_API_KEY_IDENTIFIER= # For webhook verification
DEEPGRAM_CONCURRENCY_LIMIT=5 # Configurable
```

---

## Key Implementation Details

### Deepgram Webhook Security

Uses Deepgram's official `dg-token` header verification with **timing-safe comparison** to prevent timing attacks:

```typescript
// Updated to use crypto.timingSafeEqual for security
const source = Buffer.from(dgToken);
const target = Buffer.from(process.env.DEEPGRAM_API_KEY_IDENTIFIER);
if (!timingSafeEqual(source, target)) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

### Robust Error Handling
- Added `try-catch` block around `inngest.send()` in start endpoint.
- Implements rollback logic (marks project/job as failed) if Inngest is unavailable.
- Prevents silent failures where checking operations would appear successful but no background job runs.

### Retry Policy
- Added explicit retries (`retries: 3`) to `handleTranscriptionCompleted` to ensure database updates in Phase 5 are robust against transient failures.

### Configurable Concurrency

Account-scoped concurrency limit via environment variable:

```typescript
const DEEPGRAM_CONCURRENCY = parseInt(
  process.env.DEEPGRAM_CONCURRENCY_LIMIT || "5", 10
);

inngest.createFunction({
  concurrency: { scope: "account", key: '"deepgram"', limit: DEEPGRAM_CONCURRENCY }
}, ...);
```

---

## Verification

### ✅ Build Passes

```
✓ Linting and checking validity of types
✓ Generating static pages (12/12)

Route (app)                              Size
├ ƒ /api/inngest                         0 B
├ ƒ /api/projects/[id]/start             0 B
├ ƒ /api/webhooks/deepgram               0 B
```

### Pending Manual Verification

The following require Inngest Dev Server:

1. **Inngest Dev Server Connection**
   - Start: `npx inngest-cli@latest dev`
   - Verify app appears at http://localhost:8288

2. **Event Trigger Test**
   - Send test event from Inngest Dev UI
   - Verify function executes

3. **Webhook Security Test**
   - Test without dg-token → 401
   - Test with valid dg-token → 200

---

## What's Next (Phase 5)

Phase 5 will implement Deepgram async integration:

1. Call Deepgram async API with callback URL
2. Store `request_id` in jobs table
3. Parse webhook payload (utterances, words)
4. Store segments with speaker mapping

**Handoff Notes for Phase 5:**
- Signed URLs via `getSignedMediaUrl()` (1-hour expiry)
- Webhook URL: `/api/webhooks/deepgram`
- Pass `project_id` in Deepgram metadata for callback matching
- Service role key may be needed for DB updates in Inngest functions
