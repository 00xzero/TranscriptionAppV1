/**
 * Re-run consolidation for a project that has segments/words but no chunks
 * 
 * Run with: npx tsx --env-file=.env.local scripts/run-consolidation.ts <project-id>
 * 
 * Example: npx tsx --env-file=.env.local scripts/run-consolidation.ts a6c35775-9001-4e5e-93db-f2675fc22265
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
    // Get project ID from command line argument
    const projectId = process.argv[2];

    if (!projectId) {
        console.error("Usage: npx tsx --env-file=.env.local scripts/run-consolidation.ts <project-id>");
        console.error("Example: npx tsx --env-file=.env.local scripts/run-consolidation.ts a6c35775-9001-4e5e-93db-f2675fc22265");
        process.exit(1);
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(projectId)) {
        console.error("Invalid project ID format. Must be a valid UUID.");
        process.exit(1);
    }

    console.log("🔄 Running consolidation for project:", projectId);

    // Verify project exists
    const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id, title, status")
        .eq("id", projectId)
        .single();

    if (projectError || !project) {
        console.error("Failed to find project:", projectError?.message || "Project not found");
        process.exit(1);
    }

    console.log(`   Project: ${project.title}`);
    console.log(`   Current status: ${project.status}`);

    // Import consolidation service
    const { runConsolidation } = await import("../lib/inngest/consolidation-service");

    // Run consolidation
    const result = await runConsolidation(projectId);

    console.log("\n✅ Consolidation complete!");
    console.log(`   Chunks: ${result.chunkCount}`);
    console.log(`   Chunk Words: ${result.chunkWordCount}`);
    console.log(`   Algorithm: ${result.algoVersion}`);

    // Find the latest job for this project
    const { data: job, error: jobError } = await supabase
        .from("jobs")
        .select("id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

    if (jobError) {
        console.warn("⚠️  Could not find job for project:", jobError.message);
    } else if (job) {
        // Update job status
        const { error: jobUpdateError } = await supabase
            .from("jobs")
            .update({
                status: "completed",
                payload: { message: "Consolidation completed successfully" },
                finished_at: new Date().toISOString()
            })
            .eq("id", job.id);

        if (jobUpdateError) {
            console.error("❌ Failed to update job status:", jobUpdateError.message);
            process.exit(1);
        }
        console.log(`   Job ${job.id} marked as completed`);
    }

    // Update project status
    const { error: projectUpdateError } = await supabase
        .from("projects")
        .update({ status: "completed" })
        .eq("id", projectId);

    if (projectUpdateError) {
        console.error("❌ Failed to update project status:", projectUpdateError.message);
        process.exit(1);
    }

    console.log("\n✅ Job and project status updated to completed");
}

main().catch((error) => {
    console.error("❌ Consolidation failed:", error);
    process.exit(1);
});
