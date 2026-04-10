# Segments-Only Migration Plan

## Goal

Move the transcription pipeline from a dual-representation model:

- `words` as atomic timing data
- `segments` as intermediate transcript units
- `chunks` as the user-facing transcript units

to a simpler model:

- `words` as atomic timing and rebuild data
- `segments` as the canonical and user-facing transcript units

This plan assumes:

- we are keeping word-level transcription as the source of truth
- we do **not** want to bring back `utterances=true`
- we want a fast implementation and rollout path
- we do **not** need long-lived per-project compatibility modes

## Why We Are Doing This

The old `chunks` layer existed largely to repair weak boundaries inherited from provider output. Now that we are constructing transcript structure ourselves, `segments` should become the canonical unit and `chunks` should become temporary scaffolding on the way out.

That means:

- transcript readability should be defined at segment construction time
- editor and export should read the same canonical transcript unit
- rebuilding transcript structure should not depend on legacy chunk code
- the system should become easier to reason about once `chunks` are removed

## Current State

Today, `chunks` are still load-bearing in three areas:

1. Ingestion pipeline
- `handle-transcription-webhook.ts` stores `segments`, then runs consolidation to generate `chunks`

2. Editor data flow
- the editor prefers `chunks` and treats raw `segments` as a degraded mode with editing disabled

3. Export and reporting
- export routes and helper code currently read from `chunks`

There is also a migration constraint:

- existing `words` rows do **not** currently persist enough metadata by themselves to rebuild paragraph-aware, speaker-aware canonical segments
- existing Deepgram payloads are stored in `jobs.payload.deepgram`, but that is a transitional source, not the desired long-term rebuild source

## Target State

- `words` remain the atomic timing/alignment layer
- `words` also store normalized rebuild metadata needed for future re-segmentation
- `segments` become the single canonical transcript unit
- `segments` are editable and user-facing
- editor reads from `segments`
- exports read from `segments`
- no runtime dependence on `chunks`, `chunk_words`, or consolidation
- DB schema no longer includes chunk-related tables/RPC

## Core Decisions

### Canonical Segment Invariants

Canonical `segments` must satisfy these rules:

- hard break on speaker change
- hard break on paragraph boundary
- hard break on sufficiently long silence gap
- hard break when segment duration exceeds a configured cap
- soft preference to end on sentence boundaries
- every segment must stay speaker-homogeneous and word-contiguous

### Source-of-Truth Rules

- words are authoritative for speaker assignment
- paragraph boundaries are boundary hints, not speaker truth
- if paragraph metadata conflicts with per-word speaker labels, trust words
- if paragraph metadata is missing or partial, degrade gracefully and still produce usable segments

### Initial Builder Defaults

Start with conservative defaults close to the current readability behavior:

- silence gap hard break: `> 2000ms`
- max segment duration hard break: `15000ms`
- soft target: `~60` words with sentence-boundary preference

These values should live in one versioned builder config, not be scattered magic constants.

### Editing and Export Behavior

- `segments` must support transcript editing directly
- find/replace must operate on `segments`
- DOCX export must preserve current readability and speaker-turn presentation
- VTT export should emit one cue per canonical segment unless we later find a concrete captioning reason to merge

### Metadata Rules

Segments should carry the minimum metadata needed to preserve current behavior and support future debugging:

- `is_edited`
- `algo_version`

We do **not** need to carry chunk-era lineage such as `source_segment_ids` into canonical segments.

### Rebuild and Migration Rules

- use one shared, versioned segment builder for both ingestion and rebuilds
- allow segment IDs to change during rebuilds
- preserve existing speaker rows/labels where possible by mapping rebuilt default speakers onto existing `Speaker N` rows
- freeze edited projects from automatic re-segmentation
- for the one-time migration, use stored Deepgram payloads as the transitional extraction source
- long term, rebuilds should use normalized metadata stored on `words`, not raw provider payloads

### Rollout Strategy

