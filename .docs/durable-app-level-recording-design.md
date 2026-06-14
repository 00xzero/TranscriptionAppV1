# Durable App-Level Recording Design

## Status

Design agreed; not yet implemented.

This document supersedes the narrower "Audio Durability (Crash Recovery) Design"
and folds in the Persistent Recording Session feature. It should be treated as
the master spec for turning recording from a route-bound page into a durable,
app-level recording session with global status, same-browser awareness, and
best-effort local recovery.

## One-Sentence Goal

Let users record while moving through the app by combining app-level recording
status and controls with best-effort local audio durability and honest browser
limit handling.

## Product Promise

A recording continues while the owning browser tab remains open. The user can
move around the app freely, and if the tab refreshes, closes, or crashes, the
app offers best-effort recovery of already captured audio when local durability
was available.

This is deliberately not a promise that recording follows the user everywhere.
The live `MediaRecorder` cannot move between tabs, browsers, devices, or survive
the owning tab being closed. Other same-browser tabs may observe local presence
and may recover sealed chunks after owner loss, but only the owner tab can
control the live recorder.

## Problem

In-progress recordings currently live only in memory (`store.runtime.chunks` in
`frontend/lib/recording/session.ts`). The draft metadata persists title, key
terms, codec MIME, and device ID, but not audio bytes. A tab crash, refresh, or
browser quit during a long recording loses the captured audio, and the existing
`interrupted` flow can only restart with preserved metadata.

The UI is also route-bound. `/recording/new` acts as the recording surface, and
navigation guards treat leaving that route as dangerous because the recording
experience is not yet truly app-level.

The desired system separates these concerns:

- the local session singleton owns the live `MediaRecorder`;
- IndexedDB mirrors chunks and metadata for best-effort recovery;
- app-level presence exposes recording status in the contextual header;
- `/recording/new` becomes an expanded/recovery surface, not the lifecycle owner.

## Goals

1. Allow a user to start recording, navigate within the app, and return to the
   recording through a global header pill.
2. Preserve the current one-live-recording model, scoped to a browser profile.
3. Spill `MediaRecorder` chunks and session metadata to IndexedDB without
   blocking or harming the live recording.
4. Recover captured audio after refresh, tab close->reopen, browser crash, and
   owner-tab loss when the persisted chunk stream is valid.
5. Make recovery discoverable anywhere in the authenticated app.
6. Prevent duplicate project creation by using a persisted, user-scoped upload
   idempotency key.
7. Handle same-browser tabs clearly: non-owner tabs can observe, but not control,
   the live recorder.
8. Keep browser limitations explicit: no cross-browser/device awareness in this
   phase, no recording after the owning tab is gone, and no resume-and-continue
   from recovered audio.

## Non-Goals

- Multiple simultaneous recordings in one browser profile.
- Global one-recording-per-user enforcement across different browsers/devices.
- Cross-browser or cross-device recording presence.
- Moving a live `MediaRecorder` between tabs.
- Continuing to record after the owning tab is closed.
- Resume-and-continue from recovered chunks. Recovered audio is sealed.
- Progressive server upload while recording.
- Server-side recording drafts before the user saves/transcribes.
- Recovery playback before saving.
- Keyboard shortcuts for global recording controls.
- OS/browser notifications beyond the browser's own mic indicator.

## User Experience

### Recording Start

Recording requires an authenticated user. The Capture flow starts the local
recording session, closes the capture modal, and routes to `/recording/new`.
This preserves the existing expectation that starting a recording lands the user
on the full recording surface.

If a recording, retryable upload artifact, or recoverable artifact already
exists, starting a new recording is blocked. The user must resolve the existing
artifact first.

### `/recording/new`

`/recording/new` remains a real route, but it no longer owns the lifecycle. It is
the expanded recording surface for:

- local active recording;
- paused recording;
- finalizing/uploading;
- retryable upload error;
- recoverable audio;
- direct visits from a non-owner tab where another tab owns the live recorder.

When idle:

- production redirects to the appropriate capture/projects flow;
- development may keep mock/dev controls.

