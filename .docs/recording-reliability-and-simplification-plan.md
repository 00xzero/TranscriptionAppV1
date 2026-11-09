# Recording reliability and simplification

**Status** — Codex and Claude agree on scope and sequencing. Claude approved
the revised plan with no blockers. The integration branch and
[baseline](reviews/recording-reliability-baseline.md) are in place.
Implementation starts separately.

## Delivery

Use the editor feature's delivery model. The integration branch
`codex/recording-reliability-and-simplification` starts from `main` at
`5a02579`. Its baseline commit records this plan, the review decisions and
the checks on unchanged application code. Each delivery branch starts at the latest integration tip
after its predecessor merges and opens against the integration branch. Use
separate commits within a PR where that makes risk and verification easier to
review.

| PR | Head | Scope |
| --- | --- | --- |
| 1 | `codex/recording-reliability-pr1` | Duration guard, safe recovery and one recording submission flow |
| 2 | `codex/recording-reliability-pr2` | Local durability and long-session behavior |
| 3 | `codex/recording-reliability-pr3` | Resumable transfer and file-upload lifecycle |
| Integration | `codex/recording-reliability-and-simplification` | Final verification and one feature changelog entry before merging to `main` |

### Baseline and shared rules

- Reviewed source at `5a02579`. The original existing-object Retry bug is fixed
  by `f65dfb5`. The baseline records the 55 focused tests, full checks and
  production-browser smoke with synthetic services. Keep mock, real-browser
  local and hosted results distinct.
- Record local browser behavior for stop, live retry, reload recovery, saved
  media with failed or ambiguous start, file upload and account switch. Capture
  current render counts and a short production-build memory and byte-rate
  sample. Use disposable accounts, a throwaway project and synthetic media.
  Fault-inject transfers and writes at controlled boundaries. Clean up only
  fixtures created for verification. Keep provider calls mocked for transfer
  fault tests.
- Keep the original internal account UUID on each attempt. Preserve
  account-bound API requests, per-request Storage tokens, RLS, intent-keyed
  create/start, source-link reconciliation and existing project-deletion guards.
  Recordings may roam in-app. Keep the sign-out and unload protections.
- Keep a distinction between audio still local, media durably linked with
  transcription needing attention, and a start whose result is unknown.
  Finish a local recording after confirmed media handoff or explicit discard.
  Never interpret a timeout alone as permission to delete linked media or
  create another job. Keep the current successful-create project fallback and
  surface its warning. An existing transcript keeps its existing options and
  project assignment on retry.
- For each PR, run changed-file lint, typecheck, targeted tests and the browser
  checks specified below. At integration run full Jest, lint, typecheck and
  production build. Attach UI captures and the before/after evidence with
  coverage limits. Hosted checks use a separately authorized test environment.

## PR 1 — Duration guard, safe recovery and one recording submission flow

1. **First implementation commit — warn and stop at the selected engine's
   duration limit.** Use `ENGINE_CAPABILITIES` in
   `frontend/core/transcription/engines/capabilities.ts` and resolve the
   options selected in `CaptureModal.tsx` at `attachAndStart` in
   `frontend/lib/recording/sessionActions.ts`. Use the existing
   `getElapsedActiveMs` and tick observer, with checks on chunk delivery and
   resume so a delayed timer cannot be the sole trigger. Use a warning and
   stop threshold with headroom for final chunks. Show the stop reason on
   `app/(app)/recording/new/page.tsx`, reusing the existing budget/status UI.
   Route both limits through single-flight `stopAndFinalize`; keep the byte
   limit and the server's measured duration check authoritative. Agree the
   warning and stop interaction before coding this commit. Validate
   pause/resume, delayed ticks and actual recorded duration with a shortened
   test budget. Active time is a browser estimate, particularly after
   suspension, and the guard applies to new live recordings.
