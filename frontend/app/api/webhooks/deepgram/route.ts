/**
 * Deepgram Webhook Handler
 *
 * Receives transcription results from Deepgram async API.
 * Validates the dg-token header, stores the result at its exact job attempt's
 * own key and passes it to Inngest (handle-deepgram-callback), which links and
 * hands it off with retries of its own. Nothing here holds a receipt, so a
 * request cut off at any point is simply redone by Deepgram's next retry.
 *
 * LIMITATION: Vercel Node.js functions have a 4.5 MB request body limit.
 * This applies to all plans and cannot be increased. Deepgram payloads for
 * very long recordings (typically 2.5-3+ hours) may exceed this limit,
 * causing a 413 FUNCTION_PAYLOAD_TOO_LARGE error before code executes.
 *
 * Typical payload sizes:
 * - 30-min recording: ~500 KB - 1 MB
 * - 1-hour recording: ~1-2 MB
 * - 2-hour recording: ~3-4 MB
 * - 3+ hour recording: May exceed 4.5 MB limit
 *
 * For enterprise use cases requiring very long recordings, consider hosting
 * this webhook on AWS Lambda (6 MB limit) or Google Cloud Run (32 MB limit).
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createAdminClient } from "@/infra/supabase/admin";
import { DeepgramErrorCallbackSchema, DeepgramWebhookPayloadSchema } from "@/contracts/webhook";
import { UuidSchema } from "@/contracts/primitives";
import { persistWebhookFailure, stageDeepgramResult } from "@/core/transcription/webhook";

// Tell Vercel the maximum execution time: a long recording's result is uploaded
// within the request (Pro/Enterprise only).
export const maxDuration = 300; // seconds

export async function POST(request: NextRequest) {
  console.log("[deepgram-webhook] Received callback request");

  try {
    // Step 1: Verify dg-token header
    const dgToken = request.headers.get("dg-token");
    const expectedToken = process.env.DEEPGRAM_API_KEY_IDENTIFIER;

    console.log("[deepgram-webhook] Step 1: Token validation");

    if (!expectedToken) {
      console.error("[deepgram-webhook] DEEPGRAM_API_KEY_IDENTIFIER not configured");
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    if (!dgToken) {
      console.warn("[deepgram-webhook] No dg-token header received");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (
      dgToken.length !== expectedToken.length ||
      !timingSafeEqual(Buffer.from(dgToken) as any, Buffer.from(expectedToken) as any)
    ) {
      console.warn("[deepgram-webhook] Token mismatch");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[deepgram-webhook] Step 1 complete: Token validated");

    // Step 2: Parse and validate JSON payload
    console.log("[deepgram-webhook] Step 2: Parsing JSON payload");
    // Keep the body as text: it is stored exactly as Deepgram sent it.
    const rawBody = await request.text();
    let rawPayload;
    try {
      rawPayload = JSON.parse(rawBody);
    } catch {
      // A retry cannot fix a body that is not JSON, and it names no job to fail.
      console.warn("[deepgram-webhook] Body is not JSON");
      return NextResponse.json({ error: 'Invalid payload structure' }, { status: 400 });
    }

    // Deepgram reports a transcription it could not do (corrupt or unsupported
    // audio) with only err_code, err_msg and request_id: no metadata, so no
    // transcript_id. The request_id is the job's inngest_event_id.
    const errorCallback = DeepgramErrorCallbackSchema.safeParse(rawPayload);
    if (errorCallback.success) {
      const { request_id: requestId, err_code: errCode, err_msg: errMsg } = errorCallback.data;
      console.warn("[deepgram-webhook] Deepgram could not transcribe:", { requestId, errCode });
      const supabase = createAdminClient();
      const failed = await persistWebhookFailure({
        supabase,
        engine: "deepgram",
        requestId,
        message: `Transcription failed: ${errMsg.slice(0, 200)}`,
        detail: JSON.stringify(errorCallback.data),
      });
      if (failed === 'nothing') {
        // The callback can arrive before the job has stored its request_id, or
        // the write can fail; either way Deepgram retries.
        console.warn("[deepgram-webhook] Could not fail the job for request:", requestId);
        return NextResponse.json(
          { error: "Job not failed yet" },
          { status: 503, headers: { "Retry-After": "30" } }
        );
      }
      return NextResponse.json({ received: true });
    }

    const payloadParsed = DeepgramWebhookPayloadSchema.safeParse(rawPayload);

    if (!payloadParsed.success) {
      const partialRequestId = typeof rawPayload?.metadata?.request_id === 'string' ? rawPayload.metadata.request_id : undefined;
      const partialTranscriptId = UuidSchema.safeParse(rawPayload?.metadata?.extra?.transcript_id).data;
      console.warn("[deepgram-webhook] Malformed payload:", payloadParsed.error.issues[0]?.message ?? "Invalid input");
      const supabase = createAdminClient();
      await persistWebhookFailure({ supabase, engine: "deepgram", transcriptId: partialTranscriptId, requestId: partialRequestId, message: 'Malformed Deepgram payload' });
      return NextResponse.json({ error: 'Invalid payload structure' }, { status: 400 });
    }

    const payload = payloadParsed.data;
    const requestId = payload.metadata?.request_id;
    const extra = payload.metadata?.extra;
    const transcriptId = extra?.transcript_id;
    const jobId = extra?.job_id;
    const userId = extra?.user_id;

    console.log("[deepgram-webhook] Step 2 complete:", { requestId, transcriptId, jobId });

    if (!transcriptId || !requestId || !jobId || !userId) {
      // Every request we start names all four (infra/deepgram): one without
      // them can only be from a job started before they were sent.
      console.warn("[deepgram-webhook] Missing transcript_id, job_id, user_id or request_id");
      const supabase = createAdminClient();
      await persistWebhookFailure({ supabase, engine: "deepgram", transcriptId, requestId, message: "Deepgram webhook missing its transcript, job or request id." });
      return NextResponse.json({ error: "Missing transcript_id, job_id, user_id or request_id" }, { status: 400 });
    }

    // Step 3: Store it for its exact job attempt and pass it on
    const supabase = createAdminClient();
    const outcome = await stageDeepgramResult({ supabase, transcriptId, jobId, requestId, userId, rawBody });

    if (outcome === "not_ready") {
      // The job has not saved this request yet; by Deepgram's next try it has.
      return NextResponse.json(
        { error: "Job not ready for this result yet" },
        { status: 503, headers: { "Retry-After": "30" } }
      );
    }
    console.log(`[deepgram-webhook] ${outcome === "passed_on" ? "Passed on" : "Nothing to do for"} transcript: ${transcriptId}, request: ${requestId}`);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[deepgram-webhook] ERROR:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
