/**
 * Re-run consolidation for a project that has segments/words but no chunks
 * 
 * Run with: npx tsx --env-file=.env.local scripts/run-consolidation.ts
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

const PROJECT_ID = "a6c35775-9001-4e5e-93db-f2675fc22265";

async function main() {
    console.log("🔄 Running consolidation for project:", PROJECT_ID);

    // Import consolidation service
    const { runConsolidation } = await import("../lib/inngest/consolidation-service");

    // Run consolidation
    const result = await runConsolidation(PROJECT_ID);

    console.log("\n✅ Consolidation complete!");
    console.log(`   Chunks: ${result.chunkCount}`);
    console.log(`   Chunk Words: ${result.chunkWordCount}`);
    console.log(`   Algorithm: ${result.algoVersion}`);

    // Update job status
    await supabase
        .from("jobs")
        .update({
            status: "completed",
            payload: { message: "Consolidation completed successfully" },
            finished_at: new Date().toISOString()
        })
        .eq("id", "59064ff3-169f-452f-add0-ca14d733df8a");

    await supabase
        .from("projects")
        .update({ status: "completed" })
        .eq("id", PROJECT_ID);

    console.log("\n✅ Job and project status updated to completed");
}

main().catch(console.error);