There is no explicit "Minimize" or "Return to previous page" action. Normal app
navigation is enough: any non-recording route is the minimized/global state.
There is no instructional copy telling users they can navigate away.

### Global Recording Pill

The contextual header is the home for recording status. The pill renders only on
the client after local session/presence state is ready enough to avoid hydration
mismatches. There is no fallback floating pill in this phase.

The pill remains visible throughout the active capture lifecycle:

- recording;
- paused;
- finalizing;
- uploading;
- retryable upload error;
- recoverable audio;
- brief terminal saved/discarded states.

The pill is also visible on `/recording/new`.

Desktop behavior:

- hover/focus opens a non-destructive informational preview;
- click routes to `/recording/new` for local/error/recoverable states;
- click on a remote pill opens the informational popover only.

Mobile behavior:

- tap routes to `/recording/new`.

The preview is informational only. It does not include pause, resume, stop, save,
or discard controls.

Pill labels/treatments:

- local active: `Recording 00:00:16`;
- local paused: `Paused 00:00:16`;
- finalizing/uploading: compact progress label;
- retryable error: visually distinct error pill, clicking routes to
  `/recording/new`;
- remote owner: distinct "Recording in another tab" variant;
- recoverable: "Recovered recording" variant;
- saved/discarded: brief terminal state, then clear.

The pill itself does not expose durability status. It stays focused on recording
state and elapsed time.

### Terminal States

On successful submission:

- clear local IDB/presence first;
- show a short `Saved` pill animation;
- respect reduced-motion preferences;
- do not show a toast by default;
- do not make the transient saved pill a project link.

On discard:

- clear local IDB/presence first;
- show a short, quieter `Discarded` pill animation;
- then clear.

Terminal animations are cosmetic and interruptible. A user may start a new
recording while the saved/discarded animation is still visible.

If the user is on `/recording/new`, submitted/discarded may redirect after the
terminal state as today. If the user is elsewhere, do not hijack their route.

### Warnings

The internal `armed` flag is never shown to users. User-facing language talks
about backup/recovery only when needed.

When recording is backed up successfully, the UI stays quiet. No positive
"backed up" status is shown by default.

When durability is unavailable or has downgraded, recording is still allowed and
the user may still navigate within the app. The warning is passive but
persistent in the hover/focus preview and `/recording/new`:

> If this tab refreshes, closes, or crashes, this recording may be lost.

This warning remains visible through recording, paused, finalizing, and
uploading until submitted/discarded.

## Navigation and Guards

In-app navigation is always allowed for active recordings. The dangerous boundary
is leaving the JavaScript runtime, not leaving `/recording/new`.

`beforeunload` warning is shown for active recordings through upload completion,
even when durability is armed. Recovery may save captured chunks, but refresh or
close still interrupts the live recording.

`recoverable` state does not require `beforeunload`: the audio is already
persisted locally and the in-app recovery modal forces resolution.

Sign-out and account/workspace context switches are guarded while any active,
recoverable, or retryable recording artifact exists. The user must save/transcribe
or discard before leaving the auth/context boundary.

Unrelated app actions are not globally blocked. Recording does not interfere with
ordinary project/library flows unless the action would start another recording or
cross an auth/context boundary.

## Recording States and Models

### Local Session State

Add `recoverable` to the local recording state model.

Local session states:

- `idle`;
- `recording`;
- `paused`;
- `finalizing`;
- `uploading`;
- `submitted`;
- `discarded`;
- `error`;
- `interrupted`;
- `recoverable`.

`interrupted` means the live recorder was lost and no recoverable audio is
available. It keeps the existing "start a new recording with preserved metadata"
path for unarmed or unsupported sessions.

`recoverable` means persisted audio exists and can be saved/transcribed or
discarded.

Remote ownership is not a local recording state. It belongs to the separate
presence model.

### Presence Model

Same-browser remote presence is lightweight and separate from durable audio.
Presence uses:

- `BroadcastChannel` for live messages;
- `localStorage` for the latest presence snapshot and heartbeat timestamp;
- IndexedDB only for durable session/chunk recovery.