2. **Add export and confirmed discard.** Use `getFinalizedRecordingFile` in
   `sessionUpload.ts` for the retryable error screen and a shared file builder
   with `saveRecovered` in `sessionRecovery.ts` for
   `components/RecordingSession/RecoveryModal.tsx`. Reuse
   `DiscardRecordingDialog`. Export is local-only, user-initiated and retains
   the app's copy. On account change, hide the recovery dialog and invalidate
   pending actions. `RecordingSessionContext.tsx` must check the account-change
   state as well as the UUID. Gate probe, save, discard and export at action
   boundaries. Recheck after awaits before a new user action, download,
   chaining or navigation. Stop new work on the frozen page and let in-flight
   work settle under its original owner. If the media link was confirmed,
   finish local cleanup for that same claimed row, or persist the cleanup-only
   marker if deletion must be retried. A known link is sufficient even when
   the start outcome is unknown. If the link is unconfirmed, retain the row
   and audio for the original account's next sign-in. Release only that
   claim after settlement. A discard transaction committed before the
   switch stands. Keep `AccountChangedScreen.tsx`'s memory-only export scoped
   to the stopped page.
3. **Share recording submission and split save from cleanup.** In
   `sessionUpload.ts` and `sessionRecovery.ts`, share single-flight
   execution, progress and outcomes for live stop, live retry and recovery.
   Use `sessionCore.ts` and `sessionTransitions.ts` to keep live queue teardown
   and recovered-row cleanup distinct. Keep the recovered row and claim while
   it uploads or retries. Store a cleanup-only outcome after confirmed media
   handoff and before deleting the local copy. On the next load, the
   original account's recovery probe quietly retries deletion under the
   claim. A marked row stays out of the recovery dialog even if deletion
   fails again. Keep the marker for a later sweep and continue to other
   recoverable rows. Cleanup retry never calls capture upload. If neither
   marker nor deletion can be persisted, retrying the same intent can
   reconcile the original start. Remove the automatic fresh-key fallback
   from `dispatchStart` in `frontend/lib/capture/upload.ts` for all capture
   submissions carrying an upload intent, including file uploads once
   PR 3 assigns them one. Report saved media needing attention and leave a
   new job to the explicit library **Transcribe** action. Keep normal
   replay of the original key for an ambiguous start.
4. **Require the saved upload intent for recovery submission.** Before
   `saveRecovered` calls `runCaptureUpload`, require a valid persisted
   `uploadIntentId` and reuse it for filename, create and start. An otherwise
   recoverable row with a missing or invalid intent is export-only, with
   explicit discard still available. Normal captures have persisted the
   intent since `4cbd0bc` and the normal retention window is seven days.
   Avoid a backfill and the timestamp filename fallback. Cover null IDs
   accepted by today's schema and carry this rule into PR 2's compatibility
   reader.
5. **Show progress and handle cancel.** Pass progress and the existing upload
   signal from the shared submission path to `RecoveryModal.tsx` and
   `useBeforeUnloadGuard`. Allow cancel before linking, preserving audio
   and returning to a retryable state. Once link begins, disable cancel and
   let reconciliation finish. Small single-PUT uploads cannot be interrupted
   in flight. Gate cancellation accordingly and keep the unload guard until
   settlement. Recovered uploads must not publish themselves as live
   microphone owners.

| Reuse | Extension |
| --- | --- |
| `ENGINE_CAPABILITIES`, active elapsed time, size budget and finalize path | Duration warning and stop alongside bytes |
| `DiscardRecordingDialog`, `getFinalizedRecordingFile`, `AccountChangedScreen` download behavior | Shared confirmation and local export with bounded URL lifetime |
| `runCaptureUpload`, `submitFinalizedRecording`, `saveRecovered`, `useBeforeUnloadGuard` | Common progress/outcomes and account-bound actions |
| Existing intent field, queue teardown, recovery claim and chaining | Require persisted intent and quietly retry marked cleanup under the claim |

**Acceptance.** Cover both duration and byte limits, pause/resume, delayed
ticks and final chunks. Export and retry after failed link, offline and failed
export. With Web Locks, two tabs cannot submit one orphan concurrently. Cover
export-only recovery for missing intent, cancel before link, lost link or
start response, a prior job that errors after save, cleanup failure with
repeated clicks and reload, deleted/deleting project, and account change
before or during save, discard or export. Verify the original account sees
unconfirmed audio on next sign-in, while a confirmed save is cleaned up or
marked for quiet cleanup. Keep the existing Retry regression. Verify one
canonical transcript and no new job from cleanup retry or capture replay of
an errored start. For a recovered save, show the same outcome-specific notice
as live capture for both `saved_needs_retry` and `saved_status_unknown`,
including on other app routes and when recovery chains to the next recording.
Verify the degraded lock fallback separately.

## PR 2 — Local durability and long-session behavior

