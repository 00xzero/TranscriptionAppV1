/**
 * Inngest API Route Handler
 * 
 * Serves Inngest functions via Next.js API route.
 * Supports GET (health check), POST (function execution), PUT (sync).
 */

import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
    handleTranscriptionRequested,
    handleTranscriptionWebhook,
    handleTranscriptionCompleted,
    handleTranscriptionFailed,
    handleTranscriptionTimeouts,
} from "@/lib/inngest/functions";

export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        handleTranscriptionRequested,
        handleTranscriptionWebhook,
        handleTranscriptionCompleted,
        handleTranscriptionFailed,
        handleTranscriptionTimeouts,
    ],
});
