# Live Recording Implementation Plan

Companion to [`live-recording-feature-spec.md`](./live-recording-feature-spec.md). The spec defines **what** we are building; this plan defines **how we ship it** — PR sequencing, sizing, dependencies, and ship criteria per slice.

## Sizing summary

| | Estimate |
|---|---|
| Total LOC | ~2,500 (incl. tests) |
| Total dev-days | 5–8 |
| Number of PRs | 5 (one final merge to `main`) |
| Branch strategy | All work lands on `Record-on-demand` integration branch; single final PR `Record-on-demand → main` |

This is a feature epic, not a single PR. The reasoning:

- ~2,500 LOC is unreviewable as one diff.
- Browser-API surface area (`MediaRecorder`, `getUserMedia`, `AnalyserNode`, `beforeunload`) has subtle quirks per browser. Each layer needs to be tested in isolation before the next stacks on top.
- Nav interception and the recording session singleton interact non-trivially with HMR, React 18 Strict Mode, and Jest test isolation. Bugs are easier to localize when the slices land sequentially.
- If priorities shift mid-build, an integration branch with merged slices yields partial review value even if the final merge slips.

## Branch strategy

```
main
 └── Record-on-demand        (integration branch — already exists)
      ├── PR 1: tabs + modal restructure
      ├── PR 2: session module + recording page shell
      ├── PR 3: live mic capture + size budget + entry conditions
      ├── PR 4: pipeline handoff + salvage policy   ← feature becomes end-to-end functional
      └── PR 5: live waveform + polish + tests
```

Each PR opens against `Record-on-demand` for focused review. When PR 4 lands, the feature is shippable; PR 5 is polish that can land before or after final merge to `main`. The final merge `Record-on-demand → main` is a single decision point.

Record tab visibility: the tab is rendered from PR 1 onward. PR 1 ships a disabled placeholder CTA, while PR 3 enables the real browser-recording flow once mic capture exists. PR 4 swaps the mocked post-stop tail for the real upload/transcription handoff.

## PR-by-PR breakdown

Each PR section below lists scope, dependencies, the spec sections it implements, and an explicit "ship criteria" — what must be true to merge.

---

### PR 1 — Tabs primitive + Capture modal restructure

**Goal:** Land the visible tab UI without any recording machinery. Upload behavior is preserved exactly.

**Scope:**

- New: `frontend/components/ui/tabs.tsx` (Radix wrapper, Olivetti-styled).
- Modify: `frontend/components/CaptureModal/CaptureModal.tsx` to host two `<Tabs.Content>` panels.
- New: `frontend/components/CaptureModal/UploadAudioPanel.tsx` — extracted from current modal body (drop zone, details, key terms). Behavior unchanged.
- New: `frontend/components/CaptureModal/RecordAudioPanel.tsx` — form fields only (microphone selector placeholder, Test microphone button placeholder, inert input-level meter shell, title, key terms, disabled Language/Diarization mirrored from `CaptureDetails`). `Start Recording` button is rendered but **disabled** with a tooltip: "Recording mode is not yet available."
- Modify: `frontend/components/CaptureModal/CaptureFooter.tsx` to adopt tab-aware CTA copy (`Begin transcription` / `Start Recording`).
- Modify: existing tests in `__tests__/captureModal.ui.test.tsx` to assert tab structure; verify Upload tab still passes its existing test cases.

**Implements spec sections:** Capture Modal Design (Tabs, Upload Audio Tab, Record Audio Tab fields only — no permission, no live meter, no real Start), Footer Behavior.

**Dependencies:** None. Can start immediately.

**Ship criteria:**

- All existing capture-modal tests pass without modification of their assertions (Upload path untouched).
- New test asserts Record tab renders form fields and a disabled Start CTA.
- Manual: switching tabs does not resize the footer; Upload flow still uploads a file end-to-end.

**Risks:**

- Radix Tabs styling needs Olivetti tokens applied carefully; not all `data-state` selectors are obvious. Low risk, just attention to detail.
- Existing test data-testids (`segment-card`, `audio-controls`, etc. from memory) are not affected, but any test that mounts `CaptureModal` directly may need a `Tabs` provider wrapper.

**LOC estimate:** ~600.
**Time estimate:** 1–2 days.

---

### PR 2 — Session singleton + recording page shell (mocked state)

**Goal:** Build the architectural backbone — the session singleton, the React context, the `/recording/new` route, and the header pill — all wired against synthetic state. No `MediaRecorder` yet.

**Scope:**

