/**
 * Deepgram Webhook Handler
 * 
 * Receives transcription results from Deepgram async API.
 * Validates the dg-token header and forwards to Inngest for processing.
 */

import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";

export async function POST(request: NextRequest) {
    try {
        // Verify dg-token header matches our API Key Identifier
        // This is Deepgram's official authentication method for webhooks
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
            console.warn(
                "Invalid dg-token received:",
                dgToken?.substring(0, 8) + "..."
            );
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const payload = await request.json();
        const requestId = payload.request_id;

        // Extract project ID from metadata (set when calling Deepgram in Phase 5)
        const projectId = payload.metadata?.project_id;

        if (!projectId || !requestId) {
            console.warn("Missing project_id or request_id in webhook payload");
            return NextResponse.json(
                { error: "Missing project_id or request_id" },
                { status: 400 }
            );
        }

        // Forward to Inngest for durable processing
        await inngest.send({
            name: "transcription/webhook",
            data: {
                requestId,
                projectId,
                result: payload,
            },
        });

        console.log(
            `Deepgram webhook received for project: ${projectId}, request: ${requestId}`
        );

        return NextResponse.json({ received: true });
    } catch (error) {
        console.error("Deepgram webhook error:", error);
        return NextResponse.json(
            { error: "Webhook processing failed" },
            { status: 500 }
        );
    }
}
