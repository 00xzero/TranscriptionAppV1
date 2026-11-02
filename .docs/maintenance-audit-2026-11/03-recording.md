# Capture, upload & durable in-browser recording

**Scope reviewed:** `frontend/lib/recording/**`, `lib/capture/**`, `components/RecordingSession/**`, `components/CaptureModal/**`, `DiscardRecordingDialog.tsx`, `app/(app)/recording/**`, `app/api/transcripts/route.ts`, `core/transcripts/create.ts`, `infra/supabase/storage.ts`, the two contracts. ~10.6k source lines; ~8.1k test lines.

**Scorecard:**

| Lens | Score | Why |
|---|---|---|
| Maintainability | 3 | Clean adapter seams and good tests; but a flat 17-field runtime mutated from 6 modules, two upload orchestrations, stale "Phase N" scaffolding and docs. |
| Scalability | 2 | Bytes-only budget, browser-default Opus bitrate, whole recording in RAM and IDB, TUS restarts from byte 0, engine length not enforced while recording. |
| Reliability | 3 | Crash recovery is careful (chunk-authoritative, lock-claimed, idempotent create/start); post-failure paths are weak: retry can dead-end, unparsable rows vanish, downgrade is sticky. |
| Performance | 3 | IDB ~2 tx/s and a canvas visualizer are fine; the mic meter re-renders all of CaptureModal at frame rate, and the always-mounted modal re-renders ≥2×/s while recording. |

**Summary:** The durability core holds up and is well contained in `lib/recording`: the write-behind queue, structural chunk validation, Web Locks claim and intent-keyed create/start dedupe. The weak points are what happens after something goes wrong: upload retry, recovery save, schema evolution and multi-hour sessions. The single biggest risk is the live **Retry upload** button. It can fail forever with "resource already exists", and its only other exit is a permanent discard. That is a data-loss path on exactly the flaky networks where people use Retry.

**Findings**