1. Split `PersistedSessionSchema` in
   `frontend/lib/recording/persistence/types.ts` and
   `probeRecoverableSessions` in `recovery.ts` so compatibility for audio is
   independent of current transcription options. Require the original owner,
   stable session identity and a valid, readable chunk stream. Retain supported
   legacy defaults and PR 1's persisted intent rule. Where options are no
   longer valid, offer export and require explicit valid options for a new
   transcript. If the intent has a canonical transcript with fixed options,
   surface that outcome and preserve audio. An unknown codec alone must
   never trigger deletion in the probe. Offer export-only for otherwise
   recoverable audio with an unknown codec. Export the original bytes
   with a neutral filename and explain that the format is unknown.
   Explicit discard and the ordinary seven-day retention policy still apply.
2. Sweep expired rows in `persistence/gc.ts` and `indexedDb.ts` using minimal
   raw identity and age, including rows whose options cannot parse. Keep
   the seven-day policy. Acquire the per-session claim before destructive
   cleanup and recheck under the claim for expiry and invalid-stream cleanup
   in `recovery.ts`. Reuse raw liveness metadata in
   `lock/noWebLocks.ts` where available. Treat unknown ownership
   conservatively. A chunk-only scan is deferred. Normal writes commit the
   parent first and delete parent and chunks transactionally. The degraded
   lock fallback could leave chunks behind if a suspended tab resumed
   writing after its parent was deleted. Revisit a scan if that path is
   reproduced or parentless chunks are observed.
3. Invalidate the cached connection in `IndexedDBSessionPersistence.openDb`
   on close and close it for version changes. Reopen and retry the same safe
   operation once before `SessionWriteQueue` downgrades. Preserve FIFO,
   contiguous chunk sequence and memory fallback. Cover upgrade blocking and
   incompatible versions. Group live-only runtime fields in `sessionRuntime.ts`
   and `sessionTypes.ts` once tests establish equivalent teardown in
   `sessionActions.ts`. Move dev-only mock controls out of production paths
   where the extraction is mechanical.
4. Measure mute behavior in `recorderController.ts` and `sessionActions.ts`.
   Use a controlled mute/unmute test and real-browser tests for temporary
   interruption, track end and recorder failure. If a live track resumes
   after the current three-second cutoff, replace auto-submit for sustained
   live-track mute with a warning that persists until unmute. Keep salvage
   for ended tracks or an inactive recorder. Reuse the capture-health status
   UI and verify it does not clear merely because a silent chunk arrived.