Presence may include title but not key terms. It is not encrypted or obfuscated;
keep sensitive data out of localStorage.

Example:

```ts
type RecordingPresence = {
  sessionId: string
  ownerClientId: string
  userId: string
  state: 'recording' | 'paused' | 'finalizing' | 'uploading'
  title: string | null
  startedAt: number
  lastResumeAt: number | null
  pausedAccumulatedMs: number
  bytesSoFar: number
  lastChunkSeq: number | null
  lastChunkReceivedAt: number | null
  heartbeatAt: number
}
```

Owner heartbeat runs every 2 seconds throughout the active lifecycle, including
paused, finalizing, and uploading. Remote presence becomes stale after 15 seconds,
but stale heartbeat is confirmed against Web Locks before declaring owner loss.
If Web Locks say the lock is still held, lock liveness wins and the remote UI
continues to show an active recording.

Heartbeat proves the owner tab is alive, not that audio is flowing. Presence also
includes `lastChunkSeq` and `lastChunkReceivedAt` so the owner tab can surface
capture-health issues when chunks stop arriving unexpectedly. Remote tabs should
not declare the owner dead from chunk staleness alone; chunk freshness is a
capture-health signal, while Web Locks plus heartbeat are ownership/liveness
signals.

Without Web Locks, use heartbeat-only presence as degraded best-effort awareness.
It can prevent many duplicate starts but cannot prove owner death as reliably.

## Durability Layer

### Product Contract

Durability is best-effort salvage, not a guarantee. A hard crash may lose the
sub-second tail that never emitted a `dataavailable` event. Copy must say
"recovered an interrupted recording," never "guaranteed safe."

Durability changes recovery capability and warning copy. It does not determine
whether the user can record or roam within the app.

### IndexedDB Schema

`chunks` store:

- key: `[sessionId, seq]`;
- value: raw `Blob`;
- append-only;
- no base64 encoding.

`sessions` store:

- `sessionId`;
- `userId`;
- `uploadIntentId`;
- `title`;
- `generatedTitle`;
- `keyTerms`;
- `codecMime`;
- `codecExtension`;
- `deviceId`;
- `createdAt`;
- `startedAt`;
- `lastResumeAt`;
- `pausedAccumulatedMs`;
- `bytesSoFar`;
- `lastChunkSeq`;
- `lastChunkReceivedAt`;
- `phase`: `capturing` | `uploading`;
- `armed`;
- optional failure/degrade reason for diagnostics.

The existing session draft migrates fully into the `sessions` record. Do not
split draft metadata between `sessionStorage` and IndexedDB.

### Writer Semantics

Chunk and metadata writes are write-behind and never awaited in the recorder hot
path. The live recording must continue even if persistence fails.

Persist metadata transitions too:

- pause/resume timing;
- running bytes;
- phase;
- title/generated title;
- upload intent;
- armed/downgraded state.

If any chunk write fails, the session downgrades to `armed=false`. A known hole
means recovery is unavailable for the whole session. Once downgraded:

- stop persistence attempts for that session;
- do not try to re-arm;
- leave already-written chunks until terminal cleanup or GC;
- continue live recording normally.

### Durability Invariants

Recovery must be validated structurally, not by trusting a single advisory flag.

The `chunks` store is authoritative for recoverability, byte count, and file
assembly. The `sessions` row is required as metadata, but its counters and timing
fields are advisory hints that may lag the chunk stream after a crash.

Before offering recovery, the app must verify:

- a current-user session row exists;
- the codec is recoverable in this browser;
- the owner is gone or unreachable according to the ownership rules;
- persisted chunks include `seq = 0` and are contiguous from `0..N`;
- recovered chunk bytes meet the recovery empty floor;
- no trusted persisted downgrade/failure marker explicitly suppresses recovery.

`seq = 0` is the required container/init chunk. For WebM, it carries the EBML /
Tracks initialization data; for recoverable fragmented MP4, it must include the
initial `ftyp`/`moov` data. If chunk `0` is missing, the recording is
unrecoverable even if later chunks are internally contiguous.