### [P1] Live "Retry upload" can dead-end. The only other exit discards the recording
- Lens: reliability
- Evidence: the live path uploads with `upsert: options.allowUpsert ?? false` (`frontend/lib/capture/upload.ts:414`), while recovery passes `allowUpsert: true` (`frontend/lib/recording/sessionRecovery.ts:222`). An ambiguous link failure plus a failed reconcile keeps both object and row (`frontend/lib/capture/upload.ts:455-461`, asserted by `frontend/__tests__/recording/uploadIdempotency.test.ts:364-391`). On retry, create dedupes to the same transcript and path (`frontend/core/transcripts/create.ts:95,140-143`) with `sourceObjectKey` null, so the upload hits the existing object. Rollback is a no-op (reused transcript, `didUploadFile` false). The error screen offers only Retry or "Return to library", which deletes the local copy (`frontend/app/(app)/recording/new/page.tsx:264-291`; `frontend/components/DiscardRecordingDialog.tsx:7`).
- Why it matters: a network drop between upload and link (or a lost PUT response plus a failed delete call) makes every later Retry fail identically. Only a reload (recovery path, upsert) works, and nothing says so.
- Recommendation: upsert whenever `uploadIntentId` is set (deterministic path inside the transcript's folder); better, merge both upload paths (next finding). Test "retry after object exists".
- Effort: S
- Confidence: high

### [P2] Recovery save is a second, weaker upload path
- Lens: reliability, maintainability
- Evidence: `saveRecovered` calls `runCaptureUpload` with no `onUploadBytes` and no `signal` (`frontend/lib/recording/sessionRecovery.ts:219-225`). It runs behind a blocking, app-wide modal (`frontend/components/RecordingSession/RecoveryModal.tsx:102-110`) whose Discard is one click with no confirmation (`:90-99,184`), unlike the live discard (`frontend/components/RecordingSession/RecordingControls.tsx:107-117`). The finalized File can be downloaded only from `AccountChangedScreen` (`frontend/components/AccountChangedScreen.tsx:91`).
- Why it matters: recovering a 500 MB recording means minutes of "Saving…" with no progress and no cancel. A misclick loses the recording.
- Recommendation: hydrate `finalizedRecording` from IDB chunks, `markUploading`, reuse `submitFinalizedRecording` — one orchestration with progress, pill, retry and unload guard. Confirm discard; add "Save a copy" to error and recovery UIs.
- Effort: M
- Confidence: high

### [P2] IDB rows that fail the current schema are invisible to recovery and never garbage-collected
- Lens: reliability, scalability
- Evidence: `getSession` and `listSessions` silently drop rows that fail `PersistedSessionSchema` (`frontend/lib/recording/persistence/indexedDb.ts:113,124`). Both GC (`frontend/lib/recording/persistence/gc.ts:55-56`) and the probe (`frontend/lib/recording/recovery.ts:88-90`) only see parsed rows. The schema embeds strict enums (`frontend/contracts/transcription-options.ts:29,59-61`; `codecExtension` at `frontend/lib/recording/persistence/types.ts:27`).
- Why it matters: dropping a language/engine (CLAUDE.md: "schemas can change shape") orphans every row of that shape: the recording is silently lost and its chunks (up to 500 MB) stay in quota forever, later pushing new recordings to `durable=false`.
- Recommendation: run GC on raw rows (cursor over `createdAt`), and parse leniently for recovery, requiring only the fields needed to assemble the file. Add a test.
- Effort: S
- Confidence: high

### [P2] Long recordings: bytes-only budget, uncontrolled bitrate, engine length not enforced
- Lens: scalability
- Evidence: auto-stop is based on bytes only (`frontend/lib/recording/sessionActions.ts:376-381`, `frontend/lib/recording/sizeBudget.ts:29-32`), with `maxBytes = MAX_FILE_SIZE_BYTES` (`frontend/components/CaptureModal/CaptureModal.tsx:244`; 500 MB per `frontend/.env.example:22`). Opus is left at the browser default (`frontend/lib/recording/codecs.ts:56-60`). Soniox caps at 300 min (`frontend/core/transcription/engines/capabilities.ts:45`), which is checked only at prepare time (`frontend/lib/inngest/functions/handle-media-prepare.ts:140-143`), and the message says "Upload it again" (`capabilities.ts:123`).
- Why it matters: a 5h+ Soniox recording is captured, uploaded and then refused. The local copy is already deleted on submit, so "upload again" is impossible.
- Recommendation: pass the engine's `maxDurationSeconds` into `attachAndStart` as an active-time cap, with a banner and auto-stop. Set the Opus `audioBitsPerSecond` to about 32–48 kbps. Prepare keeps Opus at any bitrate (`frontend/core/media/prepare-policy.ts:94-102`), and a lower rate cuts RAM, IDB and upload by 3–4×.
- Effort: S
- Confidence: high

### [P2] The whole recording is held in RAM as well as in IndexedDB
- Lens: scalability, performance
- Evidence: `store.runtime.chunks.push(blob)` (`frontend/lib/recording/sessionActions.ts:348`), the File assembled from memory (`:316-321`), and the File kept through an error state (`:327-333`, `frontend/lib/recording/sessionUpload.ts:107-114`).
- Why it matters: hundreds of MB of Blob memory build up over 3–5 h. On iOS Safari this invites a WebContent kill mid-meeting. How Blobs are paged to disk varies by browser.
- Recommendation: once a chunk's IDB put succeeds, drop the in-memory reference (have the queue call `onPersisted(seq)`). At stop, `await whenSettled()` and assemble from `readChunks`, which returns disk-backed handles, plus the in-memory tail. Keep everything in memory only when `!durable`.
- Effort: M
- Confidence: medium

### [P2] TUS has a ~9 s retry budget, fails when the browser goes offline, and never resumes
- Lens: scalability, reliability
- Evidence: `retryDelays: [0, 1000, 3000, 5000]` (`frontend/lib/capture/storageTransfer.ts:122`). tus-js-client does not retry while `navigator.onLine` is false (`frontend/node_modules/tus-js-client/lib.es5/upload.js:1548`). Resume is "intentionally not wired up" (`storageTransfer.ts:51`), yet fingerprints are still written to localStorage (default `storeFingerprintForResuming`) and never read.
- Why it matters: a Wi-Fi handoff 400 MB into a 500 MB upload fails, and Retry restarts from zero.
- Recommendation: use exponential backoff out to about 2 min, wait for `online` before failing, and resume through `findPreviousUploads()` (recording paths are deterministic). For recordings, retry automatically on reconnect.
- Effort: M
- Confidence: high

### [P2] IndexedDB connection loss causes a permanent downgrade for the session
- Lens: reliability
- Evidence: the memoized `dbPromise` has no `onclose` or `onversionchange` handler (`frontend/lib/recording/persistence/indexedDb.ts:52-82`). The first failure downgrades for good (`frontend/lib/recording/persistence/writeQueue.ts:155-180`).
- Why it matters: a closed connection (WebKit drops it after backgrounding, or a future `DB_VERSION` bump in another tab) turns off crash protection for the rest of a long recording, even though reopening would work.
- Recommendation: on `close`/`versionchange`/`InvalidStateError`, clear `dbPromise` and retry the operation once before downgrading.
- Effort: S
- Confidence: medium

### [P2] Render cost: frame-rate mic meter and full-snapshot subscriptions
- Lens: performance
- Evidence: `setLevel` inside a rAF loop (`frontend/lib/recording/useMicTest.ts:198-211`), with the hook mounted at the root of `CaptureModal` (`frontend/components/CaptureModal/CaptureModal.tsx:70`) and no `memo` anywhere in `components/CaptureModal`. The always-mounted modal subscribes to the full snapshot (`CaptureModal.tsx:63`), which changes every tick (`frontend/lib/recording/sessionStore.ts:67-81`) and on every chunk (`frontend/lib/recording/sessionActions.ts:370-374`). `useRecordingState` also re-renders on every tick (`frontend/lib/recording/RecordingSessionContext.tsx:198-200`).
- Why it matters: dialog, tabs, form and advanced options re-render up to 60×/s during a mic test, ~2×/s app-wide while recording.
- Recommendation: give the meter its own small component that reads a ref or level store (or draws to canvas). Add a selector hook (`useRecordingSelector(s => isRecordingSessionActive(s))`).
- Effort: S
- Confidence: high

### [P2] File-upload capture has no unload guard, no cancel and no idempotency
- Lens: reliability
- Evidence: `useCapture` passes neither `signal` nor `uploadIntentId` (`frontend/lib/capture/useCapture.ts:67-76`). The only `beforeunload` guard is tied to the recording session (`frontend/lib/recording/RecordingSessionContext.tsx:78`).
- Why it matters: a reload during a 500 MB upload silently loses it and leaves a `created` transcript row with no media.
- Recommendation: install the unload guard while `isUploading`, add a Cancel button that wires an AbortController, and send a per-attempt `upload_intent_id`.
- Effort: S
- Confidence: high

### [P3] Layering: `core/transcripts/create.ts` does I/O, and `storage.ts` mixes client and server code
- Lens: maintainability
- Evidence: Supabase queries and inserts in core (`frontend/core/transcripts/create.ts:106-111,117-128,165-167`), and imports of `lib/` and `infra/` (`create.ts:10-11`). Client components import `infra/supabase/storage.ts` (`frontend/components/CaptureModal/CaptureModal.tsx:21`, `frontend/app/(app)/recording/new/page.tsx:16`), which also holds server-only proxy and secret logic (`frontend/infra/supabase/storage.ts:101-129`).
- Recommendation: move the orchestration to `lib/transcripts/create.server.ts` and keep `recordedOptions`/`buildResult` in core. Split out a client-safe `storage-paths.ts`.
- Effort: S
- Confidence: high

### [P3] The runtime is a flat bag with resets duplicated in three places, plus dev mocks in the production store
- Lens: maintainability
- Evidence: the same 7–9 persistence fields are reset in `frontend/lib/recording/sessionActions.ts:199-209`, `frontend/lib/recording/sessionRuntime.ts:63-71` and `:85-91` (type at `frontend/lib/recording/sessionTypes.ts:93-120`). `mockLifecycleTimeoutIds` is cleared in production transitions (`frontend/lib/recording/sessionCore.ts:228-234`), and `startMock`/`forceState` are exported from the production barrel (`frontend/lib/recording/session.ts:61-62`).
- Why it matters: adding a runtime field means editing three resets, and missing one leaks state between sessions.
- Recommendation: use `runtime.live: LiveSession | null`, created in `attachAndStart`, so teardown becomes `live = null`. Move the dev mock behind its own module.
- Effort: M
- Confidence: high

**Quick wins:**
- Set `upsert: true` whenever `uploadIntentId` is set (P1).
- Add a discard confirmation and "Save a copy" to `RecoveryModal` and the error state.
- Run GC on raw IDB rows; parse leniently for recovery.
- Set an Opus bitrate and enforce the engine duration cap during recording.
- Isolate the mic-meter state; add a snapshot selector hook.

**Zero-in candidates:**
1. **Post-failure upload flows.** Merge live and recovery save into one state-machine path with resumable TUS, retry on reconnect and an export escape hatch. Most of the real data-loss risk lives here.
2. **Simplifying durability.** Queue, recovery, validation and locks earn their size. Cut candidates: presence (heartbeat, staleness, 2 s lock polling, keyed lock results; ~600 lines with the publisher) — owner loss can be detected by queuing on the owner lock instead; the no-Web-Locks heuristic (`lock/noWebLocks.ts`); multi-orphan chaining (the design promises at most one orphan).
3. **Multi-hour memory and render profile.** Run real 3–5 h sessions on iOS Safari and Firefox to measure heap, IDB throughput (two readwrite transactions per chunk) and re-render rate.

**Test coverage notes:** Strong: `__tests__/recording/` (`session.test.ts` 1,387 lines, `persistence/*`, `recovery`, `uploadIdempotency`, `ownerLock`, `webLocksMutex`, `presence`, `remotePresence`, `heartbeat`, `captureHealth`, `salvagePolicy`, `ownerLossRecovery`), `capture/storageTransfer.test.ts`, `transcriptsUploadIdempotency.test.ts`, `createTranscript.test.ts`. Gaps: retry after the object exists; unparsable rows; IDB reopen after connection loss; TUS offline; engine duration cap; no direct `useMicTest` unit test (only via mocked UI tests). Fakes/noops match the real adapters (`implements` + behaviour); one drift: `InMemorySessionPersistence` skips the schema parse and transform that `IndexedDBSessionPersistence` applies (`persistence/inMemory.ts:35-42` vs `indexedDb.ts:107-126`).

**Cross-domain notes:**
- POST `/api/transcripts` has no rate limit (`frontend/app/api/transcripts/route.ts`). Only sign-in and start are limited.
- Nothing reaps `created` transcripts that never got media (`frontend/lib/inngest/functions/handle-transcription-timeouts.ts` covers jobs only).
- CLAUDE.md says guards "block navigation mid-recording"; `frontend/lib/recording/guardedNavigation.tsx:8-13` lets it through — it is editor/navigation glue now.
- Docs drift: `.docs/audio-durability-design.md:5` "not yet implemented"; `.docs/durable-app-level-recording-design.md:6-9` lists shipped presence as a later phase; 25 stale "Phase N" comments.

**Open questions:**
- Does Supabase TUS refuse a new create while an unfinished upload for the same object exists (409/423)? If so, TUS retries are blocked too.
- Does desktop Chrome fire track `mute` on OS mic toggles/device contention? If so, the 3 s sustained-mute rule (`frontend/lib/recording/recorderController.ts:36,138-147`) auto-submits a recording mid-session.
- A non-owner tab's `markError`/`resetRecordingSession` clears presence unconditionally (`frontend/lib/recording/sessionCore.ts:112-117,186-189`); likely only a 2 s flicker.

**What's good:**
- Chunk-authoritative recovery: `seq=0` plus contiguity plus byte floor, and a metadata-only `chunkStats` on the probe hot path.
- `SessionWriteQueue`: synchronous enqueue, FIFO, sticky downgrade, and `closeAndDelete` ordered after in-flight writes.
- Idempotency that holds end to end: a deterministic filename from `uploadIntentId`, create dedupe with a 23505 re-read, and `start:<intent>` keys.
- `WebLocksMutex` shared by both locks, with an `ifAvailable` claim and a conservative policy when a query fails.
