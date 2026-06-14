# Durable App-Level Recording Implementation Plan

## Status

Planned; not yet implemented.

This plan complements
[`durable-app-level-recording-design.md`](./durable-app-level-recording-design.md).
The design doc is the product and architecture source of truth; this document is
the build sequence.

## Build Strategy

Implement the feature in four main phases plus one polish and hardening phase.
Each phase should leave the app in a coherent state with focused tests, so the
work can be reviewed and shipped incrementally.

## Phase 1: Durability Foundation

Goal: mirror live recording data locally without changing the user experience
much.

Includes:

- `SessionPersistence` interface.
- IndexedDB `sessions` and `chunks` stores.
- Raw `Blob` chunk writes.
- Sequence numbering, including required `seq = 0`.
- Contiguous `0..N` validation helpers.
- Metadata persistence:
  - title;
  - codec;
  - bytes;
  - timing;
  - phase;
  - `lastChunkSeq`;
  - `lastChunkReceivedAt`.
- Write-behind queue.
- Sticky downgrade on write/quota failure.
- `navigator.storage.persist()` where available.
- 7-day GC.
- Test adapters and `fake-indexeddb` coverage.

Exit criteria:

- Recording still works as today.
- Chunks and metadata are mirrored to IndexedDB.
- Persistence failure never stops live recording.
- Structural validation can tell valid from invalid recoveries.

## Phase 2: Recovery and Upload Idempotency

Goal: make local durability useful and safe.

Includes:

- Client-generated `uploadIntentId`.
- Persist upload intent with the session.
- Server-side dedup by `(userId, uploadIntentId)`.
- Repeated project/create returns the canonical result.
- Recovery probe in `RecordingSessionProvider`.
- `recoverable` state.
- Blocking global recovery modal.
- Title edit in recovery modal.
- Save/transcribe recovered audio.
- Discard recovered audio.
- Offline recovery behavior.
- Below-floor cleanup.
- Newest-first multiple-orphan handling.
- `/recording/new` recoverable state.

Exit criteria:

- Valid persisted recordings can be recovered after reload/crash.
- Invalid chunk streams are rejected.
- Recovery save does not create duplicate projects.
- Unresolved recovery blocks starting a new recording.

## Phase 3: App-Level Recording Lifecycle

Goal: make recording truly survive normal app navigation.

Includes:

- Remove route-bound assumptions from recording lifecycle.
- In-app navigation always allowed while recording.
- `beforeunload` warning remains through upload completion.
- Sign-out/account/workspace boundary guard.
- `/recording/new` becomes expanded surface, not lifecycle owner.
- Retryable upload error remains an unresolved artifact.
- Capture-health handling for stale chunks while owner tab is alive.
- Unarmed warning behavior:
  - recording still allowed;
  - roaming still allowed;
  - warning appears in preview/page;
  - full unload remains guarded.

Exit criteria:

- User can leave `/recording/new` and recording continues.
- Active, recoverable, and retryable artifacts block auth/context exits.
- Upload, error, and recovery states remain reachable after navigation.

## Phase 4: Same-Browser Ownership and Presence

Goal: make multiple tabs in the same browser behave coherently.

Includes:

- `SessionLock` adapter using Web Locks.
- Degraded heartbeat-only fallback when Web Locks are unavailable.
- `RecordingPresence` adapter using BroadcastChannel and localStorage.
- Owner heartbeat every 2 seconds.
- Stale after 15 seconds plus lock confirmation.
- Remote active state.
- Remote `/recording/new` page state.
- Duplicate-start blocking across same-browser tabs.
- Owner-loss detection.
- Tab B can recover sealed chunks after Tab A dies.
- Lock-only generic remote state.

Exit criteria:

- Second same-browser tab cannot start a duplicate recording.
- Non-owner tabs show "Recording in another tab."
- Non-owner tabs cannot control the live recorder.
- Owner loss transitions to recovery when valid chunks exist.

## Phase 5: Product Polish and QA

Goal: make the feature feel finished and harden browser edge cases.

Includes:

- Local recording pill.
- Remote recording pill.
- Recoverable pill.
- Uploading/finalizing/error pill.
- Saved/discarded terminal animations.
- Hover/focus informational preview.
- Mobile/desktop click behavior.
- Reduced-motion support.
- Visual/accessibility QA.
- Manual crash/reload checks.
- Safari MP4 spike result integration.
- Private mode/quota/offline testing.
- Mobile browser behavior checks.

Exit criteria:

- Global recording status feels native to the app.
- All terminal, recovery, and error states are understandable.
- Core flows pass Chrome/Safari/manual QA.

## Suggested Review Boundaries

Use the phases above as review boundaries by default. If a phase grows too large,
split by adapter boundary rather than by UI state:

- persistence schema and validation;
- write-behind session integration;
- upload idempotency;
- recovery UI;
- app-level navigation guards;
- same-browser ownership;
- global pill polish.

This keeps each review focused on one architectural seam while preserving the
larger five-phase delivery plan.
