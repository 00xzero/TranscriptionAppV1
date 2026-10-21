/**
 * Soniox Webhook Handler
 *
 * Soniox calls back with only the job's id and status, and the callback URL
 * names the exact job attempt (transcript_id, job_id). This route checks the
 * secret and passes the callback to Inngest (handle-soniox-callback), which
 * fetches, stores and cleans up with retries of its own. It does no Storage or
 * database work, so it answers Soniox quickly.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { SonioxCallbackSchema } from "@/contracts/soniox";
import { UuidSchema } from "@/contracts/primitives";
import { sendInngestEvent } from "@/infra/inngest/client";
import { SONIOX_WEBHOOK_AUTH_HEADER } from "@/infra/soniox";

function secretMatches(received: string | null, secret: string): boolean {
  if (!received) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(received);
  return actual.length === expected.length && timingSafeEqual(actual as Uint8Array, expected as Uint8Array);
}

export async function POST(request: NextRequest) {
  const secret = process.env.SONIOX_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[soniox-webhook] SONIOX_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  if (!secretMatches(request.headers.get(SONIOX_WEBHOOK_AUTH_HEADER), secret)) {
    console.warn("[soniox-webhook] Missing or wrong secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A body or address that is wrong now is wrong on every retry.
  const params = request.nextUrl.searchParams;
  const transcriptId = UuidSchema.safeParse(params.get("transcript_id"));
  const jobId = UuidSchema.safeParse(params.get("job_id"));
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid payload structure" }, { status: 400 });
  }
  const callback = SonioxCallbackSchema.safeParse(body);
  if (!transcriptId.success || !jobId.success || !callback.success) {
    console.warn("[soniox-webhook] Malformed callback", {
      transcriptId: transcriptId.success,
      jobId: jobId.success,
      body: callback.success,
    });
    return NextResponse.json({ error: "Invalid payload structure" }, { status: 400 });
  }

  const { id: requestId, status } = callback.data;
  try {
    await sendInngestEvent({
      name: "soniox/callback",
      // A redelivery of the same callback becomes the same event.
      id: `soniox-callback:${requestId}:${status}`,
      data: { transcriptId: transcriptId.data, jobId: jobId.data, requestId, status },
    });
  } catch (error) {
    // Soniox retries a callback that is not acknowledged.
    console.error("[soniox-webhook] Failed to pass the callback on:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }

  console.log(`[soniox-webhook] ${status} for job ${jobId.data}, request ${requestId}`);
  return NextResponse.json({ received: true });
}
