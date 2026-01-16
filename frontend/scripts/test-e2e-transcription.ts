/**
 * End-to-End Transcription Test
 * 
 * Run with: npx tsx --env-file=.env.local scripts/test-e2e-transcription.ts
 * 
 * This script:
 * 1. Uses an existing project with an audio file
 * 2. Generates a signed URL for Deepgram
 * 3. Triggers transcription via Inngest
 * 4. Polls for completion
 * 5. Saves results to a file
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const inngestEventKey = process.env.INNGEST_EVENT_KEY || "";

if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

// Use a specific project ID (one with shorter audio for faster testing)
// Change this to test different files
const TEST_PROJECT_ID = "a6c35775-9001-4e5e-93db-f2675fc22265";

async function main() {
    console.log("🎤 End-to-End Transcription Test\n");

    // Step 1: Get project details
    console.log("1️⃣ Fetching project details...");
    const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id, title, status, source_object_key, user_id")
        .eq("id", TEST_PROJECT_ID)
        .single();

    if (projectError || !project) {
        console.error("Failed to fetch project:", projectError);
        process.exit(1);
    }

    console.log(`   Project: ${project.title}`);
    console.log(`   Status: ${project.status}`);
    console.log(`   Object Key: ${project.source_object_key}`);

    if (!project.source_object_key) {
        console.error("Project has no source_object_key");
        process.exit(1);
    }

    // Step 2: Generate signed URL
    console.log("\n2️⃣ Generating signed URL for Deepgram...");
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from("media")
        .createSignedUrl(project.source_object_key, 3600); // 1 hour expiry

    if (signedUrlError || !signedUrlData) {
        console.error("Failed to generate signed URL:", signedUrlError);
        process.exit(1);
    }

    const mediaUrl = signedUrlData.signedUrl;
    console.log(`   Signed URL generated (expires in 1 hour)`);

    // Step 3: Create job record
    console.log("\n3️⃣ Creating job record...");
    const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
            project_id: project.id,
            type: "transcribe",
            status: "queued",
        })
        .select("id")
        .single();

    if (jobError || !job) {
        console.error("Failed to create job:", jobError);
        process.exit(1);
    }
    console.log(`   Job ID: ${job.id}`);

    // Update project status to processing
    await supabase
        .from("projects")
        .update({ status: "processing" })
        .eq("id", project.id);

    // Step 4: Trigger Inngest event
    console.log("\n4️⃣ Triggering Inngest transcription event...");

    // Send event to local Inngest dev server
    const inngestResponse = await fetch("http://localhost:8288/e/dev", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            name: "transcription/requested",
            data: {
                projectId: project.id,
                jobId: job.id,
                userId: project.user_id,
                mediaUrl: mediaUrl,
                keyTerms: [],
            },
        }),
    });

    if (!inngestResponse.ok) {
        const text = await inngestResponse.text();
        console.error("Failed to trigger Inngest event:", text);
        process.exit(1);
    }

    console.log("   ✅ Event sent to Inngest dev server");
    console.log("   Waiting for transcription to complete...\n");

    // Step 5: Poll for completion
    const startTime = Date.now();
    const timeout = 10 * 60 * 1000; // 10 minutes timeout
    let lastStatus = "";

    while (Date.now() - startTime < timeout) {
        const { data: updatedJob } = await supabase
            .from("jobs")
            .select("status, payload, finished_at")
            .eq("id", job.id)
            .single();

        if (updatedJob && updatedJob.status !== lastStatus) {
            lastStatus = updatedJob.status;
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`   [${elapsed}s] Job status: ${updatedJob.status}`);
        }

        if (updatedJob?.status === "completed") {
            console.log("\n   🎉 Transcription completed!");
            break;
        }

        if (updatedJob?.status === "error") {
            console.error("\n   ❌ Transcription failed!");
            console.error("   Error:", updatedJob.payload);
            process.exit(1);
        }

        await sleep(2000); // Poll every 2 seconds
    }

    if (lastStatus !== "completed") {
        console.error("\n   ⏰ Timeout waiting for transcription");
        process.exit(1);
    }

    // Step 6: Fetch results
    console.log("\n5️⃣ Fetching transcription results...");

    // Get segments
    const { data: segments } = await supabase
        .from("segments")
        .select("id, speaker_id, start_ms, end_ms, text")
        .eq("project_id", project.id)
        .order("start_ms");

    console.log(`   Segments: ${segments?.length || 0}`);

    // Get words count
    const { count: wordCount } = await supabase
        .from("words")
        .select("id", { count: "exact" })
        .in("segment_id", segments?.map(s => s.id) || []);

    console.log(`   Words: ${wordCount || 0}`);

    // Get chunks
    const { data: chunks } = await supabase
        .from("chunks")
        .select("id, speaker_id, start_ms, end_ms, text, is_filler, source_segment_ids, algo_version")
        .eq("project_id", project.id)
        .order("start_ms");

    console.log(`   Chunks: ${chunks?.length || 0}`);

    // Get chunk_words count
    const { count: chunkWordCount } = await supabase
        .from("chunk_words")
        .select("id", { count: "exact" })
        .in("chunk_id", chunks?.map(c => c.id) || []);

    console.log(`   Chunk Words: ${chunkWordCount || 0}`);

    // Get speakers
    const { data: speakers } = await supabase
        .from("speakers")
        .select("id, label")
        .eq("project_id", project.id);

    console.log(`   Speakers: ${speakers?.length || 0}`);

    // Step 7: Save results to file
    console.log("\n6️⃣ Saving results to file...");

    const results = {
        project: {
            id: project.id,
            title: project.title,
        },
        stats: {
            segmentCount: segments?.length || 0,
            wordCount: wordCount || 0,
            chunkCount: chunks?.length || 0,
            chunkWordCount: chunkWordCount || 0,
            speakerCount: speakers?.length || 0,
        },
        speakers: speakers,
        chunks: chunks?.map(chunk => ({
            id: chunk.id,
            speakerId: chunk.speaker_id,
            speakerLabel: speakers?.find(s => s.id === chunk.speaker_id)?.label || "Unknown",
            startMs: chunk.start_ms,
            endMs: chunk.end_ms,
            text: chunk.text,
            isFiller: chunk.is_filler,
            sourceSegmentCount: chunk.source_segment_ids?.length || 0,
            algoVersion: chunk.algo_version,
        })),
        // Include first few and last few segments for verification
        segmentSamples: {
            first5: segments?.slice(0, 5),
            last5: segments?.slice(-5),
        },
    };

    const outputPath = `scripts/test-output-${project.id}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`   Results saved to: ${outputPath}`);

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 TRANSCRIPTION SUMMARY");
    console.log("=".repeat(60));
    console.log(`Project: ${project.title}`);
    console.log(`Segments: ${results.stats.segmentCount}`);
    console.log(`Words: ${results.stats.wordCount}`);
    console.log(`Chunks: ${results.stats.chunkCount} (consolidated from ${results.stats.segmentCount} segments)`);
    console.log(`Speakers: ${results.stats.speakerCount}`);
    console.log("=".repeat(60));

    // Print first 3 chunks
    console.log("\n📝 First 3 Chunks:\n");
    for (const chunk of (results.chunks || []).slice(0, 3)) {
        const duration = ((chunk.endMs - chunk.startMs) / 1000).toFixed(1);
        console.log(`[${formatTime(chunk.startMs)} - ${formatTime(chunk.endMs)}] (${duration}s)`);
        console.log(`Speaker: ${chunk.speakerLabel}`);
        console.log(`Text: "${chunk.text.substring(0, 200)}${chunk.text.length > 200 ? '...' : ''}"`);
        console.log(`Filler: ${chunk.isFiller}, Source Segments: ${chunk.sourceSegmentCount}`);
        console.log("");
    }

    console.log("✅ End-to-end test complete!\n");
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

main().catch(console.error);
