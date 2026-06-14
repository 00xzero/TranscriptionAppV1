# Audio Durability (Crash Recovery) Design

## Status

Design agreed; not yet implemented. This note records the decisions reached while
designing crash recovery for in-browser recordings. It supersedes the Phase-1
"crash = data loss" cut documented in `live-recording-feature-spec.md`
(see [Spec amendment](#spec-amendment) below).

> Note: this is the initial durability-focused iteration. The design has since
> evolved into the broader durable app-level recording plan in
> [`durable-app-level-recording-design.md`](./durable-app-level-recording-design.md),
> which should be treated as the current master spec.

## Problem

In-progress recordings live only in memory (`store.runtime.chunks` in
`lib/recording/sessionRuntime.ts`). The `sessionStorage` draft persists *metadata*
only (title, key terms, codec MIME, device ID) — not a single byte of audio. A
tab crash, accidental refresh, or browser quit at minute 45 of an hour-long
recording loses everything, and the `interrupted` flow offers to *restart*, not
*resume what was captured*.

Every guarded-navigation mechanism (`useBeforeUnloadGuard`, `guardedNavigation`)
exists because navigation is currently fatal — that treats the symptom. The fix is
durability: spill chunks to IndexedDB as they arrive (we already receive them on a
1s timeslice), which makes recovery real and lets the guards relax from
"confirm or lose everything" to "we've got it either way."

## Summary of approach

Write each `MediaRecorder` chunk to IndexedDB as it arrives (write-behind, never
blocking the live recording). On a fresh page load, an app-wide probe detects an
orphaned session — chunks present in IDB with no live tab owning them — and offers
to reassemble and transcribe what was captured. Recovery availability is gated per
browser (WebM works; Safari/MP4 pending an empirical spike) and per session
(degrades to memory-only if persistence fails). The nav guards relax only when
recovery is actually armed for the current session.

## Goals

1. Survive accidental refresh, in-app navigation, tab close→reopen, and tab/browser
   crash — recovering the audio captured up to the last flush.
2. Make recovery discoverable after a real crash (not only on the recording page).
3. Never let the durability layer harm the live recording.
4. Relax the navigation guards where durability makes them unnecessary.

## Non-goals (this phase)

- A durability *guarantee*. This is best-effort salvage; sub-second tail loss on a
  hard crash is accepted and always communicated as "we recovered an interrupted
  recording," never as a promise.
- Resume-and-continue (appending new audio onto a recovered prefix). Recovered audio
  is a sealed artifact.
- Cross-device / cross-session recovery (unchanged from the original spec).
- Live cross-tab orphan notification (a tab learning *while open* that another tab
  just crashed). Probe runs once on load.
- Server-side drafts. Recovery reuses the existing client upload pipeline; no project
  row exists until the user chooses to save.

## Decisions

### 1. Product promise: best-effort salvage, not a guarantee

Scope covers four failure modes: (1) accidental refresh, (2) in-app navigation,
(3) tab close→reopen, (4) tab/browser crash. We do not *promise* power-loss / OS-crash
(modes 5–6) because the final `dataavailable` event never fires on a hard kill, so a
sub-second tail is always potentially lost. Framing is always "recovered an
interrupted recording," never "guaranteed safe."

### 2. Finalize-only recovery

Recovered audio is sealed: the recovery UI offers **Save & transcribe** or
**Discard**. We never re-attach a `MediaRecorder` to recovered audio. This avoids the
container-format minefield of concatenating two independent recorder streams (each
with its own init header) and lets recovery reuse the existing `stopAndFinalize` tail
(reassemble blob → empty-floor check → `runCaptureUpload`). A user who wants more
audio starts a new recording; they get two files, not one stitched file.

### 3. Per-browser capability gating

Codec priority is WebM/Opus first, `audio/mp4` only as Safari's fallback
(`lib/recording/codecs.ts`). So **Safari is the only browser that produces MP4**.

For WebM, the recovered blob is **byte-identical to today's clean-stop blob minus the
final un-flushed tail** — `stopAndFinalize` already does `new Blob(runtime.chunks, …)`,
and reassembling the same chunks from IDB produces the same bytes. WebM recovery is
therefore near-zero risk.

Safari/MP4 recovery is gated on the [Stage-0 spike](#stage-0-spike-the-one-open-question).
If MP4 can't reassemble into decodable audio, Safari silently falls back to today's
`interrupted`→restart flow, and Safari sessions keep the strict guards. Recovery is a
capability present where the format allows, absent where it doesn't.

### 4. Ownership via the Web Locks API

The recording tab holds a named lock (`navigator.locks.request('recording-session', …)`)
for its lifetime. The browser auto-releases it when the tab/process dies — the exact
crash signal we need, with no timing heuristics. A probing page load checks
`navigator.locks.query()`:

- Lock held by another tab → session is **live**, hands off (no recovery offered).
- Lock free but chunks present → **orphaned**, offer recovery.
- Lock held by self → active in this tab.

The same lock extends "one live recording per browser" across tabs. Browser floor:
Safari 15.4+. Browsers without Web Locks degrade to refresh-only (per-tab) behavior.

### 5. IndexedDB schema; draft migrates into IDB

- `chunks` object store, keyed `[sessionId, seq]`, value is the raw `Blob`.
  Append-only, every write O(1), Blobs stored natively (no base64 bloat).
- `sessions` object store, keyed `sessionId`, holding metadata: `title`,
  `generatedTitle`, `keyTerms`, `codecMime`, `codecExtension`, `deviceId`,
  `createdAt`, running `bytesSoFar`, and a **phase marker** (`capturing` | `uploading`,
  see decision 7).

The `sessionStorage` draft is **fully replaced** by the `sessions` record — one source
of truth, not a split.

### 6. Bytes-only empty-floor and size-only display for recovery

The live elapsed-time accumulator is memory-only and unrecoverable post-crash
(`lastResumeAt` is a timestamp; we can't know when the crash happened). So:

- Recovery empty-floor is **bytes-only** (`bytes ≥ 4KB`), dropping the `activeMs ≥ 2s`
  component. 4KB of Opus is already sub-second, so the floor still rejects near-empty
  junk.
- The recovery prompt shows **size** ("~2.3 MB recovered"), not duration.

### 7. Clear only on submitted/discard; phase marker for the upload window

The IDB session is cleared on `markSubmitted` (durably saved) and `discard` (user threw
it away). It is **kept** through `recording → paused → finalizing → uploading → error →
interrupted`. Keeping it through `error` fixes a second gap for free: today's in-memory
`finalizedRecording` retry-blob dies on refresh; with chunks in IDB, an error-state
refresh becomes recoverable, and we never separately persist the assembled blob.

**Double-upload hazard:** a crash during `uploading`, after the server 200 but before
`markSubmitted` clears IDB, would cause recovery to re-upload → a duplicate project
(`POST /api/projects` has no idempotency today). Mitigation: the **phase marker**.
Recovery of a `capturing`-phase session → normal "Save & transcribe." Recovery of an
`uploading`-phase session → cautious path: *"We started saving this recording but
couldn't confirm it finished — check Projects before saving again,"* reusing the
existing `saved_status_unknown` language in `lib/capture/upload.ts`. No server change.

> Later hardening: real idempotency on `POST /api/projects` (client-generated key
> persisted in the session record, server dedup). Pre-existing weakness, not created by
> this feature.

### 8. Persistence never harms the live recording

Writes are strictly write-behind and best-effort. Any IDB failure (private mode, quota,
transaction error) degrades to today's memory-only behavior:

- The live recording **continues uninterrupted**.
- The session is marked **`armed = false`** (a snapshot field).
- A **passive, non-blocking advisory** appears on `/recording/new` (reusing the existing
  inline-banner pattern, `aria-live="polite"`): *"This recording isn't being backed up
  for crash recovery — keep this tab open until you finish."* Framed as a missing safety
  net, never as "something broke." Never a modal; never stops the recording.

Probe persistence availability up front at `attachAndStart`; if a later write fails,
downgrade to not-armed and **stay** not-armed for the session (don't recover a chunk
stream known to have a hole).

The `armed` flag is the single signal driving: guard copy (relaxed vs strict), pill
recovery affordance, and the advisory banner.

### 9. At-most-one orphan; 7-day GC sweep

`attachAndStart` clears any prior IDB session before writing the new one — there's never
more than one orphan, so recovery is unambiguous (matches the existing singleton model).
A startup GC sweep deletes any session older than **7 days** (matching Safari's
script-storage eviction window) as a backstop for clear-points themselves interrupted by
a crash. Starting a new recording supersedes an unrecovered orphan (the user saw the
recovery entry point on load and chose to start fresh).

### 10. Background recording when armed; strict guards when not

When recovery is **armed**, in-app navigation **keeps capturing in the background** — the
singleton survives client-side nav, the app-wide pill (with pulsing dot) is the visible
"you're live" indicator and the return path, and there is **no prompt and no discard**.
Full unload (refresh/close) gets a **soft, non-blocking heads-up** ("Your recording is
saved — pick it back up after reloading"); reload surfaces the recovery prompt.

When **not armed** (Safari without recovery, or degraded persistence), today's behavior is
retained: in-app nav shows the strict discard-confirm (`guardedNavigation.tsx`), and
`beforeunload` shows the hard warning.

This removes the discard-on-navigate behavior (`confirmAndDiscard` → `actions.discard()`)
for armed sessions, resolving the current contradiction between the "roam and return"
pill and the "leave = lose it" guards.

### 11. Real provider, app-wide async probe, new `recoverable` state

`RecordingSessionProvider` (currently a no-op, mounted in `app/layout.tsx`) becomes real:
on mount it runs **one async probe** (open IDB → if a session record exists, check Web
Locks → if orphaned, hydrate the singleton to a new `recoverable` state with metadata +
`bytesSoFar`). A `recoveryProbe: 'pending' | 'done'` snapshot field lets pages distinguish
"still checking" from "checked, nothing there."

`/recording/new` mount branches: `recording`/`paused` → render it; `recoverable` →
recovery UI; `idle` + probe `done` + no orphan → redirect to Capture (today's behavior);
probe `pending` → brief "Checking for a recovered recording…". A new `recoverable` **pill
variant** is the global entry point; clicking it routes to `/recording/new` where the
recover/discard choice lives.

Probe runs once on load (no live cross-tab notification this phase).

### 12. Port/adapter testing seam

Define thin interfaces injected into the session actions:

- `SessionPersistence` — put/get/delete/list chunks + metadata.
- `SessionLock` — acquire/query/release.

Production wires IndexedDB and Web Locks adapters; tests inject in-memory fakes, keeping
the existing suite fast and mostly synchronous. Plus a small number of integration tests
running the real IDB adapter against `fake-indexeddb`, and a hand-rolled in-memory Web
Locks fake (~30 lines). **No test can validate Safari MP4 reassembly** — that lives in the
spike, not the suite. Green tests must not create false confidence on the format question.

### 13. No feature flag; build in dependency order

No users yet, so no production-rollout flag or soak periods. Ship unflagged. The build
*order* still holds because the layers depend on each other:

1. **Stage 0 — Spike.** Gate Safari/MP4 viability.
2. **Stage 1 — Writer + GC.** Persistence adapters, chunk-spill into `recordChunk`,
   lifecycle clearing, startup sweep. Invisible, no UX change.
3. **Stage 2 — Recovery UX.** `recoverable` state, app-wide probe, recovery prompt, pill
   variant.
4. **Stage 3 — Guard relaxation.** Armed-gated background recording + softened unload.
   Last, because relaxing a "you'll lose everything" warning before recovery is proven
   would be actively dangerous.

## Stage-0 spike: the one open question

**Does Safari's `MediaRecorder` emit fragmented MP4 (moof/mdat per chunk → crash-orphaned
chunks reassemble into decodable audio) or single-moov MP4 (the index atom is written only
on `stop()` → orphaned chunks are an unindexed, unplayable blob)?**

Everything for Safari hangs on this; WebM is near-zero risk. The spike: a throwaway probe
page (in the spirit of the existing `dev-mic-probe.html`) that records, simulates a crash
by reassembling from persisted chunks *without* a clean stop, and sends the result to
Deepgram — per browser, especially Safari. A WebM failure would be astonishing and would
halt the feature; a Safari failure selects the WebM-only recovery path (decision 3).

## Decision table

| # | Decision | Choice |
|---|----------|--------|
| 1 | Product promise | Best-effort salvage (modes 1–4), never a guarantee |
| 2 | Recovery capability | Finalize-only; no resume-and-continue |
| 3 | Browser coverage | WebM full; Safari/MP4 gated on spike, else strict fallback |
| 4 | Ownership / liveness | Web Locks API (auto-release on crash) |
| 5 | Storage | IDB append-only `chunks` + `sessions` metadata; draft migrates into IDB |
| 6 | Empty-floor / display | Bytes-only floor for recovery; show size, not duration |
| 7 | Clearing | On submitted/discard only; phase marker guards the upload window |
| 8 | Failure handling | Degrade to memory-only + `armed=false` + passive advisory |
| 9 | Multiplicity / GC | At-most-one orphan; superseded on new start; 7-day sweep |
| 10 | Guards when armed | Background recording, no discard; strict retained when not armed |
| 11 | Discovery | Real provider, app-wide async probe, `recoverable` state + pill |
| 12 | Testing | Port/adapter seam + `fake-indexeddb` integration + Web Locks fake |
| 13 | Rollout | No flag; build order spike → writer → recovery UX → guard relaxation |

## Spec amendment

`live-recording-feature-spec.md` currently states (line ~324) that crash-during-recording
data loss is accepted for Phase 1, and decision #4 in its table says the project row is
created only after Stop with crash data loss accepted. Once this feature lands, those
should be updated to describe the durability contract: chunks spilled to IDB, best-effort
recovery on next load, and the guards relaxed for armed sessions. Until then, the spec's
"accepted data-loss surface" remains accurate and should stay.