5. Isolate mic-meter renders in `useMicTest.ts` and `CaptureModal.tsx`.
   Measure before and after with the same speech WAV, Chrome settings and
   sample window. See the [baseline repeat procedure](reviews/recording-reliability-baseline.md#repeat-for-comparison).
   Narrow state-only subscriptions in `RecordingSessionContext.tsx`. Profile
   the closed modal, timer and pill. Timebox an Opus bitrate check in
   `codecs.ts`, comparing bytes and a representative speech sample on the
   affected browser paths with the current default. Ship a lower bitrate
   only with evidence of acceptable speech and diarization; leave it
   independent of the PR's correctness work. Keep the complete memory
   fallback unless a measured alternative can reconstruct the full recording
   after an IndexedDB failure, including an unreadable persisted prefix.

| Reuse | Extension |
| --- | --- |
| `PersistedSessionSchema`, legacy options resolver, recovery probe | Separate audio recovery from current options validation |
| `IndexedDBSessionPersistence`, `SessionWriteQueue`, session locks | Bounded reopen and ordered writes, with safe raw-row expiry |
| Recorder controller and capture-health banner | Distinguish resumable mute from confirmed track loss |
| `useSyncExternalStore`, `useMicTest`, visualizer | Keep time- and level-driven renders with consumers that display them |

**Acceptance.** Cover older/malformed rows, foreign-account rows, expiry and
invalid-stream cleanup during another tab's ownership, closed connections,
permanent quota errors, final-chunk draining and memory fallback. Report
render counts and mute observations, with any bitrate decision recorded
separately.
Verify an unknown codec with an otherwise valid stream survives the probe
and can be exported without starting an upload.
Retain presence, truncation detection, degraded locks and multi-orphan chaining.

## PR 3 — Resumable transfer and file-upload lifecycle

1. In `frontend/lib/capture/storageTransfer.ts`, resume TUS from the
   server's accepted offset for the exact same prepared `File` on user Retry.
   Bind the in-memory upload URL to original user, endpoint, bucket, path
   and immutable source. Disable TUS fingerprint persistence. Clear the
   handle on success, expiry, explicit cancel, discard, account change or
   source replacement. Keep the prepared recovered `File` through a
   same-page transfer retry so it matches the handle. Reload uses existing
   recording recovery and a fresh transfer if media is still unlinked. An
   expired or missing URL also restarts cleanly.
2. Handle bounded backoff and connection loss in `storageTransfer.ts` and
   `upload.ts`. If the browser reports offline, retain the prepared upload
   in a cancelable waiting state with a deadline. On reconnect, enable
   explicit Retry of that attempt. Keep Retry available when the wait
   expires. Clean up timers/listeners on cancel, disposal and account
   change. A network interruption keeps the canonical transcript and
   resumable transfer. The existing rollback would delete a fresh row and
   change the path on Retry. Explicit cancel terminates the partial upload
   where supported. Verify interrupted PATCH, expired URL, response loss
   and destination conflicts against local Supabase Storage.
3. In `useCapture.ts`, `useCaptureForm.ts` and `CaptureModal.tsx`, add
   file-upload unload protection and phase-aware cancel. Retain a stable
   intent for a logical submission across retries and reset it for a new
   selection or a deliberate new submission. Treat the already-created
   transcript as canonical if a retry follows an ambiguous create. Explicit
   cancellation never deletes a reused transcript or media with a potentially
   accepted start. Share transport with recording without adding IndexedDB
   storage for selected files. Split client-safe Storage constants/path helpers
   from provider proxy code if needed for this boundary.

| Reuse | Extension |
| --- | --- |
| `transferToStorage`, installed TUS client and account-bound token getter | Scoped resume identity, bounded retry and terminal cancellation |
| `runCaptureUpload`, `createTranscript`, start idempotency | Reconcile outcomes and reuse logical file submission intents |
| `useCapture`, capture form progress, `useBeforeUnloadGuard` | File upload cancellation and refresh warning without changing app navigation |

**Acceptance.** A synthetic large transfer resumes at the server's accepted
offset after interruption. Cancel, concurrent retry, missing/expired URL,
wrong owner, changed source, offline timeout and reconnect are exercised. Progress stays bounded and only
reports completion after storage acceptance. Verify no duplicate transcript or
active job, no overwrite of a different recording, and no deletion of linked
media after an ambiguous start. Exercise both small and resumable uploads.

## Follow-ups and final integration

- Track abandoned server upload cleanup and creation rate limiting separately.
  A null media link can belong to an active upload or a committed Storage
  object. Cleanup needs a safe lifetime and race protocol. Enforcement of
  creation limits must account for the authenticated direct insert path.
- Defer a library download action for a duration refusal. The preparation check
  returns before conversion, and the owner's Storage SELECT policy already
  permits a client-side download. The current library still offers no
  download for a rejected recording, and the browser cap cannot cover old
  recovery rows or every suspension case. Export before submitting a
  recovered recording is available in PR 1. If the remaining gap warrants
  a library action, start with the authenticated browser Storage client
  under existing RLS and validate the current linked source and account.
  `handle-media-prepare.ts` currently sends a generic
  `transcription_error`. Add a distinct structured failure reason before
  offering a duration-specific action. The completed-only editor media
  endpoint stays as it is.
- Track non-owner presence clearing if reproduced. Cross-reload TUS resume
  is outside this plan.
- Update stale recording/navigation documentation for shipped behavior.
  Record each PR's verification, any deferred item with its trigger, and
  Codex and Claude's disposition on substantive review findings before the
  final integration PR.

## Review record

Claude approved the revised three-PR plan with no blockers. Both reviewers
agreed to defer a library download and chunk-only cleanup, and to keep the
mute and bitrate checks bounded. The follow-up clarified PR 1's account
change, quiet cleanup, and upload-intent rules, and PR 2's handling of unknown
codecs. PR 1 uses the suggested export-only path for old rows without an
intent. Claude checked the changed lines in PR 1 steps 2–4 and PR 2 step 1
and confirmed approval. The baseline review added explicit recovered-save
notices to PR 1 acceptance and a speech-based mic-meter comparison to PR 2.
The user will direct when implementation begins.
