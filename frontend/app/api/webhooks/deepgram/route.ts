/**
 * Deepgram Webhook Handler
 *
 * Receives transcription results from Deepgram async API.
 * Validates the dg-token header and forwards to core for processing.
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
import { DeepgramWebhookPayloadSchema } from "@/contracts/webhook";
import { UuidSchema } from "@/contracts/primitives";
import { handleDeepgramWebhook, persistWebhookFailure } from "@/core/transcription/webhook";

// Tell Vercel the maximum execution time — must match RECEIPT_LEASE_MS (Pro/Enterprise only)
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
    const rawPayload = await request.json();
    const payloadParsed = DeepgramWebhookPayloadSchema.safeParse(rawPayload);

    if (!payloadParsed.success) {
      const partialRequestId = typeof rawPayload?.metadata?.request_id === 'string' ? rawPayload.metadata.request_id : undefined;
      const partialProjectId = UuidSchema.safeParse(rawPayload?.metadata?.extra?.project_id).data;
      console.warn("[deepgram-webhook] Malformed payload:", payloadParsed.error.issues[0]?.message ?? "Invalid input");
      const supabase = createAdminClient();
      await persistWebhookFailure({ supabase, projectId: partialProjectId, requestId: partialRequestId, message: 'Malformed Deepgram payload' });
      return NextResponse.json({ error: 'Invalid payload structure' }, { status: 400 });
    }

    const payload = payloadParsed.data;
    const requestId = payload.metadata?.request_id;
    const projectId = payload.metadata?.extra?.project_id;

    console.log("[deepgram-webhook] Step 2 complete:", { requestId, projectId });

    if (!projectId || !requestId) {
      console.warn("[deepgram-webhook] Missing project_id or request_id");
      const supabase = createAdminClient();
      await persistWebhookFailure({ supabase, projectId, requestId, message: "Deepgram webhook missing project_id or request_id." });
      return NextResponse.json({ error: "Missing project_id or request_id" }, { status: 400 });
    }

    // Step 3: Delegate to core
    const supabase = createAdminClient();
    const result = await handleDeepgramWebhook({ supabase, requestId, projectId, payload });

    switch (result.outcome) {
      case 'processed':
        console.log(`[deepgram-webhook] SUCCESS - project: ${projectId}, request: ${requestId}`);
        return NextResponse.json({ received: true });

      case 'duplicate':
        return NextResponse.json({ received: true });

      case 'retrying':
        return NextResponse.json(
          { error: "Webhook already being processed" },
          { status: 503, headers: { "Retry-After": String(result.retryAfter) } }
        );

      case 'error':
        return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
    }
  } catch (error) {
    console.error("[deepgram-webhook] ERROR:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
