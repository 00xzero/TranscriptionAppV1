# Durable App-Level Recording Implementation Plan

## Status

Phases 1-4 implemented in the current branch:

- Phase 1: IndexedDB durability foundation and write-behind persistence.
- Phase 2: recovery, user-scoped upload idempotency, and the minimal session lock
  seam needed to keep recovery claims from racing live sessions.
- Phase 3: app-level recording lifecycle — in-app navigation is always allowed,
  the `beforeunload` guard moved to `RecordingSessionProvider` and stays through
  upload completion, sign-out is guarded by `hasUnresolvedRecordingArtifact`, the
  `durable` and `captureHealthWarning` session-snapshot signals drive passive
  page warnings, and the recording pill stays reachable across every unresolved
  state.
- Phase 4: same-browser ownership and presence — a global per-browser owner Web
  Lock (`recording:owner`) blocks duplicate starts, a `RecordingPresence` adapter
  (BroadcastChannel + localStorage) publishes a 2s owner heartbeat across the
  active lifecycle, and a `useRemotePresence` read model drives a remote pill,
  remote `/recording/new` page state, capture-modal disabling, and owner-loss →
  recovery (single side effect in the provider).

Phase 5 remains planned: global pill/product polish (hover/focus preview,
terminal animations, polished pill variants, a11y/QA, Safari MP4 spike).

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
- Reserve `userId` and `uploadIntentId` as nullable `sessions` fields, left null
  and populated in Phase 2.
- Retain the existing `sessionStorage` draft (dual-write the same metadata); full
  migration into the IDB `sessions` record is deferred to Phase 2.
- Track armed/available state internally only (write-behind queue + persisted
  row). Surfacing the unarmed warning — including the durability-unavailable case —
  is deferred to Phase 3.
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
- Populate the session `userId` from the authenticated context.
- Migrate the session draft from `sessionStorage` fully into the IDB `sessions`
  record (replacing the Phase 1 dual-write).
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
- Minimal `SessionLock` adapter:
  - Web Locks where available;
  - degraded chunk-freshness fallback where Web Locks are unavailable;
  - protects live sessions from being claimed as recoverable;
  - lets exactly one tab claim a recoverable orphan.
- Remove the old `sessionStorage` draft and `recoverInterruptedDraft` restart
  flow. In this phase, `interrupted` means unrecoverable and returns the user to
  the library.
- Keep recovery chunk-authoritative. `armed`/`failureReason` remain internal or
  diagnostic signals and do not suppress recovery in this phase.
- Recovery modal shows approximate recovered size, not duration.
- Recovery probing runs once per resolved authenticated user, with
  `attachAndStart` re-probing as a final backstop. The app shell does not gate on
  the probe, and there is no explicit one-retry-on-IDB-open-failure behavior in
  this phase.

Exit criteria:

- Valid persisted recordings can be recovered after reload/crash.
- Invalid chunk streams are rejected.
- Recovery save does not create duplicate projects.
- Unresolved recovery blocks starting a new recording.
- Multiple valid orphans are handled defensively by showing the newest first and
  chaining to the next after save/discard.

## Phase 3: App-Level Recording Lifecycle

Goal: make recording truly survive normal app navigation.

Status: implemented in the current branch. The in-app navigation guards
(`GuardedLink`, `useGuardedNavigate`) are now thin pass-throughs that never
prompt or discard; the `usePopStateGuard`/`confirmBeforeLeave` route-bound flow
was removed. `useBeforeUnloadGuard(active)` takes its active flag as an argument
and is installed once in `RecordingSessionProvider`. Capture health is a
tick-driven watchdog (`checkCaptureHealth`) registered via a `setTickObserver`
seam. Durability is surfaced through the `durable` snapshot field, seeded up
front from `SessionPersistence.durable` and flipped by the write queue's
`onDowngrade` callback.

Includes:

- Remove route-bound assumptions from recording lifecycle.
- In-app navigation always allowed while recording.
- `beforeunload` warning remains through upload completion.
- Sign-out/account/workspace boundary guard.
- `/recording/new` becomes expanded surface, not lifecycle owner.
- Retryable upload error remains an unresolved artifact.
- Capture-health handling for stale chunks while owner tab is alive.
- Unarmed warning behavior:
  - covers both mid-session downgrade and durability-unavailable-from-start;
  - requires surfacing the write-behind queue's armed/available state to the
    session snapshot (the foundation tracks it internally only);
  - recording still allowed;
  - roaming still allowed;
  - warning appears on the `/recording/new` page; the hover/focus pill preview
    that the design also names as a warning surface is deferred to Phase 5;
  - full unload remains guarded.

Exit criteria:

- User can leave `/recording/new` and recording continues.
- Active, recoverable, and retryable artifacts block auth/context exits.
- Upload, error, and recovery states remain reachable after navigation.

## Phase 4: Same-Browser Ownership and Presence

Goal: make multiple tabs in the same browser behave coherently.

Status: implemented in the current branch. The global owner mutex is a separate
`BrowserOwnerLock` seam (`lib/recording/lock/owner*.ts`) on a fixed
`recording:owner` Web Lock, acquired in `attachAndStart` before the per-session
lock; a failed acquire throws `RemoteRecordingActiveError`. Presence is a thin
`RecordingPresenceChannel` adapter (`lib/recording/presence/`) over
BroadcastChannel + localStorage, published from `sessionActions` on every active
transition and on a 2s heartbeat driven by the (now generalized, multi-observer)
1s tick — which required keeping the interval alive through
paused/finalizing/uploading. Same-browser coordination requires the Web Locks
API: when it is absent there is no trustworthy cross-tab mutex, so both the owner
lock (`NoopOwnerLock`) and presence (`NoopPresence`) degrade to no-ops as a unit —
single-tab recording still works everywhere; the only loss is duplicate-start
blocking and the remote UI. Remote consumption is a pure `useRemotePresence` hook whose
status is shared via `RemotePresenceContext`; the owner-loss → `runRecoveryProbe`
side effect runs once in `RecordingSessionProvider`. Terminal/interrupted cleanup
clears presence after IDB teardown and before releasing the owner/session locks.

Includes:

- Extend the Phase 2 `SessionLock` seam into full same-browser coordination.
- Consider adding a global per-browser recording mutex or equivalent duplicate
  start detector. The Phase 2 lock is per-session and does not block a separate
  new recording in another tab.
- Same-browser coordination requires the Web Locks API. When it is absent there
  is no trustworthy cross-tab mutex, so the owner lock (`NoopOwnerLock`) and
  presence (`NoopPresence`) degrade to no-ops as a unit — single-tab recording
  still works everywhere; only duplicate-start blocking and the remote UI are
  lost. (An earlier plan to emulate degraded awareness with heartbeats was
  dropped; see the design doc's Presence Model note.)
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