`armed` is a live-session/UI signal, not proof that recovery is valid. Because
the write that flips `armed=false` can fail during the same storage failure that
creates a bad chunk stream, recovery must not rely on `armed=true`. If a valid
contiguous chunk stream exists and no persisted downgrade marker says otherwise,
it may be offered as best-effort salvage.

Approximate recovery duration should prefer structural or media-derived evidence
over stale row counters when available. Acceptable sources include per-chunk
timing metadata, assembled media probing, or persisted timing metadata. If those
sources are missing or inconsistent, show size only.

Owner liveness, recovery validity, and capture health are separate contracts:

- owner liveness: Web Lock plus heartbeat;
- recovery validity: contiguous chunks plus codec support plus bytes floor;
- UI backup status: `armed`, advisory only;
- capture health: `lastChunkReceivedAt`, `lastChunkSeq`, and owner-side recorder
  monitoring.

### Capture Health Handling

The owner tab monitors capture health while local state is `recording`. A stale
heartbeat means a tab may be gone; stale chunk freshness means the tab is alive
but audio may not be flowing.

If no chunk arrives within the expected timeslice window plus tolerance while
the recorder still reports `recording`, the owner tab should:

1. re-check recorder state and audio track state;
2. request a manual data flush when supported;
3. surface a passive capture-health warning if the condition persists briefly;
4. route into the existing recorder-failure salvage policy if the recorder,
   track, or flush confirms audio is no longer flowing.

Recorder `error`, track `ended`, and sustained mute continue to use the existing
salvage policy: if the captured artifact meets the live empty floor, finalize and
submit what was captured; otherwise discard/interrupted behavior applies.

The exact stale threshold is an implementation constant, but it must be longer
than the configured `MediaRecorder` timeslice and tolerant of normal browser
timer jitter. Remote tabs do not run this policy for the owner; they only display
owner/presence state.

### Storage Persistence and Quota

At recording start, request durable browser storage with
`navigator.storage.persist()` where available. Failure to obtain persistent
storage does not block recording; it only means the session may be more likely to
downgrade if writes fail or the browser evicts data.

The local recovery budget should align with the existing recording size ceiling.
The app already auto-stops near `maxBytes`; IndexedDB recovery storage should be
planned against the same ceiling plus modest metadata overhead. If quota,
eviction, or transaction failure prevents writing a chunk, treat it as a
persistence failure for the session: downgrade to `armed=false`, stop further
persistence attempts, keep live recording running, and show the unarmed warning.

Storage estimates, quota failures, and private-mode behavior are advisory. The
authoritative signal is whether chunk writes succeed and remain structurally
recoverable.

### Recovery Capability

Recovered audio is sealed. The recovery UI offers save/transcribe or discard. It
never appends new recording audio to the recovered prefix.

For WebM, reassembled chunks should be byte-equivalent to today's clean-stop blob
minus the final unflushed tail.

Safari/MP4 recovery is gated on the Stage 0 spike. If Safari MP4 chunks cannot
be reassembled into decodable audio without a clean `stop()`, Safari falls back
to unarmed/interrupted behavior.

### Empty Floor and Display

Recovery empty-floor is bytes-only. If recovered bytes are below the floor, the
orphan is silently cleaned up and no blocking modal is shown.

When timing metadata is available, recovery UI shows approximate duration and
size. If timing metadata is missing or unreliable, show size only. Duration is
always framed as approximate.

## Upload Idempotency

Each recording session gets a client-generated, user-scoped `uploadIntentId` at
recording start. It is persisted in IndexedDB but no server project/upload row is
created until the user saves/transcribes.

When creating the project/upload, the client sends the `uploadIntentId`. The
server deduplicates by `(userId, uploadIntentId)` so a recovery after an
upload-window crash can safely retry without creating duplicate projects.

The idempotency layers must compose with downstream transcription/start
deduplication. A repeated recovery save should flow:

1. project/create dedup by `(userId, uploadIntentId)`, returning the canonical
   project id and capture/upload status;
2. transcription/start dedup for that canonical project, so the same recording is
   not double-started downstream.

The second project/create attempt must return enough canonical result data for
the UI to land the user in the same place as the first successful attempt.