- New: `frontend/lib/recording/session.ts` — module-level singleton with state machine (`idle`, `recording`, `paused`, `finalizing`, `uploading`, `submitted`, `discarded`, `error`, `interrupted`), event emitter, `__resetForTesting()`.
- New: `frontend/lib/recording/RecordingSessionContext.tsx` — thin React context exposing `useRecordingSession`, `useRecordingState`, `useRecordingActions`. Provider injected at root layout.
- New: `frontend/app/recording/new/page.tsx` — full layout: title heading, state pill, elapsed-time display, mocked waveform area, controls (Pause / Resume / Stop & transcribe / Discard — all wired to singleton actions but no real recording behind them).
- New: `frontend/components/RecordingSession/` — `RecordingControls.tsx`, `RecordingWaveformMock.tsx`, `RecordingStateLabel.tsx`, `RecordingTimer.tsx`.
- Modify: `frontend/components/ContextualHeader.tsx` — add `RecordingPill` component that subscribes to the singleton. Visible when state is `recording` or `paused`, clickable.
- New: `frontend/__mocks__/recording-session.ts` — test helper for forcing singleton state in tests.

**Implements spec sections:** Recording Experience > Page Layout, Header Recording Indicator, Data And Architecture > Session State Container, Recording Lifecycle state machine.

**Dependencies:** PR 1 (Record tab exists, even if disabled).

**Ship criteria:**

- Page renders correctly for each state when the singleton is forced into that state via dev tools or test helpers.
- Header pill appears/disappears based on singleton state.
- Singleton survives client-side navigation between `/projects` and `/recording/new`.
- Jest tests can reset the singleton between cases without leakage.

**Risks:**

- **HMR + singleton state survival in dev.** Module-level state can be tricky with Next.js Fast Refresh. The singleton must explicitly handle the case where the module is reloaded mid-session (probably: store on a `globalThis` key for dev).
- **React 18 Strict Mode double-invocation** may cause the singleton's state listeners to register twice. Need to confirm subscribe/unsubscribe is idempotent.
- The header pill's click-to-return needs to use the guarded navigation introduced in PR 3 — until then, clicking it just routes normally (acceptable for this slice).

**LOC estimate:** ~650.
**Time estimate:** 1–2 days.

---

### PR 3 — Live mic capture, size budget, entry conditions, nav lock

**Goal:** Make the recording real. End-to-end, the user can grant permission, record, pause, resume, and stop. Submission still doesn't wire up to the upload pipeline — that's PR 4.

**Scope:**

- New: `frontend/lib/hooks/useMicTest.ts` — owns explicit microphone acquisition/testing, preferred-device selection, and the pre-recording input meter.
- New: `frontend/lib/recording/recorderController.ts` — owns `MediaRecorder` lifecycle, chunk callbacks, pause/resume, and track cleanup after the modal hands the stream off.
- New: `frontend/lib/recording/codecs.ts` — codec selection logic with browser-support detection. Exports `selectCodec()` and the corresponding extension.
- Modify: `frontend/lib/recording/session.ts` — attach the recorder controller, manage stream lifecycle, accumulate `bytesSoFar` and `accumulated_active_ms`, and expose restart/stop actions.
- Modify: `frontend/components/CaptureModal/RecordAudioPanel.tsx` — implement Test microphone button: requests `getUserMedia`, populates device dropdown via `enumerateDevices()`, drives input-level meter via `AnalyserNode`. Persist selected `deviceId` to `localStorage` (`recording.preferredDeviceId`). Stream is committed to the singleton on Start Recording (no double prompt).
- Modify: `frontend/app/recording/new/page.tsx` — implement page entry conditions (fresh handoff / interrupted state / direct visit redirect). Implement dynamic size budget banner (~5 s warmup, then predicted time remaining at ≥ 80%, auto-stop at 97% so the final recorder flush has headroom). Implement empty-floor gate (< 2 s OR < 4 KB → hide Stop, show inline banner).
- New: `frontend/lib/recording/guardedNavigation.tsx` — `useGuardedNavigate` hook + `<GuardedLink>` wrapper. While the singleton has unsaved chunks, navigation attempts surface a confirm dialog ("Leaving this page will discard your recording. Continue?"). The header pill's click-to-return now uses guarded navigation correctly.
- New: `frontend/lib/recording/useBeforeUnloadGuard.ts` — attach/detach `beforeunload` listener while session has unsaved chunks.
- Modify: `frontend/lib/hooks/useCapture.ts` — extend `SUPPORTED_MIME_TYPES` with `audio/webm` (the existing `audio/mp4` support is already reused by the recorder path).
- Modify: `frontend/proxy.ts` — add `/recording` to protected routes.
- Modify: `frontend/components/CaptureModal/RecordAudioPanel.tsx` — `Start Recording` button now actually fires `MediaRecorder.start()` and routes to `/recording/new` (the page renders the in-progress session).
- Modify: `frontend/components/CaptureModal/CaptureModal.tsx` + `CaptureFooter.tsx` — **enable** the Record-tab `Start Recording` CTA and drop the "not yet available" tooltip. The disabled state is now codec-driven (`"Audio recording isn't supported in this browser."` when `selectCodec()` returns `null`).

