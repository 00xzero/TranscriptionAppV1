/**
 * Deepgram Webhook Handler
 *
 * Receives transcription results from Deepgram async API.
 * Validates the dg-token header and forwards to Inngest for processing.
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
import { timingSafeEqual, randomUUID } from "crypto";
import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { forceJobError } from "@/lib/supabase/transition";
import { z } from "zod";
import { DeepgramWebhookPayloadSchema } from "@/lib/schemas/webhook";

// Tell Vercel the maximum execution time — must match RECEIPT_LEASE_MS (Pro/Enterprise only)
export const maxDuration = 300; // seconds

// 5 min — matches Vercel Pro/Enterprise max function duration
const RECEIPT_LEASE_MS = maxDuration * 1000;

async function persistWebhookFailure(params: {
  projectId?: string | null;
  requestId?: string | null;
  message: string;
}) {
  const supabase = createAdminClient();
  let resolvedProjectId = params.projectId || null;
  let resolvedJobId: string | null = null;

  if (!resolvedProjectId && params.requestId) {
    const { data: jobByRequest } = await supabase
      .from("jobs")
      .select("id, project_id")
      .eq("inngest_event_id", params.requestId)
      .maybeSingle();
    if (jobByRequest) {
      resolvedProjectId = jobByRequest.project_id;
      resolvedJobId = jobByRequest.id;
    }
  }

  if (resolvedProjectId && !resolvedJobId) {
    const { data: fallbackJob } = await supabase
      .from("jobs")
      .select("id")
      .eq("project_id", resolvedProjectId)
      .in("status", ["queued", "processing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fallbackJob) {
      resolvedJobId = fallbackJob.id;
    }
  }

  const payload = {
    error: params.message,
    error_type: "transcription_error",
    raw_error: params.message.slice(0, 500),
  };

  if (resolvedJobId) {
    // forceJobError transitions job to error; project status derived by trigger
    await forceJobError({
      supabase,
      jobId: resolvedJobId,
      extraJobFields: {
        finished_at: new Date().toISOString(),
        payload,
      },
      context: "persistWebhookFailure",
    });
  } else if (resolvedProjectId) {
    // No job found — record in failed_events for investigation.
    // NOTE: This branch writes projects.status = 'error' directly, bypassing
    // the Postgres trigger (no job to fire on). Left as-is; tracked as follow-up.
    const { error: insertError } = await supabase
      .from("failed_events")
      .insert({
        event_name: "deepgram/webhook_failure",
        event_data: { projectId: resolvedProjectId, requestId: params.requestId },
        error_message: params.message,
        project_id: resolvedProjectId,
      });
    if (insertError) {
      console.error("[deepgram-webhook] Failed to insert failed_event:", insertError);
    }

    const { error: projectError } = await supabase
      .from("projects")
      .update({ status: "error" })
      .eq("id", resolvedProjectId);
    if (projectError) {
      console.error("[deepgram-webhook] Failed to update project error status:", projectError);
    }
  }
}

export async function POST(request: NextRequest) {
  console.log("[deepgram-webhook] Received callback request");

  let requestId: string | undefined;
  let projectId: string | undefined;
  let myAttemptId: string | undefined;

  try {
    // Step 1: Verify dg-token header matches our API Key Identifier
    // This is Deepgram's official authentication method for webhooks
    const dgToken = request.headers.get("dg-token");
    const expectedToken = process.env.DEEPGRAM_API_KEY_IDENTIFIER;

    console.log("[deepgram-webhook] Step 1: Token validation");
    console.log("[deepgram-webhook] dg-token present:", !!dgToken, "length:", dgToken?.length || 0);
    console.log("[deepgram-webhook] expectedToken present:", !!expectedToken);

    if (!expectedToken) {
      console.error("[deepgram-webhook] DEEPGRAM_API_KEY_IDENTIFIER not configured");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    if (!dgToken) {
      console.warn("[deepgram-webhook] No dg-token header received");
      return NextResponse.json({ error: "Unauthorized - no token" }, { status: 401 });
    }

    if (dgToken.length !== expectedToken.length) {
      console.warn(
        `[deepgram-webhook] Token length mismatch: received ${dgToken.length}, expected ${expectedToken.length}`
      );
      return NextResponse.json({ error: "Unauthorized - length mismatch" }, { status: 401 });
    }

    const source = Buffer.from(dgToken);
    const target = Buffer.from(expectedToken);

    if (!timingSafeEqual(source as any, target as any)) {
      console.warn("[deepgram-webhook] Token value mismatch (timingSafeEqual failed)");
      return NextResponse.json({ error: "Unauthorized - invalid token" }, { status: 401 });
    }

    console.log("[deepgram-webhook] Step 1 complete: Token validated successfully");

    // Step 2: Parse and validate JSON payload
    console.log("[deepgram-webhook] Step 2: Parsing JSON payload");
    const rawPayload = await request.json();
    const payloadParsed = DeepgramWebhookPayloadSchema.safeParse(rawPayload);
    if (!payloadParsed.success) {
      // Best-effort: extract identifiers from the raw payload so persistWebhookFailure
      // can fail the owning job immediately rather than waiting for the timeout sweeper.
      // project_id must be a valid UUID before being passed to UUID-backed DB queries.
      const partialRequestId = typeof rawPayload?.metadata?.request_id === 'string' ? rawPayload.metadata.request_id : undefined;
      const partialProjectId = z.string().uuid().safeParse(rawPayload?.metadata?.extra?.project_id).data;
      console.warn("[deepgram-webhook] Malformed payload structure:", payloadParsed.error.issues[0]?.message);
      await persistWebhookFailure({ projectId: partialProjectId, requestId: partialRequestId, message: 'Malformed Deepgram payload' });
      return NextResponse.json({ error: 'Invalid payload structure' }, { status: 400 });
    }
    const payload = payloadParsed.data;
    console.log("[deepgram-webhook] Step 2 complete: JSON parsed and validated successfully");

    // Step 3: Extract metadata from payload
    // Deepgram returns request_id in metadata object and extra params in metadata.extra
    console.log("[deepgram-webhook] Step 3: Extracting metadata");
    const metadata = payload.metadata;
    requestId = metadata?.request_id;
    projectId = metadata?.extra?.project_id;

    console.log("[deepgram-webhook] metadata present:", !!metadata);
    console.log("[deepgram-webhook] request_id:", requestId || "null");
    console.log("[deepgram-webhook] project_id:", projectId || "null");
    console.log("[deepgram-webhook] metadata.extra keys:", metadata?.extra ? Object.keys(metadata.extra) : "null");

    if (!projectId || !requestId) {
      console.warn("[deepgram-webhook] Missing project_id or request_id in webhook payload");
      console.warn("[deepgram-webhook] Full metadata:", JSON.stringify(metadata, null, 2));
      await persistWebhookFailure({
        projectId,
        requestId,
        message: "Deepgram webhook missing project_id or request_id.",
      });
      return NextResponse.json(
        { error: "Missing project_id or request_id" },
        { status: 400 }
      );
    }

    console.log("[deepgram-webhook] Step 3 complete: Metadata extracted successfully");

    const supabase = createAdminClient();

    // Step 3.5: Idempotency check — claim, recover, or short-circuit
    console.log("[deepgram-webhook] Step 3.5: Idempotency check");
    myAttemptId = randomUUID();

    const { error: claimError } = await supabase
      .from("webhook_receipts")
      .insert({
        provider: "deepgram",
        request_id: requestId,
        project_id: projectId,
        attempt_id: myAttemptId,
        claimed_at: new Date().toISOString(),
      });

    if (claimError) {
      if (claimError.code === "23505") {
        // Receipt exists — read current state
        const { data: existing, error: selectError } = await supabase
          .from("webhook_receipts")
          .select("status, attempt_id, claimed_at")
          .eq("provider", "deepgram")
          .eq("request_id", requestId)
          .single();

        if (selectError || !existing) {
          // Can't determine state — don't proceed without ownership
          console.error("[deepgram-webhook] Failed to read existing receipt:", selectError);
          return NextResponse.json({ error: "Receipt state unavailable" }, { status: 500 });
        }

        if (existing.status === "completed") {
          console.log(`[deepgram-webhook] Duplicate (completed) for ${requestId} — 200 no-op`);
          return NextResponse.json({ received: true });
        }

        const isFresh = Date.now() - new Date(existing.claimed_at).getTime() < RECEIPT_LEASE_MS;

        if (existing.status === "processing" && isFresh) {
          // Owner is still running — don't ack success yet; let Deepgram retry later
          console.log(`[deepgram-webhook] In-flight duplicate for ${requestId} — returning 503`);
          return NextResponse.json(
            { error: "Webhook already being processed" },
            { status: 503, headers: { "Retry-After": "30" } }
          );
        }

        // Failed or stale processing — attempt conditional takeover
        const newAttemptId = randomUUID();
        const { data: takeoverRows, error: takeoverError } = await supabase
          .from("webhook_receipts")
          .update({
            status: "processing",
            attempt_id: newAttemptId,
            claimed_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("provider", "deepgram")
          .eq("request_id", requestId)
          .eq("attempt_id", existing.attempt_id)  // optimistic lock
          .neq("status", "completed")              // never overwrite completed
          .select("id");

        if (takeoverError) {
          console.error("[deepgram-webhook] Takeover update failed:", takeoverError);
          return NextResponse.json({ error: "Takeover failed" }, { status: 500 });
        }

        if (!takeoverRows || takeoverRows.length === 0) {
          // 0 rows updated: could be a race loss, or the winner already completed.
          // Re-read once before forcing a Deepgram retry.
          const { data: reread } = await supabase
            .from("webhook_receipts")
            .select("status")
            .eq("provider", "deepgram")
            .eq("request_id", requestId)
            .single();

          if (reread?.status === "completed") {
            console.log(`[deepgram-webhook] Post-takeover read shows completed for ${requestId} — 200 no-op`);
            return NextResponse.json({ received: true });
          }

          console.log(`[deepgram-webhook] Lost takeover race for ${requestId} — returning 503`);
          return NextResponse.json(
            { error: "Takeover race lost" },
            { status: 503, headers: { "Retry-After": "30" } }
          );
        }

        myAttemptId = newAttemptId;
        console.log(`[deepgram-webhook] Takeover successful for ${requestId}`);
      } else {
        // Non-conflict DB error (e.g. connection failure). Fail closed: without a
        // receipt we have no idempotency guarantee, so tell Deepgram to retry later.
        console.error("[deepgram-webhook] Failed to claim webhook receipt (non-conflict):", claimError);
        return NextResponse.json(
          { error: "Receipt unavailable, please retry" },
          { status: 503, headers: { "Retry-After": "30" } }
        );
      }
    }

    console.log("[deepgram-webhook] Step 3.5 complete");

    // Step 4: Persist payload (callback can be large; avoid sending full JSON through Inngest)
    console.log("[deepgram-webhook] Step 4: Persisting payload to Supabase");

    const { data: exactJob, error: exactJobError } = await supabase
      .from("jobs")
      .select("id")
      .eq("project_id", projectId)
      .eq("inngest_event_id", requestId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (exactJobError) {
      console.error("[deepgram-webhook] Failed to lookup job by requestId:", exactJobError);
      throw new Error(`Failed to lookup job by requestId: ${exactJobError.message}`);
    }

    let jobIdToUpdate = exactJob?.id;

    if (!jobIdToUpdate) {
      const { data: fallbackJob, error: fallbackJobError } = await supabase
        .from("jobs")
        .select("id")
        .eq("project_id", projectId)
        .in("status", ["queued", "processing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fallbackJobError) {
        console.error("[deepgram-webhook] Failed to lookup fallback job:", fallbackJobError);
        throw new Error(`Failed to lookup fallback job: ${fallbackJobError.message}`);
      }

      jobIdToUpdate = fallbackJob?.id;
    }

    if (!jobIdToUpdate) {
      console.error("[deepgram-webhook] No job found to persist payload", {
        projectId,
        requestId,
      });
      await persistWebhookFailure({
        projectId,
        requestId,
        message: "Deepgram webhook received but job was not found.",
      });
      throw new Error("Job not found for Deepgram webhook");
    }

    const { error: updateError } = await supabase
      .from("jobs")
      .update({
        payload: { deepgram: payload },
        inngest_event_id: requestId,
      })
      .eq("id", jobIdToUpdate);

    if (updateError) {
      console.error("[deepgram-webhook] Failed to persist webhook payload:", updateError);
      throw new Error(`Failed to persist webhook payload: ${updateError.message}`);
    }

    console.log("[deepgram-webhook] Step 4 complete: Payload persisted successfully");

    // Step 5: Forward to Inngest for durable processing (small payload only)
    console.log("[deepgram-webhook] Step 5: Sending to Inngest");
    await inngest.send({
      name: "transcription/webhook",
      data: {
        requestId,
        projectId,
      },
    });
    console.log("[deepgram-webhook] Step 5 complete: Event sent to Inngest");

    // Finalize receipt — scoped by attempt_id
    if (myAttemptId) {
      const { error: finalizeError } = await supabase
        .from("webhook_receipts")
        .update({ status: "completed", processed_at: new Date().toISOString() })
        .eq("provider", "deepgram")
        .eq("request_id", requestId)
        .eq("attempt_id", myAttemptId);

      if (finalizeError) {
        // Real work is done — don't mark the receipt 'failed'. Doing so would
        // invite immediate reprocessing and risk overwriting post-completion data.
        // Leave it in 'processing'; the lease expiry handles stale recovery, and
        // any retry that takes over will find the job already complete.
        console.error("[deepgram-webhook] Finalize failed; receipt left as processing (will expire):", finalizeError);
      }
    }

    console.log(
      `[deepgram-webhook] SUCCESS - project: ${projectId}, request: ${requestId}`
    );

    return NextResponse.json({ received: true });
  } catch (error) {
    if (myAttemptId && requestId) {
      try {
        const adminClient = createAdminClient();
        await adminClient
          .from("webhook_receipts")
          .update({
            status: "failed",
            last_error: error instanceof Error ? error.message.slice(0, 500) : String(error),
          })
          .eq("provider", "deepgram")
          .eq("request_id", requestId)
          .eq("attempt_id", myAttemptId);
      } catch {
        // Don't let receipt cleanup mask the original error
      }
    }
    console.error("[deepgram-webhook] ERROR:", error);
    console.error("[deepgram-webhook] Error type:", typeof error);
    console.error("[deepgram-webhook] Error message:", error instanceof Error ? error.message : String(error));
    console.error("[deepgram-webhook] Error stack:", error instanceof Error ? error.stack : "no stack");
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
