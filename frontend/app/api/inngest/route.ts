/**
 * Inngest API Route Handler
 * 
 * Serves Inngest functions via Next.js API route.
 * Supports GET (health check), POST (function execution), PUT (sync).
 */

import { serve } from "inngest/next";
import { inngest } from "@/infra/inngest/client";
import {
    handleMediaPrepare,
    handleTranscriptionRequested,
    handleTranscriptionWebhook,
    handleTranscriptionCompleted,
    handleTranscriptionFailed,
    handleTranscriptionTimeouts,
    handleWaveformRequested,
} from "@/lib/inngest/functions";

// Waveform generation streams ffmpeg output for multi-hour files, and media
// preparation converts within one step; allow up to 5min per invocation
// (lib/media/prepare-steps.ts budgets 270s of it).
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        handleMediaPrepare,
        handleTranscriptionRequested,
        handleTranscriptionWebhook,
        handleTranscriptionCompleted,
        handleTranscriptionFailed,
        handleTranscriptionTimeouts,
        handleWaveformRequested,
    ],
});