**Implements spec sections:** Modal-To-Page Handoff, Page Entry Conditions, Navigation Policy, Recording Size Budget, Recording Lifecycle (all subsections), MIME / File Handling.

**Dependencies:** PR 1, PR 2.

**Ship criteria:**

- User can complete a full recording session in Chrome and Safari: open modal → switch to Record tab → Test microphone → grant permission → device meter live → Start Recording → page shows in-progress recording → pause / resume → Stop.
- Empty-floor gate blocks Stop on recordings < 2 s or < 4 KB.
- Size budget banner appears within the warmup-aware logic on a long recording.
- Refresh on the recording page shows the `interrupted` state with metadata preserved.
- Direct URL visit to `/recording/new` redirects to `/projects` and opens Capture on the Record tab.
- Navigation attempts during recording trigger the confirm dialog; confirmed cancels discard the session correctly.
- `beforeunload` fires browser warning on close/reload.
- Pause/Resume work correctly on Safari 15.4+ (per spec's codec gate).

**Risks (this is the highest-risk PR):**

- **Safari `MediaRecorder` quirks.** Codec support, `pause()` behavior, and `dataavailable` timing differ. Test early.
- **iOS Safari background-tab kills.** Recording may die when tab is backgrounded. Out of scope for full handling, but verify the failure path (PR 4's salvage policy covers this).
- **Guarded navigation in Next.js App Router.** No clean `routeChangeStart` hook in App Router; the helper must wrap `useRouter().push`, `useRouter().replace`, `useRouter().back`, `<Link>` clicks, and browser back via `popstate`.
- **`AnalyserNode` cleanup.** Failure to disconnect the analyser on unmount or device change leaks audio context. Use `useEffect` cleanup carefully.
- **HMR singleton bleed.** Mid-recording HMR reload will land in the interrupted state — verify the recovery flow works in dev.
- **React 18 Strict Mode** may double-invoke effects; permission requests must be idempotent.

**LOC estimate:** ~1,000.
**Time estimate:** 2–3 days.

---

### PR 4 — Pipeline handoff, salvage policy, end-to-end submission

**Goal:** Stop & transcribe actually creates a project and uploads. After this PR, the feature is fully functional.

**Scope:**

- Modify: `frontend/lib/recording/session.ts` — replace the mocked post-stop tail behind `stopAndFinalize()` with the real handoff: await the final `dataavailable`, concatenate chunks into a `Blob`, wrap as `File` with generated filename (`recording-{ISO}.{ext}`), and submit it through the existing capture pipeline.
- Modify: `frontend/app/recording/new/page.tsx` — keep Stop & transcribe wired to the singleton submission action and compute the persisted title fallback at submit time: `Recording — {Intl.DateTimeFormat}` if the user left title blank.
- Modify: `frontend/lib/recording/session.ts` — implement recorder-failure auto-submit salvage policy. On `error` event, `track.ended`, or sustained `track.muted`: if chunks pass the empty floor, transition to `finalizing → uploading` automatically with a banner explaining the failure; otherwise transition to `discarded` with a banner.
- Modify: `frontend/lib/recording/session.ts` and `frontend/app/recording/new/page.tsx` — retain the finalized recording file when upload/project/storage submission fails before the file is durably saved. The error state exposes `Retry upload`, treats the retryable file as unsaved recording data, and confirms before discard/navigation clears it.
- Modify: storage allow-lists and Supabase migrations — allow `audio/webm` uploads for browser `MediaRecorder` output in both fresh local schemas and already-applied databases.
- (PR 3 already enables the `Start Recording` CTA and drops the "not yet available" tooltip; PR 4 only swaps the trailing mock progression for the real submission pipeline.)
- Modify: navigation after submission → `/projects` with the existing realtime subscription showing the new project as Processing.

**Implements spec sections:** Recording Lifecycle > Stop & Transcribe, Recording Lifecycle > Discard, Title And Filename Defaults, Error Handling (salvage policy).

**Dependencies:** PR 1, PR 2, PR 3.

**Ship criteria:**

- End-to-end smoke test: open Capture → Record tab → record 10 seconds → Stop → land on `/projects` → see new project transitioning through `queued → processing → complete`.
- Recorder failure mid-session (simulated by revoking permission in browser dev tools) triggers the salvage path: auto-submit if above floor, with banner; auto-discard if below floor, with banner.
- Title fallback `Recording — {locale date}` appears as the project title when user left title blank.
- Upload failure before durable save keeps the user on the recording error page with `Retry upload`, preserves the finalized file for retry, blocks conflicting new recordings, and requires confirmation before discard.
- Failure after the media is uploaded/linked reuses the existing `useCapture` `saved_needs_retry` / `saved_status_unknown` outcomes and routes back to `/projects`.
- The Record tab's `Start Recording` now drives the real submission pipeline (no longer the mock `finalizing → uploading → submitted` progression).

**Risks:**

- **Race between final `dataavailable` and submission.** `MediaRecorder.stop()` is async; the final chunk fires after the stop call. The recorder controller must await both stop and the final chunk drain before concatenating, with a short fallback for browsers that dispatch `stop` without a final non-empty chunk.
- **Salvage on permission revoke** — the `track.ended` event fires before `dataavailable` of in-flight data is necessarily flushed. May need a forced `requestData()` call before submission.
- **Filename collision** is extremely unlikely given ISO timestamp precision, but `useCapture` upserts with `upsert: false` — verify a defensive uniqueness handler.

**LOC estimate:** ~300.
**Time estimate:** 1 day.

---

### PR 5 — Live waveform, tests, cross-browser polish

**Goal:** Polish — replace mocked waveform, land the test suite, smooth out per-browser quirks.

**Scope:**

- Modify: `frontend/components/RecordingSession/RecordingWaveform.tsx` — replace mocked bars with `AnalyserNode`-driven frequency or time-domain visualization. Canvas-based, 60 fps, throttled to `requestAnimationFrame`. Pauses rendering when state is `paused`.
- New: `frontend/__mocks__/MediaRecorder.ts` — testable `MediaRecorder` mock for Jest.
- New: `frontend/__mocks__/getUserMedia.ts` — `navigator.mediaDevices` mock helpers.
- New tests: `__tests__/recording/session.test.ts`, `__tests__/recording/recorderController.test.ts`, `__tests__/recording/recordingPage.test.tsx`, `__tests__/recording/sizeBudget.test.ts`, `__tests__/recording/entryConditions.test.tsx`, `__tests__/recording/salvagePolicy.test.ts`, `__tests__/recording/headerPill.test.tsx`.
- Modify: `frontend/jest.setup.ts` — add singleton reset between tests.
- Cross-browser QA pass: Chrome, Firefox, Safari macOS, Safari iOS, Edge.
- Fix any per-browser bugs surfaced during QA.

**Implements spec sections:** Recommended Implementation Phases > Phase 4 (Polish).

**Dependencies:** PR 1, PR 2, PR 3, PR 4.

**Ship criteria:**

- All new tests pass and the existing suite remains green.
- Live waveform renders smoothly during recording, freezes during pause, clears on stop.
- Manual smoke test on each target browser completes successfully.

**Risks:**

- **Live waveform performance** on lower-end devices may need throttling beyond `requestAnimationFrame`. Have a fallback to the mocked bar animation if `AnalyserNode` allocation fails.
- **Test isolation.** Singleton state bleeding between tests is the most likely source of flakes. The reset must run in `beforeEach` globally.
- **iOS Safari `AnalyserNode`** has had historical bugs with `getByteFrequencyData` returning zeros after certain state transitions. Verify before committing to time-domain vs. frequency-domain choice.

**LOC estimate:** ~700 (mostly tests).
**Time estimate:** 1–2 days.

---

## Final merge to `main`

Once PR 4 has merged to `Record-on-demand` (the feature is functional) and PR 5 has merged (polish complete), open the final PR:

- Title: `feat(recording): in-app microphone recording`
- Body: links to the spec, summarizes the user-facing feature, lists the merged sub-PRs.
- Squash or merge commit per the project's convention.

## What this plan does **not** include

- **Live streaming transcription** (explicit non-goal in the spec).
- **A recording_drafts persistence model** for crash-mid-recording recovery (deferred per spec; Phase 1 accepts the data-loss surface).
- **Review/playback state** between Stop and submit (deferred; will land alongside a user-settings system if/when that is built).
- **Backend changes** — the entire feature reuses the existing project creation, storage upload, and Inngest transcription pipeline. No API surface, schema, or Deepgram integration work is needed for Phase 1.

## Tracking

Each PR's "ship criteria" is the merge bar for that slice. If any criterion slips, the slice does not land — write a follow-up PR rather than merging incomplete work.

Update this document if the plan changes during execution. The spec is the immutable design contract; this plan is mutable and is expected to evolve as risks surface.