Recovery save UX depends on idempotency. Do not ship recovery save/retry without
server-side idempotency.

`uploadIntentId` is cleared with the local session on successful submission or
discard. It does not survive as a local tombstone.

Upload-phase recovery remains distinct but calm:

> We were saving this recording when the app was interrupted. You can safely
> continue; we will avoid creating a duplicate.

Actions: continue saving, discard.

## Ownership and Same-Browser Tabs

The owning tab holds a named Web Lock for the entire active lifecycle:

- recording;
- paused;
- finalizing;
- uploading.

The lock is released only after terminal local cleanup on submitted/discarded.
Clear terminal state/IDB first, then release lock/presence, so another tab does
not briefly see no owner while chunks still exist.

Same-browser duplicate starts are blocked when another tab owns a live
recording. Non-owner tabs show a distinct "Recording in another tab" pill if
presence or lock-only liveness is detected.

Non-owner tabs are observe-only. They cannot pause, resume, stop/transcribe, or
discard the owner tab's live recording. Direct visits to `/recording/new` in a
non-owner tab render a remote-active page state with title/timer if available,
and guidance to return to the original tab.

If owner-loss is detected in an already-open non-owner tab, the tab immediately
checks for recoverable chunks. If chunks are present and the owner is gone, it
transitions to recoverable UI and may save/transcribe or discard the sealed
audio. It still cannot continue the live recording.

If the lock is held but no presence metadata exists, show a generic remote
active state: "Recording in another tab," without title/timer.

## Cross-Browser and Cross-Device

Cross-browser and cross-device recording presence are out of scope for this
phase.

The one-recording rule is enforced per browser profile, not globally per user.
If a user starts a recording in Chrome, then opens Safari and starts another
recording, this phase does not detect or prevent it.

Backend recording presence may be added later, but it would be a separate
coordination layer. Even then, other devices could only observe or send requests
to the owner; they could not access or take over the live microphone stream.

## Recovery UX

On authenticated app load, `RecordingSessionProvider` becomes real and runs an
app-wide recovery probe:

1. open IndexedDB;
2. run a 7-day GC sweep;
3. find matching current-user session records;
4. process candidate sessions newest-first;
5. check ownership/liveness via Web Locks and/or degraded heartbeat;
6. hydrate local `recoverable` state when chunks are orphaned and above the
   bytes floor after structural validation.

After this feature ships, the product invariant is at most one unresolved active
or recoverable session per browser profile. The probe still handles multiple
legacy/pre-feature orphans defensively: resolve the newest structurally valid
candidate first, leave older matching candidates hidden for a later probe or GC,
and never allow a new recording to start while any recoverable candidate is being
presented.

The authenticated app shell may briefly gate rendering to avoid a late blocking
modal. If probing exceeds about 1.5 seconds, render the shell with recovery
status pending. If recovery later appears, show the blocking modal.

If opening/probing storage fails, retry once after a short delay. If retry fails,
do not alarm idle users. Show contextual warning only when a recording is active
or the user starts one.

When recoverable audio is found, show a blocking global recovery modal. The user
must resolve it before continuing in the app:

- save/transcribe;
- discard.

The modal contains the direct actions. `/recording/new` also supports the same
recoverable state for direct route access, but recovery is not route-dependent.

The recovery modal allows title editing only. It does not include key-term
editing or playback in the first version.

Recovery is explicit. Do not auto-upload recovered audio.

Starting a new recording is blocked until recoverable audio is saved/transcribed
or discarded. This replaces the earlier idea that starting a new recording
supersedes an unrecovered orphan.

If offline and recovered audio is found:

- save/transcribe is disabled or shows a clear offline message;
- discard remains available;
- the user can retry saving after network returns.

## Auth and Privacy

Persist `userId` or equivalent account context with the local recording session.
Recovery is shown only when the current authenticated user/context matches the
persisted session.

If a different user signs into the same browser and orphaned chunks exist for a
prior user, hide them and leave them for the 7-day GC. Do not reveal details and
do not delete them immediately just because a different user signed in.

