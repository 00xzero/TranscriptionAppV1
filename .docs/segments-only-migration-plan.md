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
- speed of implementation matters more than migration ceremony
- there are effectively no production users to support through a long dual-mode rollout

## Why We Are Doing This

The old `chunks` layer existed largely to repair transcript boundaries after ingestion. Now that we are defining transcript structure ourselves, `segments` should become the canonical unit and `chunks` should be removed.

That means:

- transcript readability should be defined at segment construction time
- editor and export should read the same canonical transcript unit
- the system should be easier to reason about once `chunks` are gone

## Current State

Today, `chunks` are still load-bearing in three areas:

1. Ingestion pipeline
- `handle-transcription-webhook.ts` stores `segments`, then runs consolidation to generate `chunks`

2. Editor data flow
- the editor prefers `chunks` and treats raw `segments` as a degraded mode with editing disabled

3. Export and reporting
- export routes and helper code currently read from `chunks`

## Target State

- `words` remain the atomic timing/alignment layer
- `words` also store normalized metadata useful for future rebuilds
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

These values should live in one versioned builder config.

### Editing and Export Behavior

- `segments` must support transcript editing directly
- find/replace must operate on `segments`
- DOCX export must preserve current readability and speaker-turn presentation
- VTT export should emit one cue per canonical segment unless we later find a concrete captioning reason to merge

### Metadata Rules

Segments should carry the minimum metadata needed to preserve current behavior and support debugging:

- `is_edited`
- `algo_version`

We do **not** need to carry chunk-era lineage such as `source_segment_ids` into canonical segments.

### Words Metadata Enrichment

We are keeping normalized metadata enrichment on `words` because it is useful future-safe infrastructure even if we do not build a formal rebuild system right now.

That means new ingestions should persist normalized per-word metadata such as:

- speaker information
- paragraph grouping or boundary hints
- sentence grouping or sentence-end hints

This should stay provider-agnostic where practical.

### Rollout Strategy

Because speed is the priority:

- use one shared, versioned segment builder
- switch the app globally once segment-first behavior is ready
- handle existing projects with the simplest practical migration path
- avoid building heavy migration infrastructure unless we actually need it

## Phase 1: Build Canonical Segments At Ingestion

### Objective

Make newly created `segments` good enough to stand on their own and become the future canonical transcript unit.

### Work

- Extract transcript construction into a dedicated shared module under `frontend/core/transcript/`
- Build one shared, versioned segment builder
- Build canonical segments from normalized paragraph/sentence/word metadata
- Encode the agreed segmentation rules:
  - break on paragraph boundary
  - break on speaker change
  - break on silence gap `> 2000ms`
  - break when segment duration exceeds `15000ms`
  - prefer sentence-boundary endings around `~60` words when possible
- Ensure the builder degrades gracefully when paragraph metadata is missing or partial
- Update ingestion to persist normalized rebuild metadata on `words`
- Keep consolidation temporarily only if it reduces implementation risk while the app still reads `chunks`

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

- New transcriptions produce readable canonical `segments`
- The shared builder is used at ingestion
- `words` enrichment is being persisted

## Phase 2: Switch The App To Segments

### Objective

Make `segments` the primary transcript source in the app.

### Work

- Update transcript queries to prefer `segments`
- Remove or simplify source-selection logic in the editor
- Enable transcript editing on `segments`
- Enable find/replace on `segments`
- Update speaker assignment flows to treat `segments` as the normal editable unit
- Update DOCX and VTT export loaders to read from `segments`
- Preserve current export readability and speaker-turn presentation
- Remove UX that only exists to explain a degraded raw-segment mode
- For existing projects, use the simplest practical migration path:
  - re-run transcription if that is easiest
  - otherwise use a one-off script if needed
- Do **not** build generalized extraction, audit, or reporting infrastructure unless real migration pain appears

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
- existing projects needed for verification are accessible in segment-first mode

## Phase 3: Delete Chunks

### Objective

Remove chunk generation, runtime chunk code, and chunk schema once the app is already segment-first.

### Work

- Remove the consolidation step from `handle-transcription-webhook.ts`
- Stop generating new `chunks` and `chunk_words`
- Remove `consolidation.ts`
- Remove `consolidation-service.ts`
- Remove chunk-related query helpers, hooks, scripts, tests, and subscriptions
- Remove chunk schemas/contracts from the frontend
- Drop:
  - `chunk_words`
  - `chunks`
  - `save_consolidated_chunks`
  - related indexes, policies, and grants
- Remove chunk references from seed data and docs

### Exit Criteria

- No runtime application behavior depends on `chunks` or `chunk_words`
- New transcriptions complete successfully using only:
  - `segments`
  - `words`
  - `speakers`
- The schema reflects the new mental model:
  - `projects`
  - `segments`
  - `words`
  - `speakers`
  - `jobs`

## Recommended Order

1. Land the shared canonical segment builder and words enrichment
2. Keep consolidation only as temporary compatibility scaffolding if needed
3. Switch editor and exports to `segments`
4. Migrate or regenerate any old projects that still matter
5. Remove chunk generation and delete chunk code/schema

## Validation Checkpoints

### Checkpoint A: Builder Quality

After Phase 1, inspect a few real transcripts manually and compare:

- segment count
- readability
- speaker continuity
- long monologue behavior
- same-speaker paragraph behavior

### Checkpoint B: App Parity

After Phase 2, verify:

- editor playback and transcript rendering
- transcript editing
- search/replace
- speaker assignment
- DOCX export
- VTT export

### Checkpoint C: Deletion Gate

Only delete chunk code and schema after:

- segment-first editor behavior is working
- segment-first export behavior is working
- a few real transcripts have been manually checked
- any old projects that still matter have been retranscribed or otherwise made usable

## Guiding Principle

We should stop using consolidation as a repair layer for ingestion mistakes.

If `words` are our atomic source, then the right place to define transcript structure is at segment construction time. Once segments are product-ready and the app is segment-first, `chunks` should be removed quickly rather than maintained as legacy scaffolding.