Because speed is the priority and there are effectively no users:

- prefer a global cutover over a per-project compatibility flag
- do a one-time extraction and rebuild pass first
- switch editor and exports globally to `segments`
- keep only a short-lived emergency rollback mechanism if helpful during development

### Scope Cut

Do not carry chunk-era filler classification into the canonical model unless a real product use appears. It is not a user-facing requirement for this migration.

## Phase 0: Schema Prep and Migration Scaffolding

### Objective

Prepare the schema and migration tooling so a segment-only rollout is actually possible.

### Work

- Add canonical metadata to `segments`
  - `is_edited`
  - `algo_version`
- Extend `words` directly with normalized rebuild metadata
  - per-word speaker information
  - paragraph grouping/boundary hints
  - sentence grouping or sentence-end hints
- Keep these new `words` fields nullable during migration
- Add extraction tooling that reads existing `jobs.payload.deepgram` and persists the normalized rebuild metadata needed for existing projects
- Add reporting for projects that cannot be safely rebuilt from available stored data
- Define and document the rebuild safety rule:
  - projects with user-edited canonical segments must not be auto-resegmented

### Exit Criteria

- New ingestions can persist the metadata needed for future rebuilds
- Existing projects can be audited for rebuild readiness
- The schema supports canonical editable segments without relying on `chunks`

## Phase 1: Build The Canonical Segment Builder

### Objective

Make newly created `segments` good enough to stand on their own.

### Work

- Extract transcript construction into a dedicated shared module under `frontend/core/transcript/`
- Build one shared, versioned segment builder used by both:
  - ingestion
  - one-time rebuild/backfill
- Build canonical segments from normalized paragraph/sentence/word metadata
- Encode the agreed segmentation rules:
  - break on paragraph boundary
  - break on speaker change
  - break on silence gap `> 2000ms`
  - break when segment duration exceeds `15000ms`
  - prefer sentence-boundary endings around `~60` words when possible
- Ensure the builder degrades gracefully when paragraph metadata is missing or partial
- Keep consolidation running temporarily so the rest of the app remains stable during this phase

### Tests

Add or expand tests for:

- single-speaker long monologue
- repeated same-speaker paragraphs
- multi-speaker interruptions inside one paragraph
- paragraph/speaker disagreement cases
- partial or missing paragraph metadata
- sentence-boundary preference behavior
- silence-gap and max-duration boundaries

### Exit Criteria

- The generated `segments` are readable enough to show directly in the editor
- Ingestion and rebuild paths call the same builder implementation

## Phase 2: Extract, Rebuild, and Validate Existing Projects

### Objective

Make existing projects compatible with the canonical segment model before the global cutover.

### Work

- Run the one-time extraction pass from existing `jobs.payload.deepgram`
- Persist normalized rebuild metadata onto `words`
- Rebuild canonical `segments` for existing projects using the shared builder
- Allow segment IDs to change as part of the rebuild
- Preserve existing default speaker rows/labels where possible
- Skip automatic rebuild for projects that already contain user-edited canonical segments
- Produce an audit/report of:
  - successfully rebuilt projects
  - skipped edited projects
  - projects missing enough data for safe rebuild

### Exit Criteria

- Existing target projects have canonical `segments` built with the new logic
- We know exactly which projects are safe to carry forward into the global cutover

## Phase 3: Make The App Segment-First

### Objective

Switch user-facing application flows to canonical `segments`.

### Work

- Update transcript queries to read `segments` first and then remove chunk-first selection logic
- Remove or simplify editor code that branches on `source === 'chunks'` vs `source === 'segments'`
- Enable transcript editing on `segments`
- Enable find/replace on `segments`
- Keep post-edit word highlighting/alignment best-effort rather than blocking on perfect re-alignment
- Update speaker assignment flows to treat `segments` as the normal editable unit
- Update DOCX and VTT export loaders to read from `segments`
- Preserve current export readability and speaker-turn presentation
- Remove UX that only exists to explain a degraded raw-segment mode

