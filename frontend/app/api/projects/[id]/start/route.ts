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

    // Check if project is already processing
    if (project.status === "processing") {
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

    const mediaUrl = signedUrlResult.url;

    // Create job record
    const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
            project_id: id,
            status: "queued",
            job_type: "transcription",
        })
        .select()
        .single();

    if (jobError) {
        console.error("Failed to create job:", jobError);
        return NextResponse.json(
            { error: "Failed to create job" },
            { status: 500 }
        );
    }

    // Update project status to processing
    const { error: updateError } = await supabase
        .from("projects")
        .update({ status: "processing" })
        .eq("id", id);

    if (updateError) {
        console.error("Failed to update project status:", updateError);
        // Don't fail - job was created, we can proceed
    }

    // Trigger Inngest function for async processing
    await inngest.send({
        name: "transcription/requested",
        data: {
            projectId: id,
            userId: user.id,
            mediaUrl,
            keyTerms: keyTerms?.map((k) => k.term) || [],
        },
    });

    console.log(`Transcription started for project: ${id}, job: ${job.id}`);

    return NextResponse.json({
        message: "Transcription started",
        jobId: job.id,
    });
}