Sign-out and account/workspace switch are blocked/guarded until active,
recoverable, or retryable recording artifacts are resolved.

## Accessibility

The pill timer updates visually, but timer changes are not announced every
second to screen readers.

Lifecycle changes use polite announcements. Destructive actions still require
explicit confirmation.

The desktop hover preview is also shown on keyboard focus. Enter/Space follows
the click action. The preview remains informational only.

Saved/discarded animations respect reduced-motion preferences.

## Testing and Adapter Seams

Define thin interfaces injected into session actions:

- `SessionPersistence`: write/list/read/delete chunks and metadata;
- `SessionLock`: acquire/query/release ownership;
- `RecordingPresence`: publish/read/clear local presence and heartbeat;
- upload idempotency path for `(userId, uploadIntentId)` project creation.

Production adapters:

- IndexedDB for chunks/sessions;
- Web Locks for owner lock where available;
- localStorage + BroadcastChannel for same-browser presence.

Test adapters:

- in-memory persistence fake for fast unit tests;
- `fake-indexeddb` integration tests for the real IDB adapter;
- hand-rolled Web Locks fake;
- fake BroadcastChannel/localStorage presence.

No automated test can prove Safari MP4 chunk reassembly. That belongs to the
Stage 0 browser spike.

## Implementation Phases

1. **Stage 0 - Safari/MP4 recovery spike.** Determine whether crash-orphaned
   Safari MP4 chunks reassemble into decodable audio without a clean `stop()`.
2. **Stage 1 - Persistence and idempotency foundations.** Add IDB schema,
   persistence adapters, write-behind chunk/metadata writer, 7-day GC, and
   user-scoped upload idempotency server support. Include storage-persistence
   request, quota/write-failure downgrade handling, and local budget alignment
   with the existing recording size ceiling.
3. **Stage 2 - Ownership and local presence.** Add Web Locks ownership,
   BroadcastChannel/localStorage presence, heartbeat, remote active detection,
   and duplicate-start blocking.
4. **Stage 3 - App-wide provider and recovery.** Make
   `RecordingSessionProvider` real, add app-wide probe, `recoverable` state,
   blocking recovery modal, offline recovery behavior, and `/recording/new`
   recoverable route support.
5. **Stage 4 - Navigation/auth guard rewrite.** Allow in-app navigation while
   recording; keep `beforeunload` warnings through upload; guard sign-out and
   account/workspace switches.
6. **Stage 5 - Global pill variants.** Add local, remote, recoverable, error,
   finalizing/uploading, saved, and discarded pill variants plus desktop
   hover/focus preview.
7. **Stage 6 - `/recording/new` route states.** Ensure the route handles local
   active, remote active, recoverable, retryable error, terminal, idle prod
   redirect, and dev mock states.
8. **Stage 7 - Live owner-loss handling.** In open non-owner tabs, detect owner
   loss, verify liveness, and surface recovery immediately when chunks exist.
9. **Stage 8 - Polish and QA.** Completion animations, reduced motion,
   browser/manual QA across Chrome, Safari, mobile browsers, offline, private
   mode, storage failure, and crash/reload scenarios.

## Decisions Changed From Original Durability Design

- The spec is now broader than crash recovery: recording becomes app-level with
  a global pill and `/recording/new` as an expanded/recovery surface.
- Global roaming is allowed even when durability is unarmed; durability changes
  warnings and recovery, not whether in-app navigation works.
- In-app navigation is always allowed while recording. `beforeunload` remains
  guarded for active recordings through upload.
- Recovery modal is blocking and actionable anywhere in the authenticated app.
- Starting a new recording no longer supersedes an unresolved orphan; recovery
  must be saved/transcribed or discarded first.
- Same-browser live owner-loss detection is in scope.
- Non-owner tabs show distinct remote recording UI but cannot control the owner.
- Recovery display may show approximate duration plus size when metadata exists.
- Upload idempotency is required before shipping recovery save UX.
- Different browsers/devices remain out of scope and are documented as a known
  limitation.

## Open Questions

### Safari/MP4 Recovery Spike

