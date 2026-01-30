/**
 * Webhook Health Check Endpoint
 *
 * Provides status information about the webhook endpoint and its dependencies.
 * Useful for monitoring and pre-flight checks before relying on the webhook.
 *
 * GET /api/webhooks/deepgram/health
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface HealthStatus {
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: string;
    checks: {
        supabase: {
            connected: boolean;
            latencyMs?: number;
            error?: string;
        };
        environment: {
            deepgramKeyConfigured: boolean;
            inngestConfigured: boolean;
            callbackUrlConfigured: boolean;
        };
    };
}

export async function GET(request: NextRequest) {
    const healthSecret = process.env.WEBHOOK_HEALTHCHECK_SECRET;
    const isProd = process.env.NODE_ENV === "production";

    if (healthSecret) {
        const provided =
            request.headers.get("x-health-token") ||
            request.nextUrl.searchParams.get("token");
        if (!provided || provided !== healthSecret) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
    } else if (isProd) {
        // Hide health endpoint in production unless explicitly enabled with a secret
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const startTime = Date.now();

    // Check Supabase connection
    let supabaseConnected = false;
    let supabaseLatencyMs: number | undefined;
    let supabaseError: string | undefined;

    try {
        const supabase = createAdminClient();
        const queryStart = Date.now();
        const { error } = await supabase.from("projects").select("id").limit(1);
        supabaseLatencyMs = Date.now() - queryStart;

        if (error) {
            supabaseError = error.message;
        } else {
            supabaseConnected = true;
        }
    } catch (e) {
        supabaseError = e instanceof Error ? e.message : "Unknown error";
    }

    // Check environment configuration
    const deepgramKeyConfigured = !!(
        process.env.DEEPGRAM_API_KEY || process.env.DG_API_KEY
    );
    const inngestConfigured = !!(
        process.env.INNGEST_EVENT_KEY || process.env.INNGEST_SIGNING_KEY
    );
    const callbackUrlConfigured = !!process.env.DEEPGRAM_CALLBACK_URL;

    // Determine overall status
    let status: HealthStatus["status"] = "healthy";
    if (!supabaseConnected) {
        status = "unhealthy";
    } else if (!deepgramKeyConfigured || !callbackUrlConfigured) {
        status = "degraded";
    }

    const healthResponse: HealthStatus = {
        status,
        timestamp: new Date().toISOString(),
        checks: {
            supabase: {
                connected: supabaseConnected,
                ...(supabaseLatencyMs !== undefined && { latencyMs: supabaseLatencyMs }),
                ...(supabaseError && { error: supabaseError }),
            },
            environment: {
                deepgramKeyConfigured,
                inngestConfigured,
                callbackUrlConfigured,
            },
        },
    };

    const httpStatus =
        status === "healthy" ? 200 : status === "degraded" ? 200 : 503;

    return NextResponse.json(healthResponse, {
        status: httpStatus,
        headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    });
}
