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
    const { runConsolidation } = await import("../core/transcript/consolidation-service");

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
        // Transition job via RPC for audit consistency
        const { data: rpcResult, error: rpcError } = await supabase.rpc("transition_job_status", {
            p_job_id: job.id,
            p_to_status: "completed",
            p_extra_fields: {
                payload: { message: "Consolidation completed successfully" },
                finished_at: new Date().toISOString(),
            },
            p_metadata: {},
            p_context: "run-consolidation-script",
        });

        if (rpcError) {
            console.error("❌ Failed to transition job status:", rpcError.message);
            process.exit(1);
        }

        const outcome = (rpcResult as { outcome?: string; error?: string } | null)?.outcome;
        if (outcome !== "applied" && outcome !== "noop") {
            const errorMessage = (rpcResult as { error?: string } | null)?.error || outcome || "unknown";
            console.error("❌ Job transition was not applied:", errorMessage);
            process.exit(1);
        }

        console.log(`   Job ${job.id} transition: ${outcome}`);
        // Project status derived by trigger — no manual update needed
    }

    console.log("\n✅ Job status updated (project status derived by trigger)");
}

main().catch((error) => {
    console.error("❌ Consolidation failed:", error);
    process.exit(1);
});
