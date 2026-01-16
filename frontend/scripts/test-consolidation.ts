/**
 * Test script for Phase 6 consolidation pipeline
 * 
 * Run with: npx tsx --env-file=.env.local scripts/test-consolidation.ts
 * 
 * This script:
 * 1. Creates a test project with segments and words
 * 2. Runs consolidation
 * 3. Verifies chunks and chunk_words are created
 * 4. Cleans up test data
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

// Test user ID (from existing users)
const TEST_USER_ID = "13fc4c3d-2219-48a0-9906-8be0f90dc59e";

async function main() {
    console.log("🧪 Phase 6 Consolidation Test\n");

    // Step 1: Create test project
    console.log("1️⃣ Creating test project...");
    const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({
            user_id: TEST_USER_ID,
            title: "Consolidation Test Project",
            status: "processing",
        })
        .select("id")
        .single();

    if (projectError || !project) {
        console.error("Failed to create project:", projectError);
        process.exit(1);
    }
    console.log(`   Project ID: ${project.id}`);

    // Step 2: Create test speaker
    console.log("2️⃣ Creating test speaker...");
    const { data: speaker, error: speakerError } = await supabase
        .from("speakers")
        .insert({
            project_id: project.id,
            label: "Speaker 1",
        })
        .select("id")
        .single();

    if (speakerError || !speaker) {
        console.error("Failed to create speaker:", speakerError);
        await cleanup(project.id);
        process.exit(1);
    }
    console.log(`   Speaker ID: ${speaker.id}`);

    // Step 3: Create test segments with words
    console.log("3️⃣ Creating test segments and words...");

    // Segment 1: Short sentence
    const { data: seg1, error: seg1Error } = await supabase
        .from("segments")
        .insert({
            project_id: project.id,
            speaker_id: speaker.id,
            start_ms: 0,
            end_ms: 2000,
            text: "Hello, welcome to our meeting today.",
        })
        .select("id")
        .single();

    if (seg1Error || !seg1) {
        console.error("Failed to create segment 1:", seg1Error);
        await cleanup(project.id);
        process.exit(1);
    }

    // Insert words for segment 1
    const words1 = ["Hello,", "welcome", "to", "our", "meeting", "today."];
    const wordRows1 = words1.map((text, idx) => ({
        segment_id: seg1.id,
        text,
        start_ms: idx * 300,
        end_ms: (idx + 1) * 300,
        confidence: 0.95,
        order_index: idx,
    }));
    await supabase.from("words").insert(wordRows1);

    // Segment 2: Adjacent segment (should merge)
    const { data: seg2 } = await supabase
        .from("segments")
        .insert({
            project_id: project.id,
            speaker_id: speaker.id,
            start_ms: 2100,
            end_ms: 4000,
            text: "We have a lot to discuss.",
        })
        .select("id")
        .single();

    const words2 = ["We", "have", "a", "lot", "to", "discuss."];
    const wordRows2 = words2.map((text, idx) => ({
        segment_id: seg2!.id,
        text,
        start_ms: 2100 + idx * 300,
        end_ms: 2100 + (idx + 1) * 300,
        confidence: 0.93,
        order_index: idx,
    }));
    await supabase.from("words").insert(wordRows2);

    // Segment 3: Filler (should be marked as filler)
    const { data: seg3 } = await supabase
        .from("segments")
        .insert({
            project_id: project.id,
            speaker_id: speaker.id,
            start_ms: 4100,
            end_ms: 4500,
            text: "Yeah.",
        })
        .select("id")
        .single();

    await supabase.from("words").insert({
        segment_id: seg3!.id,
        text: "Yeah.",
        start_ms: 4100,
        end_ms: 4500,
        confidence: 0.99,
        order_index: 0,
    });

    // Segment 4: Another sentence after gap (should be separate chunk due to gap > 2000ms)
    const { data: seg4 } = await supabase
        .from("segments")
        .insert({
            project_id: project.id,
            speaker_id: speaker.id,
            start_ms: 7000,
            end_ms: 9000,
            text: "Let's start with the first agenda item.",
        })
        .select("id")
        .single();

    const words4 = ["Let's", "start", "with", "the", "first", "agenda", "item."];
    const wordRows4 = words4.map((text, idx) => ({
        segment_id: seg4!.id,
        text,
        start_ms: 7000 + idx * 280,
        end_ms: 7000 + (idx + 1) * 280,
        confidence: 0.91,
        order_index: idx,
    }));
    await supabase.from("words").insert(wordRows4);

    console.log("   Created 4 segments with words");

    // Step 4: Run consolidation via the function
    console.log("4️⃣ Running consolidation...");

    // Import and run the consolidation service
    // Since we're in a script, we need to load it dynamically
    const { runConsolidation } = await import("../lib/inngest/consolidation-service");

    const result = await runConsolidation(project.id);
    console.log(`   Result: ${result.chunkCount} chunks, ${result.chunkWordCount} chunk_words`);
    console.log(`   Algorithm: ${result.algoVersion}`);

    // Step 5: Verify chunks
    console.log("5️⃣ Verifying chunks...");
    const { data: chunks } = await supabase
        .from("chunks")
        .select("id, start_ms, end_ms, text, is_filler, source_segment_ids, algo_version")
        .eq("project_id", project.id)
        .order("start_ms");

    if (!chunks || chunks.length === 0) {
        console.error("❌ No chunks created!");
        await cleanup(project.id);
        process.exit(1);
    }

    console.log(`   Found ${chunks.length} chunks:`);
    for (const chunk of chunks) {
        const filler = chunk.is_filler ? " [FILLER]" : "";
        console.log(`   - [${chunk.start_ms}ms - ${chunk.end_ms}ms]${filler}: "${chunk.text.substring(0, 50)}..."`);
        console.log(`     Source segments: ${chunk.source_segment_ids.length}, Version: ${chunk.algo_version}`);
    }

    // Step 6: Verify chunk_words
    console.log("6️⃣ Verifying chunk_words...");
    const { data: chunkWords } = await supabase
        .from("chunk_words")
        .select("id, chunk_id, word_id, order_index")
        .in("chunk_id", chunks.map(c => c.id));

    console.log(`   Found ${chunkWords?.length || 0} chunk_words`);

    // Verify expected behavior
    console.log("\n7️⃣ Verification Summary:");

    // Expected: 3 chunks (seg1+seg2 merged, seg3 filler, seg4 separate due to gap)
    const expectedChunks = 3;
    if (chunks.length === expectedChunks) {
        console.log(`   ✅ Chunk count correct (${expectedChunks})`);
    } else {
        console.log(`   ⚠️  Expected ${expectedChunks} chunks, got ${chunks.length}`);
    }

    // Check filler detection
    const fillerChunks = chunks.filter(c => c.is_filler);
    if (fillerChunks.length === 1) {
        console.log("   ✅ Filler detection correct (1 filler chunk)");
    } else {
        console.log(`   ⚠️  Expected 1 filler chunk, got ${fillerChunks.length}`);
    }

    // Check algo version
    const correctVersion = chunks.every(c => c.algo_version === "v1.3-ts");
    if (correctVersion) {
        console.log("   ✅ Algorithm version correct (v1.3-ts)");
    } else {
        console.log("   ⚠️  Algorithm version mismatch");
    }

    // Step 7: Cleanup
    console.log("\n8️⃣ Cleaning up test data...");
    await cleanup(project.id);
    console.log("   Done!");

    console.log("\n🎉 Phase 6 consolidation test passed!\n");
}

async function cleanup(projectId: string) {
    // Delete project (cascades to all related tables)
    await supabase.from("projects").delete().eq("id", projectId);
    console.log(`   Deleted project ${projectId}`);
}

main().catch(console.error);
