# Phase 4: Inngest Setup and Webhook Handler

Set up Inngest for background job processing to replace the legacy Celery/Redis worker. This phase creates the foundation for async transcription processing in Phase 5.

---

## User Review Required

> [!IMPORTANT]
> **Inngest Account Required**: You'll need to provide your Inngest Event Key and Signing Key (from Inngest Dashboard → Manage → API Keys). For local dev, the Inngest Dev Server runs in-memory without keys.

> [!NOTE]
> **Deepgram API Key Identifier**: For webhook security, we'll use Deepgram's `dg-token` header verification. You'll need to store your API Key Identifier (found in Deepgram Console → API Keys) in `DEEPGRAM_API_KEY_IDENTIFIER`.

---

## Proposed Changes

### Inngest Core Setup

#### [NEW] [client.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/lib/inngest/client.ts)

Create the Inngest client instance with typed events.

```typescript
import { Inngest, EventSchemas } from "inngest";
import type { TranscriptionEvents } from "./events";

export const inngest = new Inngest({ 
  id: "transcription-app",
  schemas: new EventSchemas().fromRecord<TranscriptionEvents>(),
});
```

---

#### [NEW] [events.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/lib/inngest/events.ts)

TypeScript types for all transcription lifecycle events.

```typescript
export type TranscriptionEvents = {
  "transcription/requested": {
    data: {
      projectId: string;
      userId: string;
      mediaUrl: string;
      keyTerms?: string[];
    };
  };
  "transcription/webhook": {
    data: {
      requestId: string;
      projectId: string;
      result: unknown;
    };
  };
  "transcription/completed": {
    data: {
      projectId: string;
      jobId: string;
      duration: number;
    };
  };
  "transcription/failed": {
    data: {
      projectId: string;
      jobId: string;
      error: string;
      errorType: "keyterm" | "general";
    };
  };
};
```

---

#### [NEW] [functions.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/lib/inngest/functions.ts)

Skeleton functions with **account-scoped concurrency** (configurable via env var).

```typescript
import { inngest } from "./client";

const DEEPGRAM_CONCURRENCY = parseInt(
  process.env.DEEPGRAM_CONCURRENCY_LIMIT || "5",
  10
);

export const handleTranscriptionRequested = inngest.createFunction(
  { 
    id: "handle-transcription-requested",
    concurrency: {
      scope: "account",
      key: '"deepgram"', // Shared queue for Deepgram API calls
      limit: DEEPGRAM_CONCURRENCY,
    },
    retries: 2,
  },
  { event: "transcription/requested" },
  async ({ event, step }) => {
    // Phase 5: Call Deepgram async API
    // Phase 5: Store request_id in jobs table
    return { status: "skeleton", projectId: event.data.projectId };
  }
);

export const handleTranscriptionWebhook = inngest.createFunction(
  { id: "handle-transcription-webhook", retries: 3 },
  { event: "transcription/webhook" },
  async ({ event, step }) => {
    // Phase 5: Parse Deepgram utterances/words
    // Phase 6: Trigger consolidation pipeline
    return { status: "skeleton", requestId: event.data.requestId };
  }
);

export const handleTranscriptionCompleted = inngest.createFunction(
  { id: "handle-transcription-completed" },
  { event: "transcription/completed" },
  async ({ event }) => {
    return { status: "skeleton", projectId: event.data.projectId };
  }
);

export const handleTranscriptionFailed = inngest.createFunction(
  { id: "handle-transcription-failed" },
  { event: "transcription/failed" },
  async ({ event }) => {
    return { status: "skeleton", error: event.data.error };
  }
);
```

---

#### [NEW] [route.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/app/api/inngest/route.ts)

Next.js API route that serves Inngest functions.

```typescript
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  handleTranscriptionRequested,
  handleTranscriptionWebhook,
  handleTranscriptionCompleted,
  handleTranscriptionFailed,
} from "@/lib/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    handleTranscriptionRequested,
    handleTranscriptionWebhook,
    handleTranscriptionCompleted,
    handleTranscriptionFailed,
  ],
});
```

---

### Deepgram Webhook Handler (with dg-token verification)

#### [NEW] [route.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/app/api/webhooks/deepgram/route.ts)

Webhook endpoint with **Deepgram's official `dg-token` header verification**.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";

