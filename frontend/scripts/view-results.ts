/**
 * View transcription results for a project
 * 
 * Run with: npx tsx --env-file=.env.local scripts/view-results.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

const PROJECT_ID = "a6c35775-9001-4e5e-93db-f2675fc22265";

async function main() {
    console.log("📊 Transcription Results for project:", PROJECT_ID);

    // Get project
    const { data: project } = await supabase
        .from("projects")
        .select("id, title, status")
        .eq("id", PROJECT_ID)
        .single();

    console.log(`\nProject: ${project?.title}`);
    console.log(`Status: ${project?.status}`);

    // Get speakers
    const { data: speakers } = await supabase
        .from("speakers")
        .select("id, label")
        .eq("project_id", PROJECT_ID);

    console.log(`\nSpeakers: ${speakers?.length || 0}`);
    speakers?.forEach(s => console.log(`  - ${s.label}`));

    // Get chunks
    const { data: chunks } = await supabase
        .from("chunks")
        .select("id, speaker_id, start_ms, end_ms, text, is_filler, source_segment_ids, algo_version")
        .eq("project_id", PROJECT_ID)
        .order("start_ms");

    console.log(`\nChunks: ${chunks?.length || 0}`);

    // Get stats
    const { count: segmentCount } = await supabase
        .from("segments")
        .select("id", { count: "exact" })
        .eq("project_id", PROJECT_ID);

    const { count: wordCount } = await supabase
        .from("words")
        .select("id", { count: "exact" })
        .in("segment_id", (await supabase.from("segments").select("id").eq("project_id", PROJECT_ID)).data?.map(s => s.id) || []);

    console.log(`Segments: ${segmentCount}`);
    console.log(`Words: ${wordCount}`);

    // Save results
    const results = {
        project: project,
        stats: {
            segmentCount,
            chunkCount: chunks?.length || 0,
            wordCount,
            speakerCount: speakers?.length || 0,
            consolidationRatio: chunks?.length && segmentCount ? (chunks.length / segmentCount * 100).toFixed(1) + "%" : "N/A",
        },
        speakers: speakers,
        chunks: chunks?.map(chunk => ({
            startTime: formatTime(chunk.start_ms),
            endTime: formatTime(chunk.end_ms),
            speaker: speakers?.find(s => s.id === chunk.speaker_id)?.label || "Unknown",
            text: chunk.text,
            isFiller: chunk.is_filler,
            sourceSegments: chunk.source_segment_ids?.length || 0,
        })),
    };

    const outputPath = `scripts/transcription-results-${PROJECT_ID}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n💾 Full results saved to: ${outputPath}`);

    // Print first 10 chunks
    console.log("\n" + "=".repeat(80));
    console.log("📝 FIRST 10 CHUNKS:");
    console.log("=".repeat(80));

    for (const chunk of (chunks || []).slice(0, 10)) {
        const speaker = speakers?.find(s => s.id === chunk.speaker_id)?.label || "Unknown";
        const duration = ((chunk.end_ms - chunk.start_ms) / 1000).toFixed(1);
        console.log(`\n[${formatTime(chunk.start_ms)} - ${formatTime(chunk.end_ms)}] (${duration}s) - ${speaker}`);
        console.log(`"${chunk.text}"`);
        if (chunk.is_filler) {
            console.log("  [FILLER]");
        }
    }

    console.log("\n" + "=".repeat(80));
    console.log("✅ Done!");
}

function formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

main().catch(console.error);
