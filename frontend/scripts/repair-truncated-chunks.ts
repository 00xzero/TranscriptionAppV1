/**
 * One-off script to re-run consolidation for projects with truncated chunks.
 * 
 * Run with: npx tsx --env-file=.env.local scripts/repair-truncated-chunks.ts
 */

import { runConsolidation } from "../core/transcript/consolidation-service";

const AFFECTED_PROJECTS = [
    "ae2c74bf-80c4-4bf8-b597-6cbc7eb6b134", // KT Session - Make & WH Workshop
    "5eb8f513-f9c5-4527-bec6-5d039c587686", // KT Session - Make & WH I
    "dfa48c16-7712-4a05-9d6f-3a16a72abe96", // Dechra Mobilisation 26.01.26 Morning Chat
];

async function main() {
    console.log(`🔧 Repairing ${AFFECTED_PROJECTS.length} projects with truncated chunks...\n`);

    for (const projectId of AFFECTED_PROJECTS) {
        try {
            console.log(`▶ Processing project: ${projectId}`);
            const result = await runConsolidation(projectId);
            console.log(`  ✅ Generated ${result.chunkCount} chunks, ${result.chunkWordCount} chunk_words\n`);
        } catch (error) {
            console.error(`  ❌ Failed for project ${projectId}:`, error);
        }
    }

    console.log("🎉 Repair complete!");
}

main().catch(console.error);
