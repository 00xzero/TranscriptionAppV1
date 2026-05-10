/**
 * Inngest API Route Handler
 * 
 * Serves Inngest functions via Next.js API route.
 * Supports GET (health check), POST (function execution), PUT (sync).
 */

import { serve } from "inngest/next";
import { inngest } from "@/infra/inngest/client";
import {
    handleTranscriptionRequested,
    handleTranscriptionWebhook,
    handleTranscriptionCompleted,
    handleTranscriptionFailed,
    handleTranscriptionTimeouts,
    handleWaveformRequested,
} from "@/lib/inngest/functions";

// Waveform generation streams ffmpeg output for multi-hour files; allow up to 5min
// per invocation. Vercel Pro/Enterprise plans honor this; Hobby is capped lower.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        handleTranscriptionRequested,
        handleTranscriptionWebhook,
        handleTranscriptionCompleted,
        handleTranscriptionFailed,
        handleTranscriptionTimeouts,
        handleWaveformRequested,
    ],
});