### Likely Touchpoints

- `frontend/lib/supabase/queries.ts`
- `frontend/app/editor/[id]/hooks/useEditorData.ts`
- `frontend/app/editor/[id]/hooks/useTranscriptMutations.ts`
- `frontend/app/editor/[id]/hooks/useTranscriptSearch.ts`
- `frontend/app/editor/[id]/components/TranscriptSegmentCard.tsx`
- `frontend/core/exports/data.ts`
- `frontend/core/exports/index.ts`

### Exit Criteria

- The editor works correctly using only `segments`
- editing, search/replace, playback sync, and speaker assignment work on canonical segments
- exports work correctly from canonical segments

## Phase 4: Stop Writing Chunks

### Objective

Remove chunk generation from the ingestion path after the app is already segment-first.

### Work

- Remove the consolidation step from `handle-transcription-webhook.ts`
- Stop generating new `chunks` and `chunk_words`
- Remove chunk/consolidation metadata from completion flows where it is no longer useful
- Remove scripts and helper flows whose only purpose is chunk generation or repair

### Exit Criteria

New transcriptions complete successfully using only:

- `segments`
- `words`
- `speakers`

## Phase 5: Remove Runtime Chunk Code

### Objective

Delete chunk-related code paths from the application layer.

### Work

- Remove `consolidation.ts`
- Remove `consolidation-service.ts`
- Remove chunk-related query helpers, hooks, scripts, tests, and subscriptions
- Remove chunk schemas/contracts from the frontend
- Update seed/test utilities to be segment-only

### Exit Criteria

No runtime application behavior depends on `chunks` or `chunk_words`.

## Phase 6: Remove Chunk Schema

### Objective

Clean up the database once the app has proven it can operate segment-only.

### Work

- Add a migration to drop:
  - `chunk_words`
  - `chunks`
  - `save_consolidated_chunks`
  - related indexes, policies, and grants
- Remove chunk references from seed data
- Remove chunk-era docs and environment comments

### Exit Criteria

The schema reflects the new mental model:

- `projects`
- `segments`
- `words`
- `speakers`
- `jobs`

## Recommended Order Within This Branch

1. Land Phase 0 schema prep and extraction tooling
2. Land the shared canonical segment builder
3. Run extraction + rebuild for existing projects
4. Switch editor and exports globally to segments
5. Stop writing chunks
6. Remove runtime chunk code
7. Drop chunk schema last

## Validation Checkpoints

### Checkpoint A: Builder Quality

After Phase 1, inspect a few real transcripts manually and compare:

- segment count
- readability
- speaker continuity
- long monologue behavior
- same-speaker paragraph behavior

### Checkpoint B: Rebuild Quality

After Phase 2, verify:

- rebuilt projects have reasonable segment boundaries
- speaker labels/assignments remain stable enough
- extraction failures are explicitly reported rather than silently guessed

### Checkpoint C: App Parity

After Phase 3, verify:

- editor playback and transcript rendering
- transcript editing
- search/replace
- speaker assignment
- DOCX export
- VTT export

### Checkpoint D: Segment-Only Ingestion

After Phase 4, verify new projects work correctly without any chunk generation.

### Checkpoint E: Schema Removal Gate

Only remove chunk runtime code and schema after all of the following are true:

- all migration-target projects were either rebuilt successfully or explicitly excluded
- editor editing, speaker assignment, search/replace, playback sync, DOCX export, and VTT export all pass on segment-only data
- a few real transcripts were manually checked for single-speaker monologues, multi-speaker interruptions, and same-speaker paragraph transitions
- no normal runtime application behavior still depends on `chunks`

## Guiding Principle

We should stop using consolidation as a repair layer for ingestion mistakes.

If `words` are our atomic source, then the right place to define transcript structure is at segment construction time. Once segments are product-ready and rebuildable, `chunks` become legacy scaffolding and should be removed deliberately and quickly.