export async function POST(request: NextRequest) {
  try {
    // Verify dg-token header matches our API Key Identifier
    const dgToken = request.headers.get("dg-token");
    const expectedToken = process.env.DEEPGRAM_API_KEY_IDENTIFIER;
    
    if (!expectedToken) {
      console.error("DEEPGRAM_API_KEY_IDENTIFIER not configured");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }
    
    if (dgToken !== expectedToken) {
      console.warn("Invalid dg-token received:", dgToken?.substring(0, 8));
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const payload = await request.json();
    const requestId = payload.request_id;
    const projectId = payload.metadata?.project_id;
    
    if (!projectId || !requestId) {
      return NextResponse.json(
        { error: "Missing project_id or request_id" },
        { status: 400 }
      );
    }

    await inngest.send({
      name: "transcription/webhook",
      data: { requestId, projectId, result: payload },
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Deepgram webhook error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
```

---

### Transcription Start Endpoint

#### [NEW] [route.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/app/api/projects/[id]/start/route.ts)

API endpoint to trigger transcription for a project.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { getSignedMediaUrl } from "@/lib/supabase/storage";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, source_object_key, status")
    .eq("id", id)
    .single();

  if (projectError || !project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (!project.source_object_key) {
    return NextResponse.json({ error: "No media file uploaded" }, { status: 400 });
  }

  const { data: keyTerms } = await supabase
    .from("watchlist")
    .select("term")
    .eq("project_id", id);

  const signedUrl = await getSignedMediaUrl(supabase, project.source_object_key);

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({ project_id: id, status: "queued", job_type: "transcription" })
    .select()
    .single();

  if (jobError) {
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }

  await supabase.from("projects").update({ status: "processing" }).eq("id", id);

  await inngest.send({
    name: "transcription/requested",
    data: {
      projectId: id,
      userId: user.id,
      mediaUrl: signedUrl,
      keyTerms: keyTerms?.map((k) => k.term) || [],
    },
  });

  return NextResponse.json({ message: "Transcription started", jobId: job.id });
}
```

---

### Configuration Updates

#### [MODIFY] [.env.example](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/.env.example)

```diff
+# Inngest Configuration
+# For local dev: leave empty (uses Inngest Dev Server)
+# For production: get from Inngest Dashboard → Manage → API Keys
+INNGEST_EVENT_KEY=
+INNGEST_SIGNING_KEY=

+# Deepgram Configuration
+# API Key for transcription (used in Phase 5)
+DEEPGRAM_API_KEY=
+# API Key Identifier for webhook verification (found in Deepgram Console → API Keys)
+DEEPGRAM_API_KEY_IDENTIFIER=
+# Concurrency limit for Deepgram API calls (default: 5)
+DEEPGRAM_CONCURRENCY_LIMIT=5
```

---

## Verification Plan

### Automated Tests
```bash
cd frontend && npm run build  # Verify no TypeScript errors
cd frontend && npm run lint   # Verify no linting errors
```

### Manual Verification

1. **Inngest Dev Server Integration**
   - Start Next.js: `cd frontend && npm run dev`
   - Start Inngest Dev Server: `npx inngest-cli@latest dev`
   - Open <http://localhost:8288> in your browser
   - Verify "transcription-app" appears with 4 functions

2. **Test Event Trigger (Inngest Dev UI)**
   - Send `transcription/requested` event with test payload
   - Verify function executes and returns skeleton response

3. **Webhook Security Test**
   ```bash
   # Without dg-token (should fail with 401)
   curl -X POST http://localhost:3000/api/webhooks/deepgram \
     -H "Content-Type: application/json" \
     -d '{"request_id": "test", "metadata": {"project_id": "test"}}'
   
   # With valid dg-token (set DEEPGRAM_API_KEY_IDENTIFIER first)
   curl -X POST http://localhost:3000/api/webhooks/deepgram \
     -H "Content-Type: application/json" \
     -H "dg-token: YOUR_API_KEY_IDENTIFIER" \
     -d '{"request_id": "test", "metadata": {"project_id": "test"}}'
   ```

4. **Start Endpoint Test** (requires auth + uploaded project)
   - Log in, upload a file, then POST to `/api/projects/{id}/start`
   - Verify Inngest Dev UI shows `transcription/requested` event
