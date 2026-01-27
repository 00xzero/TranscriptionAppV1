/**
 * Deepgram Webhook Handler
 * 
 * Receives transcription results from Deepgram async API.
 * Validates the dg-token header and forwards to Inngest for processing.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
    console.log("[deepgram-webhook] Received callback request");

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

        // Step 2: Parse JSON payload
        console.log("[deepgram-webhook] Step 2: Parsing JSON payload");
        const payload = await request.json();
        console.log("[deepgram-webhook] Step 2 complete: JSON parsed successfully");

        // Step 3: Extract metadata from payload
        // Deepgram returns request_id in metadata object and extra params in metadata.extra
        console.log("[deepgram-webhook] Step 3: Extracting metadata");
        const metadata = payload.metadata;
        const requestId = metadata?.request_id;
        const projectId = metadata?.extra?.project_id;

        console.log("[deepgram-webhook] metadata present:", !!metadata);
        console.log("[deepgram-webhook] request_id:", requestId || "null");
        console.log("[deepgram-webhook] project_id:", projectId || "null");
        console.log("[deepgram-webhook] metadata.extra keys:", metadata?.extra ? Object.keys(metadata.extra) : "null");

        if (!projectId || !requestId) {
            console.warn("[deepgram-webhook] Missing project_id or request_id in webhook payload");
            console.warn("[deepgram-webhook] Full metadata:", JSON.stringify(metadata, null, 2));
            return NextResponse.json(
                { error: "Missing project_id or request_id" },
                { status: 400 }
            );
        }

        console.log("[deepgram-webhook] Step 3 complete: Metadata extracted successfully");

        // Step 4: Persist payload (callback can be large; avoid sending full JSON through Inngest)
        console.log("[deepgram-webhook] Step 4: Persisting payload to Supabase");
        const supabase = createAdminClient();

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

        console.log(
            `[deepgram-webhook] SUCCESS - project: ${projectId}, request: ${requestId}`
        );

        return NextResponse.json({ received: true });
    } catch (error) {
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
