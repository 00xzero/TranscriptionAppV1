# Phase 5: Deepgram Async Integration

Implement asynchronous transcription using Deepgram's callback API, with Inngest handling the processing pipeline. This replaces the legacy synchronous Celery worker approach.

---

## Background

The current stack uses:
- **Worker**: Celery task calls Deepgram synchronously, waits for response
- **Storage**: Deepgram receives presigned S3 URL or raw bytes
- **Processing**: Single task handles transcription + segment storage + consolidation

The target stack uses:
- **Trigger**: Next.js API route sends `transcription/requested` event to Inngest
- **Deepgram**: Async API with callback URL pointing to `/api/webhooks/deepgram`
- **Processing**: Inngest functions handle each step durably with retries
- **Storage**: Supabase (requires service role key to bypass RLS in Inngest functions)

---

## User Configuration Required

> [!IMPORTANT]
> **Supabase Service Role Key**: Inngest functions need to bypass RLS to write transcription data. Add `SUPABASE_SERVICE_ROLE_KEY` to your environment (found in Supabase Dashboard → Settings → API).

> [!NOTE]
> **Deepgram API Key**: Ensure `DEEPGRAM_API_KEY` is set for transcription requests.

> [!NOTE]
> **Callback URL**: For local development with Deepgram webhooks, you'll need a public tunnel (e.g., ngrok). Set `DEEPGRAM_CALLBACK_URL` or `NEXT_PUBLIC_APP_URL` accordingly.

---

## Proposed Changes

### Supabase Admin Client

#### [NEW] [admin.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/lib/supabase/admin.ts)

Service role client for Inngest functions (bypasses RLS):

```typescript
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
```

---

### Deepgram Service

#### [NEW] [deepgram.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/lib/deepgram.ts)

Deepgram async API client:

```typescript
const DEEPGRAM_API_URL = "https://api.deepgram.com/v1/listen";

interface DeepgramAsyncOptions {
  mediaUrl: string;
  callbackUrl: string;
  projectId: string;
  keyTerms?: string[];
  model?: string;
}

export async function startAsyncTranscription(options: DeepgramAsyncOptions): Promise<{ requestId: string }> {
  // Build query params: model, diarize, utterances, callback, keyterms
  // POST to Deepgram with JSON body { url: mediaUrl }
  // Return request_id from response
}

export function getCallbackUrl(): string {
  // Priority: DEEPGRAM_CALLBACK_URL > NEXT_PUBLIC_APP_URL + /api/webhooks/deepgram
}

export function classifyError(errorText: string): { type: "keyterm" | "general"; message: string } {
  // Port error classification from legacy worker
}
```

---

### Inngest Function Updates

#### [MODIFY] [events.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/lib/inngest/events.ts)

Add `jobId` to `transcription/requested` event for tracking:

```typescript
"transcription/requested": {
  data: {
    projectId: string;
    jobId: string;      // NEW: Track job from start
    userId: string;
    mediaUrl: string;
    keyTerms?: string[];
  };
};
```

---

#### [MODIFY] [functions.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/lib/inngest/functions.ts)

Replace skeleton implementations with real logic:

**handleTranscriptionRequested:**
1. Call Deepgram async API with callback URL
2. Store `request_id` in jobs table (`inngest_event_id` column)
3. Update job status to "processing"

**handleTranscriptionWebhook:**
1. Parse Deepgram response (utterances, words)
2. Create/get speakers with "Speaker X" labels
3. Clear existing segments for project (idempotency)
4. Insert segments with speaker mapping
5. Insert words with timestamps and confidence
6. Calculate project duration from max end time
7. Trigger `transcription/completed` event
8. On error: Trigger `transcription/failed` event

**handleTranscriptionCompleted:**
1. Update job status to "completed" with finished_at
2. Update project status to "completed"
3. Update project duration_seconds

**handleTranscriptionFailed:**
1. Classify error (keyterm vs general)
2. Update job status to "error" with payload
3. Update project status to "error"

---

### Start Endpoint Update

#### [MODIFY] [route.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/app/api/projects/%5Bid%5D/start/route.ts)

Add `jobId` to Inngest event data for tracking:

```typescript
await inngest.send({
  name: "transcription/requested",
  data: {
    projectId: id,
    jobId: job.id,    // NEW
    userId: user.id,
    mediaUrl,
    keyTerms: keyTerms?.map((k) => k.term) || [],
  },
});
```

---

### Environment Configuration

#### [MODIFY] .env.example

```diff
+# Supabase Service Role (for Inngest functions - bypasses RLS)
+SUPABASE_SERVICE_ROLE_KEY=

+# App URL for callbacks (used by Deepgram webhooks)
+NEXT_PUBLIC_APP_URL=http://localhost:3000

+# Optional: Override Deepgram callback URL (for ngrok/tunnels in local dev)
+DEEPGRAM_CALLBACK_URL=

+# Deepgram model (default: nova-3)
+DEEPGRAM_MODEL=nova-3
```

---

## File Summary

| File | Action | Purpose |
|:---|:---|:---|
| `lib/supabase/admin.ts` | NEW | Service role client for Inngest |
| `lib/deepgram.ts` | NEW | Deepgram async API + error classification |
| `lib/inngest/events.ts` | MODIFY | Add jobId to requested event |
| `lib/inngest/functions.ts` | MODIFY | Implement all function logic |
| `app/api/projects/[id]/start/route.ts` | MODIFY | Pass jobId to Inngest event |
| `.env.example` | MODIFY | Add new env vars |

---

## Verification Plan

### Automated Tests

1. **Build Check**
   ```bash
   cd frontend && npm run build
   ```
   Expect: No type errors, successful build

2. **Lint Check**
   ```bash
   cd frontend && npm run lint
   ```
   Expect: No linting errors

### Manual Testing (requires Inngest Dev Server)

1. **Inngest Dev Server**
   ```bash
   npx inngest-cli@latest dev
   ```
   Open http://localhost:8288, verify functions registered

2. **End-to-End Flow (with tunnel for local dev)**
   - Start ngrok: `ngrok http 3000`
   - Set `DEEPGRAM_CALLBACK_URL` to ngrok URL + `/api/webhooks/deepgram`
   - Upload file, start transcription
   - Verify Inngest receives `transcription/requested`
   - Verify Deepgram callback arrives at webhook
   - Verify segments/words stored in Supabase
   - Verify project status becomes "completed"

3. **Error Handling**
   - Test with invalid key terms (>100 terms)
   - Verify error classified as "keyterm" type
   - Verify job/project marked as "error"

---

## Dependencies

- Phase 4 Inngest skeleton must be complete
- Supabase service role key configured
- Deepgram API key configured
- For local testing: ngrok or similar tunnel for webhook callbacks

---

## Risks & Mitigations

| Risk | Mitigation |
|:---|:---|
| Deepgram callback not received | Check tunnel is running; verify `dg-token` header |
| RLS blocks Inngest writes | Use admin client with service role key |
| Signed URL expires before Deepgram processes | 1-hour expiry should be sufficient; Deepgram typically starts within minutes |
| Duplicate webhook callbacks | Idempotent: Clear segments before inserting |

---

## Post-Phase Handoff

For **Phase 6 (Consolidation Pipeline Port)**:
- Segments and words are now stored in Supabase
- Call `consolidate_and_save_chunks` equivalent after webhook processing
- Consolidation runs inside `handleTranscriptionWebhook` function
- TypeScript consolidation already exists at `lib/consolidation.ts`