Does Safari's `MediaRecorder` emit fragmented MP4 chunks that can be reassembled
into decodable audio without a clean `stop()`, or does the required index atom
arrive only at clean stop?

The spike should record in Safari, persist chunks, simulate crash recovery by
reassembling chunks without clean stop, and verify playback/transcription. WebM
failure would halt the feature; Safari failure selects WebM-only recovery and
unarmed/interrupted fallback for Safari.

### Browser Support Details

Confirm behavior across supported browsers for:

- IndexedDB Blob persistence and quota/private-mode failure modes;
- Web Locks support and `navigator.locks.query()`;
- BroadcastChannel availability;
- timer throttling and heartbeat behavior in background tabs;
- `beforeunload` behavior on desktop and mobile browsers.

## Decision Table

| # | Decision | Choice |
|---|----------|--------|
| 1 | Product promise | Recording follows the user around the app while owner tab remains open |
| 2 | `/recording/new` | Expanded/recovery surface, not lifecycle owner |
| 3 | Pill desktop behavior | Hover/focus preview; click routes for local states |
| 4 | Pill mobile behavior | Tap routes to `/recording/new` |
| 5 | Hover/focus preview | Informational only; no controls |
| 6 | Pill visibility | Visible through active lifecycle, errors, recovery, brief terminal states |
| 7 | Durability gating | Recording/roaming allowed even when unarmed; warning/recovery differ |
| 8 | Unarmed warning | Explicit passive warning in preview and route |
| 9 | In-app navigation | Always allowed while recording |
| 10 | `beforeunload` | Warn for active recording through upload completion |
| 11 | Recovery modal | Blocking, global, actionable |
| 12 | Recovery actions | Explicit Save & transcribe or Discard |
| 13 | Recovery editing | Title edit only |
| 14 | Recovery floor | Bytes-only; below-floor silently cleaned |
| 15 | Recovery display | Approximate duration plus size when available, else size |
| 16 | Resume recovered audio | Not supported; recovered audio is sealed |
| 17 | Storage | IndexedDB raw Blob chunks + session metadata |
| 18 | Writer | Write-behind, never block recorder hot path |
| 19 | Write failure | Downgrade for session; continue live recording; no re-arm |
| 20 | Recovery validity | Requires `seq = 0`, contiguous `0..N` chunks, codec support, bytes floor |
| 21 | Capture health | Owner monitors chunk freshness separately from tab liveness |
| 22 | Storage quota | Request persistent storage; write/quota failure downgrades backup only |
| 23 | Idempotency | Required; user-scoped `(userId, uploadIntentId)` |
| 24 | Ownership | Web Lock for full active lifecycle |
| 25 | Presence | localStorage + BroadcastChannel; title yes, key terms no |
| 26 | Heartbeat | Every 2 seconds; stale after 15 seconds plus lock confirmation |
| 27 | Without Web Locks | Degraded heartbeat-only awareness; recovery still possible |
| 28 | Non-owner tabs | Observe-only; no remote controls |
| 29 | Owner loss | Open tabs detect and offer recovery when chunks exist |
| 30 | Cross-browser/device | Out of scope; one-recording rule is per browser profile |
| 31 | Auth scope | Recovery shown only to matching authenticated user/context |
| 32 | Sign-out/context switch | Guard until active/recoverable/retryable artifact resolved |
| 33 | Successful submission | Clear local state first, then Saved animation |
| 34 | Discard | Clear local state first, then Discarded animation |
| 35 | Recovery probe | App-wide, brief shell gate, 1.5s timeout, one retry |
| 36 | Multiple orphans | Defensively process newest valid candidate first; target at-most-one |
| 37 | Offline recovery | Discoverable; save disabled/message; discard available |
| 38 | Server upload | No progressive upload while recording |
| 39 | Implementation | One master spec, phased build |

## Related Spec Amendment

`live-recording-feature-spec.md` currently describes the Phase 1 data-loss
surface for crash-during-recording. Once this feature lands, that spec should be
amended to point here: chunks and metadata are mirrored to IndexedDB when
available, active recording is app-level, in-app navigation is allowed, and
recovery is best-effort rather than guaranteed.
