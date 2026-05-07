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
const BATCH_SIZE = 500;

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

    // Get segments
    const { data: segments, error: segmentsError } = await supabase
        .from("segments")
        .select("id, speaker_id, start_ms, end_ms, text, is_filler, algo_version")
        .eq("project_id", PROJECT_ID);
    if (segmentsError) {
        throw segmentsError;
    }

    const segmentCount = segments?.length || 0;
    console.log(`\nSegments: ${segmentCount}`);
    let wordCount = 0;

    if (segments && segments.length > 0) {
        for (let i = 0; i < segments.length; i += BATCH_SIZE) {
            const batchIds = segments.slice(i, i + BATCH_SIZE).map(s => s.id);
            const { count, error } = await supabase
                .from("words")
                .select("id", { count: "exact", head: true })
                .in("segment_id", batchIds);
            if (error) {
                throw error;
            }
            wordCount += count || 0;
        }
    }
    console.log(`Words: ${wordCount}`);

    // Save results
    const results = {
        project: project,
        stats: {
            segmentCount,
            wordCount,
            speakerCount: speakers?.length || 0,
        },
        speakers: speakers,
        segments: segments?.map(segment => ({
            startTime: formatTime(segment.start_ms),
            endTime: formatTime(segment.end_ms),
            speaker: speakers?.find(s => s.id === segment.speaker_id)?.label || "Unknown",
            text: segment.text,
            isFiller: segment.is_filler,
            algoVersion: segment.algo_version,
        })),
    };

    const outputPath = `scripts/transcription-results-${PROJECT_ID}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n💾 Full results saved to: ${outputPath}`);

    // Print first 10 segments
    console.log("\n" + "=".repeat(80));
    console.log("📝 FIRST 10 SEGMENTS:");
    console.log("=".repeat(80));

    for (const segment of (segments || []).slice(0, 10)) {
        const speaker = speakers?.find(s => s.id === segment.speaker_id)?.label || "Unknown";
        const duration = ((segment.end_ms - segment.start_ms) / 1000).toFixed(1);
        console.log(`\n[${formatTime(segment.start_ms)} - ${formatTime(segment.end_ms)}] (${duration}s) - ${speaker}`);
        console.log(`"${segment.text}"`);
        console.log(`  [algo=${segment.algo_version}]`);
        if (segment.is_filler) {
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
