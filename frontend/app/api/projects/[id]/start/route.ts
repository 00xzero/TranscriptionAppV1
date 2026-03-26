/**
 * Start Transcription Endpoint
 *
 * Triggers a new transcription job for a project.
 * Auth, param extraction, and HTTP mapping only — business logic in core.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/infra/supabase/server";
import { startTranscription } from "@/core/transcription/start";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const supabase = await createClient();

    // Verify authentication
    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const idempotencyKey = request.headers.get("x-idempotency-key");

    const result = await startTranscription({
        supabase,
        projectId: id,
        userId: user.id,
        idempotencyKey,
    });

    switch (result.outcome) {
        case 'started':
            console.log(`Transcription started for project: ${id}, job: ${result.jobId}`);
            return NextResponse.json({ message: "Transcription started", jobId: result.jobId });

        case 'cached':
            return NextResponse.json({ message: "Transcription started", jobId: result.jobId, cached: true });

        case 'conflict':
            return NextResponse.json({ error: "Transcription already in progress" }, { status: 409 });

        case 'rate_limited':
            return NextResponse.json(
                {
                    error: "Rate limit exceeded. Please try again later.",
                    limit: result.limit,
                    current: result.current,
                    retryAfterSeconds: result.retryAfterSeconds,
                },
                {
                    status: 429,
                    headers: { "Retry-After": String(result.retryAfterSeconds) },
                }
            );

        case 'invalid':
            if (result.reason === 'Project not found') {
                return NextResponse.json({ error: result.reason }, { status: 404 });
            }
            if (result.reason.includes('Previous transcription attempt failed')) {
                return NextResponse.json(
                    { error: result.reason, jobId: result.jobId, status: result.jobStatus },
                    { status: 409 }
                );
            }
            return NextResponse.json({ error: result.reason }, { status: 400 });

        case 'error':
            return NextResponse.json({ error: result.reason }, { status: 500 });
    }
}
