/**
 * Start Transcription Endpoint
 * 
 * Triggers a new transcription job for a project.
 * Creates job record, updates project status, and sends Inngest event.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { getSignedMediaUrl } from "@/lib/supabase/storage";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

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

    // Rate limiting: prevent abuse (10 transcriptions per hour per user)
    const rateLimitMode =
        process.env.RATE_LIMIT_MODE ||
        (process.env.NODE_ENV === "production" ? "off" : "memory");
    if (rateLimitMode !== "off") {
        const rateResult = checkRateLimit(
            `transcription:${user.id}`,
            RATE_LIMITS.TRANSCRIPTION_START
        );
        if (!rateResult.allowed) {
            const retryAfterSeconds = Math.ceil(rateResult.resetInMs / 1000);
            return NextResponse.json(
                {
                    error: "Rate limit exceeded. Please try again later.",
                    limit: rateResult.limit,
                    current: rateResult.current,
                    retryAfterSeconds,
                },
                {
                    status: 429,
                    headers: {
                        "Retry-After": String(retryAfterSeconds),
                    },
                }
            );
        }
    }

    // Fetch project (RLS ensures ownership)
    const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id, source_object_key, status")
        .eq("id", id)
        .single();

    if (projectError || !project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Validate project has media uploaded
    if (!project.source_object_key) {
        return NextResponse.json(
            { error: "No media file uploaded" },
            { status: 400 }
        );
    }

    // Idempotency: Check for duplicate requests using client-provided key
    const idempotencyKey = request.headers.get("x-idempotency-key");
    if (idempotencyKey) {
        const { data: existingJob, error: lookupError } = await supabase
            .from("jobs")
            .select("id, status")
            .eq("project_id", id)
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();

        if (lookupError) {
            console.error("Failed to check idempotency key:", lookupError);
            // Continue rather than fail - better to create duplicate than block user
        } else if (existingJob) {
            if (["queued", "processing", "completed"].includes(existingJob.status)) {
                console.log(`[start] Returning cached job ${existingJob.id} for idempotency key`);
                return NextResponse.json({
                    message: "Transcription started",
                    jobId: existingJob.id,
                    cached: true,
                });
            }

            if (["error", "failed"].includes(existingJob.status)) {
                return NextResponse.json(
                    {
                        error: "Previous transcription attempt failed. Please retry with a new idempotency key.",
                        jobId: existingJob.id,
                        status: existingJob.status,
                    },
                    { status: 409 }
                );
            }
        }
    }

    // Check if project is already queued or processing
    if (project.status === "processing" || project.status === "queued") {
        return NextResponse.json(
            { error: "Transcription already in progress" },
            { status: 409 }
        );
    }

    // Get key terms for the project
    const { data: keyTerms } = await supabase
        .from("watchlist")
        .select("term")
        .eq("project_id", id);

    // Generate signed URL for Deepgram access (1 hour expiry)
    const signedUrlResult = await getSignedMediaUrl(
        supabase,
        project.source_object_key
    );

    if (signedUrlResult.error || !signedUrlResult.url) {
        console.error("Failed to generate signed URL:", signedUrlResult.error);
        return NextResponse.json(
            { error: "Failed to generate media URL" },
            { status: 500 }
        );
    }

    let mediaUrl = signedUrlResult.url;

    // For local dev with single ngrok tunnel: Use media proxy endpoint
    // This allows Deepgram to access local media through the same ngrok tunnel as callbacks
    if (process.env.DEEPGRAM_USE_PROXY === "true") {
        const callbackBase = process.env.DEEPGRAM_CALLBACK_URL?.replace("/api/webhooks/deepgram", "")
            || process.env.NEXT_PUBLIC_APP_URL
            || "http://localhost:3000";
        // Use media proxy endpoint with the storage path and auth token
        const proxySecret = process.env.MEDIA_PROXY_SECRET;
        if (!proxySecret) {
            console.error("[start] MEDIA_PROXY_SECRET is required when DEEPGRAM_USE_PROXY=true");
            return NextResponse.json(
                { error: "Media proxy misconfigured: missing MEDIA_PROXY_SECRET" },
                { status: 500 }
            );
        }
        mediaUrl = `${callbackBase}/api/media-proxy?path=${encodeURIComponent(project.source_object_key)}&token=${encodeURIComponent(proxySecret)}`;
        console.log(`[start] Using media proxy for Deepgram (path: ${project.source_object_key})`);
    }
    // Alternative: If DEEPGRAM_STORAGE_URL is set, replace the base URL
    else if (process.env.DEEPGRAM_STORAGE_URL) {
        const localStoragePrefix = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (localStoragePrefix && mediaUrl.includes(localStoragePrefix)) {
            mediaUrl = mediaUrl.replace(localStoragePrefix, process.env.DEEPGRAM_STORAGE_URL);
            console.log(`[start] Replaced media URL base for Deepgram: ${process.env.DEEPGRAM_STORAGE_URL}`);
        }
    }

    // Create job record
    const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
            project_id: id,
            status: "queued",
            type: "transcription",
            ...(idempotencyKey && { idempotency_key: idempotencyKey }),
        })
        .select()
        .single();

    if (jobError) {
        // Handle race where another request already created this idempotent job
        if (idempotencyKey) {
            const { data: existingJob } = await supabase
                .from("jobs")
                .select("id, status")
                .eq("project_id", id)
                .eq("idempotency_key", idempotencyKey)
                .maybeSingle();
            if (existingJob) {
                if (["queued", "processing", "completed"].includes(existingJob.status)) {
                    return NextResponse.json({
                        message: "Transcription started",
                        jobId: existingJob.id,
                        cached: true,
                    });
                }

                if (["error", "failed"].includes(existingJob.status)) {
                    return NextResponse.json(
                        {
                            error: "Previous transcription attempt failed. Please retry with a new idempotency key.",
                            jobId: existingJob.id,
                            status: existingJob.status,
                        },
                        { status: 409 }
                    );
                }
            }
        }

        console.error("Failed to create job:", jobError);
        return NextResponse.json(
            { error: "Failed to create job" },
            { status: 500 }
        );
    }

    // Update project status to queued (processing starts after Deepgram accepts)
    const { error: updateError } = await supabase
        .from("projects")
        .update({ status: "queued" })
        .eq("id", id);

    if (updateError) {
        console.error("Failed to update project status:", updateError);
        // Rollback: mark job as error so the UI can surface a message
        const errorPayload = {
            error: "Failed to queue transcription. Please try again.",
            error_type: "transcription_error",
            raw_error: updateError.message,
        };
        const { error: jobUpdateError } = await supabase
            .from("jobs")
            .update({ status: "error", payload: errorPayload })
            .eq("id", job.id);
        if (jobUpdateError) {
            console.error("Failed to mark job as error after queue failure:", jobUpdateError);
        }
        return NextResponse.json(
            { error: "Failed to queue transcription" },
            { status: 500 }
        );
    }

    // Trigger Inngest function for async processing
    try {
        await inngest.send({
            name: "transcription/requested",
            data: {
                projectId: id,
                jobId: job.id,
                userId: user.id,
                mediaUrl,
                keyTerms: keyTerms?.map((k) => k.term) || [],
            },
        });
    } catch (sendError) {
        console.error("Failed to send Inngest event:", sendError);
        // Rollback: Update project status back and mark job as error
        const errorMessage =
            sendError instanceof Error ? sendError.message : String(sendError);
        const errorPayload = {
            error: "Failed to start transcription. Please try again.",
            error_type: "transcription_error",
            raw_error: errorMessage.slice(0, 500),
        };
        const { error: projectRollbackError } = await supabase
            .from("projects")
            .update({ status: "error" })
            .eq("id", id);
        if (projectRollbackError) {
            console.error("Failed to rollback project status:", projectRollbackError);
        }
        const { error: jobRollbackError } = await supabase
            .from("jobs")
            .update({ status: "error", payload: errorPayload })
            .eq("id", job.id);
        if (jobRollbackError) {
            console.error("Failed to rollback job status:", jobRollbackError);
        }
        return NextResponse.json(
            { error: "Failed to start transcription" },
            { status: 500 }
        );
    }

    console.log(`Transcription started for project: ${id}, job: ${job.id}`);

    return NextResponse.json({
        message: "Transcription started",
        jobId: job.id,
    });
}
