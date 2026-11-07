# Editor performance and simplification

Status: baseline and implementation plan only. No production editor changes implemented.

Agreed on 2026-11-07. The work is delivered through three sequential PRs into
one integration feature branch, then one final PR into `main`.

Revised after the [plan review](reviews/2026-11-07-editor-plan-review.md): draft
separation is conditional, UI extraction moves to PR 2, and PR 1 explicitly covers
save-answer/status costs, scroll rendering and no-op state transitions. A second
review adds the fast/late/mixed audio failure matrix, repeated-scroll no-ops and
the independent playback-time state path. The subsequent review on `9302cc2`
adds continuous virtualised Find results, explicit audio retry and stability
rules, Replace advancement and click-to-jump fixes, and staged measurements.
The review records reproduced correctness bugs; no fixes are implemented here.

## Branch structure

Integration branch: `codex/editor-performance-and-simplification`.

Starting point: `main` at `92455861a1f32ffb2a6dc873d0bb78f8be44b751`
(also the local `origin/main` tracking ref when this branch was created; no
remote freshness claim is implied).

| PR | Head branch | Base branch | Starting point |
| --- | --- | --- | --- |
| 1 | `codex/editor-performance-pr1` | `codex/editor-performance-and-simplification` | Feature branch after the baseline commit |
| 2 | `codex/editor-performance-pr2` | `codex/editor-performance-and-simplification` | Feature branch after PR 1 merges |
| 3 | `codex/editor-performance-pr3` | `codex/editor-performance-and-simplification` | Feature branch after PR 2 merges |
| Final integration | `codex/editor-performance-and-simplification` | `main` | Feature branch after all three PRs merge |

Create each PR branch only when its predecessor has merged. Do not branch all
three from the baseline or target their PRs at `main`. Each PR is a substantial,
coherent delivery; smaller internal commits do not imply additional PRs.

The baseline commit records this plan, the baseline report and the existing
synthetic render harness/fixture. It does not implement PR 1. No remote branch
or PR is created merely by documenting this structure.

## Working rules

- Write the feature's `CHANGELOG.md` entry at the end of the integration branch,
  before the final feature-to-main PR, not independently in PRs 1-3.
- Every PR plan includes a reuse-first table: existing helper/component/contract,
  proposed extension, and the reason an existing abstraction is insufficient if
  a new one is needed. Initial tables appear below; refine them during planning.
- Preserve three substantive PRs. The audio retry correction is the isolated first
  production fix within PR 1, reviewed separately from the optimisations. A test-only
  enriched-harness/baseline commit comes first so its baseline is reproducible.
  Neither change creates a fourth PR or changes application code during planning.
- PR 3's conflict-recovery UI requires the user's review and approval of its
  proposed interaction before implementation. Read-only design and independent
  loading work need not wait for that decision.
- Find results use a continuous, virtualised scrolling list: no result pages,
  page controls or "Showing 101-200" line. Retain the existing match summary.
- Audio failure feedback is approved: an error toast titled "Couldn't load the
  audio" with a Retry action, following the existing word-timings toast pattern.
- Fix single Replace skipping matches in PR 1 as a separate small commit.
- Playback time isolation defaults to no new store. Add and retain one only
  under PR 1's measured gate or a reproduced Windows playback/scrub problem.

## Baseline and measurement

See [the baseline report](reviews/editor-performance-baseline.md) for commands,
environment, measurements, validation results and limitations.

The [local browser supplement](reviews/editor-performance-browser-baseline.md)
records the existing test-account 2-hour and 10-hour examples. Retain these
fixtures for comparable browser checks as each PR lands, restoring temporary
test edits and recording build mode separately from synthetic/Jest results.

The existing harness uses 5,000 segments and 100,000 words with the real
Virtuoso implementation under controlled jsdom geometry. Its player and data
requests are mocked. Preserve this reference workload and compare equivalent
runs after each PR. Do not convert local wall-clock measurements into brittle
CI thresholds or present them as production-browser latency.

Use deterministic assertions for render isolation, bounded DOM, write requests
and correctness as their corresponding fixes land. A baseline report should
not permanently assert today's excessive render counts.

Before production-browser profiling, supply the local Supabase URL, public key
and required server credentials from `infra/.env.docker` explicitly to both
build and runtime. The host `frontend/.env.local` currently targets a non-local
Supabase service; it must not provide fallback Supabase settings for these runs.
Public settings are embedded at build time, so a runtime override alone is
insufficient. Validate that browser and server requests reach the local stack
before fixture writes, without printing secrets. Translate any Docker-only
internal address for the host, and isolate the profiling build from the running
development build. No environment changes are made during planning.

Do not run browser Replace All on the named 2-hour or 10-hour baseline fixtures.
The text RPC sets `is_edited=true`; undo restores text but not the original flags.
Use a disposable local copy for Replace All, verify its final text/history and
remove only that copy afterward. Named fixtures retain read-only checks and
restorable typing on an already-edited segment; check text and edit flags before
and after. The 2-hour fixture currently has no already-edited segment, so typing
there also requires a disposable copy if its baseline is to remain unchanged.

## PR 1: performance and bounded correctness fixes

### Scope

1. **Isolated first audio fix.** Put the automatic-attempt cap inside the shared
   refresh function used by error, stale-stalled and visibility triggers. Permit
   one automatic attempt per unresolved failure episode. Neither a self-refreshed
   URL, callback identity, effect re-registration, repeated event nor the 5-second
   wait timeout replenishes it. A refreshed source's `loadeddata` does not rearm it
   immediately: the next failure must come at least 60 seconds after that load,
   with no intervening failure. Consume/invalidate that load's recovery credit at
   the next failure, even if its fetch fails, so elapsed time alone cannot rearm
   repeated errors/stalls after an earlier failure. Only a load belonging to the
   newly started source counts. The 60 seconds is an explicit retry policy, not a
   claim that the file is valid. A new keyed editor session starts fresh.

   Return a manual `retry` path from `useAudioSessionRecovery`. Play on a failed
   source or during a pending recovery, and the approved toast's Retry, use it;
   each activation starts at most one request, with the same in-flight guard.
   Record a Play press's resume intent before returning from that guard, so an
   already-running attempt resumes on success without a second fetch. Restoration
   reads current intent, not only the play state captured when the attempt began;
   a newer Pause cancels resume intent. A retained toast action is inert after
   unmount/account change: no request, playback, state change or notification.
   Automatic visibility events also obey the cap. Keep the original restore
   position across failed attempts. After success, a later failure can capture a
   new restore point.

   Terminal handling requires a real current-source failure (`audio.error` set).
   For that failed source, an exhausted allowance or failed fetch sets playing
   false and reports the approved toast. The first suppressed terminal failure
   of an episode must report even if it makes no request, including a load that
   fails inside the 60-second stability interval. Later suppressed failures of
   that episode remain silent. A failed proactive refresh while the original
   source is healthy (`audio.error` null) spends its automatic allowance but only
   logs a warning: playback/clock continue and no failure toast appears. It must
   not retain an obsolete restore target for audio that kept playing. If the
   source subsequently really fails with no allowance, report that first terminal
   failure once. A play-promise rejection alone does not prove a media failure.

   Guard clock reads directly, including the final `refresh()` when playing goes
   false and the running frame loop during a source swap. Hold the last meaningful
   position before the source is reset; do not sample intermediate zero via frame,
   timeupdate or seeked callbacks. Resume sampling only after position restoration.
   Healthy proactive fetches need no clock hold until an actual source swap. Test
   both terminal failure and a successful swap for transient jumps to the first
   segment; setting playing false alone is not a sufficient guard. This is local
   recovery coordination with the existing clock, not the optional time store.
   Reuse the existing toast shape, with title "Couldn't load the audio" and Retry.
   Handle recovery play-promise rejection; a rejected user play must leave truthful
   controls without automatically launching an uncapped refresh chain. No new
   online listener is required.

   Preserve old-source abort handling, late success after the timeout, restoration,
   callback freshness and lifecycle/account-change cleanup. Retain original target
   position when a failed source has reset the element to zero. Add regression
   coverage before changing retry behavior.

2. **Unicode source ranges, separate commit.** Keep whole-string `toLowerCase()`
   for comparison, including contextual Greek sigma. When source and lowered
   lengths match, retain the direct-offset path. Otherwise walk the source once
   to map lowered UTF-16 units back to original source spans; determine expansion
   widths without replacing the whole-string comparison text with per-character
   lowercase output. Widen a partial expansion hit to the full source character
   (`i` can find `İ`), and prevent overlapping mapped spans from producing
   overlapping edits. Keep whole-word checks in the lowered comparison text
   before mapping, preserving existing boundary semantics. Single Replace,
   Replace All, highlights, snippets and undo use the same original-source ranges.

3. **Single Replace advancement, separate commit.** Stop incrementing an index
   into the pre-replacement match array. Advance from the end of the inserted
   text in the updated source, so remaining matches are not skipped and inserted
   occurrences are not immediately selected again. Define and test end-of-document,
   wrapping and no-next-target behavior explicitly alongside Next/Prev's existing
   navigation. Cover adjacent matches, multiple segments, empty replacement,
   no-op replacement and replacement containing the search term.

4. **Batch scheduling and the complete save lifecycle.** Build one `TextEdit[]`
   from matches grouped by segment, filter unchanged edits, and reuse the changed
   list for history and scheduling. Read `segments.get()` into a Map once, capture
   revisions and set missing baselines before one optimistic `segments.update`.
   Drafts must exist synchronously in the click's tick for `hasDrafts`/departure.
   Update only already-present `editingTexts` keys for changed segments, keeping
   its existing readers current without adding an entry for every replaced row.
   Leave optimistic segment text ownership in place.

   Keep typing's per-segment debounce timers. Bulk scheduling has one bulk timer
   entry in the same record; saveNow and unmount clear it too. When saveAll begins,
   clear every pending save timer. Preserve the existing first-due-save rule that
   takes every waiting draft, rather than promising independent save deadlines.

   Use one `showSaveStatuses(ids, status)` for save answers, errors, reload results
   and batch-failure handling. Saved-status deadlines use one Map and one earliest
   timeout. A new status cancels that segment's prior expiry; the sweep deletes
   due idle entries in one state update, only where still saved. Keep draft-object
   identity checks before settlement and clear the expiry timer on unmount.

   Share only the private pure conversion of one draft plus baseline into one
   guarded `SegmentTextEdit`. Keep autosave/departure loops and their distinct
   responsibilities: departure still collects every draft's copy-out text. Retain
   guarded RPCs, ordered writes, resend behavior and conflict handling.

5. **Continuous Find results and direct jump.** Use the existing react-virtuoso
   package with `data={matches}`. Build a snippet only when its virtual row renders,
   and construct the source index only while results are open and usable. Keep all
   matches/counts, transcript highlights after closing, and the existing "N of M
   matches" summary. There are no pages, page controls or range caption.

   Mount the list with `initialTopMostItemIndex` centred on the current match;
   skip the navigation effect's first run for each mounted list so mount does not
   also call `scrollToIndex`. Use `scrollToIndex` for subsequent Next/Prev and
   selections, testing that the first actual navigation is not swallowed. Keep
   the viewport height content-driven via `totalListHeightChanged`, capped at
   300 px, with a nonzero
   initial measuring viewport. Opening/reopening, search changes and clamped match
   indices must show the current row. Do not use a match-index key that remounts
   the list on every navigation. Replace snippet-ref scrolling with the list API.
   Extend the mock only for APIs actually used; test DOM bounds with real Virtuoso.

   Add `jumpToMatch(index)` to the search hook: set selection and directly scroll
   to its transcript segment before the modal closes. Do not rely on the current
   open-only effect, which loses the scroll when close and selection batch together.
   Avoid duplicate scrolls if the modal remains open during a selection.

6. **Memo and identity changes.** Use plain React.memo, stable callbacks and
   per-segment props: editing flag/text, status, busy/locked flags, active/flashing
   flags, source-word array and stable empty matches. Speaker primitives include
   label, colour, avatar text and organisation. Keep a per-segment current-match
   value so old/new highlights update without intentionally invalidating every
   card. Preserve clock subscriptions, caret updates and virtualised row identity.
   Stabilise `handleRangeChanged` through existing segment/machine refs, ensuring
   their freshness during split/refresh range callbacks. Retain
   unchanged row objects in `mergeSpeakerAssignments` when speaker_id is equal;
   retain the outer array too when no assignments change, without changing refresh
   or reconciliation policy.

   Canonicalise equal scroll-reducer results back to the original state with a
   local explicit field comparison; cover all no-op events, including USER_SCROLL
   and FOLLOW_SUSPENDED. Compare the complete result, including expired locks and
   seek/resume fields. The hook must skip dispatch for identical state, and still
   execute commands: equal state is not permission to discard a scroll command.

7. **Playback time isolation is conditional.** No-op reducer fixes do not remove
   independent changed-time updates from `handleTimeUpdate`. Measure their owning
   screen directly after list/card memoisation and scroll identity changes. Add a
   store only under the gate below; reuse the existing clock/subscription approach
   and preserve actual media timing versus scrub-preview semantics.

Primary areas: `frontend/app/(app)/editor/[id]/EditorScreen.tsx`, its list/card
components and mutation/search/speaker hooks, and `frontend/components/FindReplaceModal.tsx`.

### Reuse first

| Responsibility | Existing implementation to reuse | Planned change |
| --- | --- | --- |
| Text replacement and history | `Match`, `TextEdit`, `recordReplace`, grouped matches | Source-span mapping is needed because folded offsets corrupt source text; reuse contracts and fix advancement |
| Sending and completion | `saveAll`, `writeDrafts`, guarded RPC, draft identity checks | Bulk timer plus grouped answers/expiry; no second write queue or general scheduler |
| Departure | `draftEdits`, existing draft/baseline records | Share one pure edit builder; keep copy-out collection and snapshot lifetimes |
| Playback/follow | `playbackClock`, scroll reducer and current-word subscription | Preserve equal state and commands; conditionally isolate transport time only under the gate |
| Audio recovery | `useAudioSessionRecovery`, pending-wait cleanup | Cap all automatic triggers, retain restore intent, expose explicit retry |
| Failure feedback | `wordTimingsFailedToast` shape and existing toaster | Audio-specific title/action; no new notification system |
| Find result list | Existing Find dialog and installed react-virtuoso | Reuse virtual rows; the current eager snippet array cannot bound DOM/work |
| Card props and refresh | Existing list/card components and `mergeSpeakerAssignments` | Narrow props, stabilise callbacks and retain unchanged row identity |

### Commit and measurement order

Keep three PRs; these are reviewable commits inside PR 1:

1. Test-only enriched render harness and recorded unchanged-application baseline.
2. Audio cap, stability/reset rules, explicit retry and persistent regressions;
   this is the first production fix.
3. Unicode source-range correction and regression coverage.
4. Single Replace advancement correction.
5. Batch scheduling, answers, status expiry and shared write construction.
6. Continuous virtualised Find results and click-to-jump; record pre-memo results.
7. List/card memoisation and supporting prop/row identity changes.
8. Scroll reducer identity and hook dispatch guard.
9. Playback time isolation only if justified and shown to help.

Capture the enriched harness's unchanged-application baseline in its test-only
first commit, before the first application fix, so the baseline can be rerun from
a commit. Also record step 6 as a pre-memo measurement, not the original baseline.
Retain the old 10-ticks/second scenario for comparison and add a representative
4-ticks/second scenario plus user scrolling. Count EditorScreen calls separately
through its once-per-render `useEditorKeyboardShortcuts` hook, with a delegating
test mock; subtree Profiler commits retain their own correct label. Count cards
per segment so new virtual rows are distinguishable from unchanged mounted rows.

After step 8, profile a production build in Chrome DevTools Performance on the
10-hour fixture, at 4x CPU slowdown, sidebar closed and open. Record repeated
60-second playback and continuous 10-second scrub runs, actual event rates, and
the same viewport/build/environment. The reference playback stimulus is 4 Hz,
not a claim that every browser always emits timeupdate at that rate.

Investigate time-state isolation if the p95 timeupdate task or median scrub
pointermove task is at least 16 ms. This is a proposed investigation threshold,
not a measured current failure or proof that the store is the remedy. Require
trace attribution to screen-owned playback work before implementing one. Retain
it only if comparable repeated runs reduce the failing metric by at least half
without regressions. Otherwise omit/revert it and record the result. Reproduced
dropped frames on Hamza's Windows machine are a separate trigger even if those
task thresholds pass; retain a store only if it demonstrably improves that
specific frame problem. No Windows result is assumed or required to invent one.

### Risks and acceptance

- Replacement/history: verify Unicode, repeated matches, replacement text
  containing the search term, undo/redo, typing during a save, lost answers and
  conflicts within a batch. Verify single Replace does not skip alternate matches
  or immediately select its inserted text. Uncontended changed Replace All remains
  one RPC and one history step, without per-segment whole-transcript updates/reset
  timers. Measure
  click handling, save-answer processing and the complete status-reset window
  separately in the browser; `act` batching is not proof of browser render counts.
- Rendering: ordinary playback ticks within one segment must not render unrelated
  cards; with search clear, typing must not render unrelated mounted cards. With
  active search, rebuilt matches may legitimately invalidate matching cards; profile
  that separately in PR 2 rather than promising complete isolation here. Test
  active-word/segment transitions, scrubbing, search, speaker edits and splits
  as well as counts.
  Add user scrolling to the harness: distinguish unchanged mounted cards from
  newly mounted virtualised rows and legitimate layout/follow transitions. Repeated
  user-scroll events already in `userScrolling` preserve state identity only when
  no fields change; lock expiry and seek/resume changes still take effect.
- Count EditorScreen function renders separately from subtree Profiler commits;
  the current harness's "screen renders" labels are commit counts, not direct
  measurements of that function. Preserve current-match highlight changes when
  tuning memo props/comparators. Compare card/list memoisation, reducer no-ops and
  any time-state isolation separately; do not expect reducer no-ops to suppress
  the independent changing-time updates.
- Recovery: cover all three timing sequences with inline and stable callbacks
  through a re-rendering component, plus repeated load-then-fail at 1 second,
  load-then-fail an hour later, and failed fetch with repeated stale-stalled events.
  Expected recovery requests are 1 in each sequence except the hour-later case,
  which permits 2; counts include the initial recovery fetch. Continue events after
  the cap. Test 59,999/60,000 ms boundaries and ensure an early failure followed by
  time passage does not create fresh recovery credit. Repeated visibility events
  also obey the automatic cap. Assert manual Play/toast retry, at most one concurrent
  request, once-only feedback, original position and legitimate reset conditions.
  Add a healthy-source stale-refresh fetch failure: audio.error remains null,
  playing stays true, the clock keeps advancing, no toast, and repeated automatic
  triggers still make only one request. If a real error follows, its first
  suppressed failure reports once. Load-then-fail inside 60 seconds must stop false
  playing and toast once despite making no new request; later suppressed events
  stay silent. Play during an in-flight attempt updates resume intent, makes no
  second request, and resumes after restoration. A stale Retry callback after
  unmount/account change is a no-op. Verify successful and failed source swaps
  never publish an intermediate zero clock position.
  Retain slow successful load, original-source abort, pause/play position, unmount,
  account-change and user-triggered retry behavior. A stable mocked callback on a
  non-re-rendering hook mount is insufficient regression coverage.
- Find: real-list DOM remains bounded with 9,998 matches; every result is reachable
  by continuous scrolling. Test opening on a distant match, Next/Prev, wraparound,
  rapid navigation, query changes, few-result height, click-to-jump and closing
  focus. Assert initial positioning alone on mount, no duplicate mount scroll,
  and functioning subsequent navigation. Check open-animation measurements in
  the actual modal; scratch-page row height differences are not pre-accepted
  behavior. Address them if they visibly
  misalign results or hide the current match; record harmless residual variation.
- Run relevant tests, lint, typecheck and build; record comparable scale results
  and browser evidence with explicit verification limitations.

Do not change text ownership, extract the popover/textarea, or rescope provisional
IDs in this PR. Do not change
database grants/RPCs, auth, the pipeline, shared pagination or loading policy.

## PR 2: UI and text simplification; conditional draft separation

### Scope

- Introduce one effective-text interface, migrate consumers, and remove redundant
  `editingTexts` storage. Keep saved baseline, unsaved draft and IME composition
  as explicitly distinct responsibilities.
- Keep optimistic `segments[].text` ownership by default. After PR 1, profile
  production-build typing on the 2-hour and 10-hour fixtures with repeated
  comparable inputs and separate render/derived-work measurements. Split drafts
  from the segment collection only if meaningful, reproducible length-dependent
  cost remains attributable to those updates. A tiny difference or jsdom timings
  alone do not justify the added ownership model.
- If draft separation is justified, first audit every optimistic-text consumer,
  especially `applyTexts` undo checks and `useSegmentSplit`'s current-text guard.
  Migrate those semantics together; simply leaving `segments[].text` as saved text
  would change correctness. Keep the queue, sender, history and holds.
- Keep text-dependent search and speaker excerpts current deliberately; do not
  hide a rebuilt merged transcript array behind a selector and recreate the cost.
- Extract `useSegmentTextInput` against the settled interface, preserving native
  undo, Safari drag handling, composition, caret restoration, autosizing and split
  shortcuts. Keep ref lifetimes and unmount cleanup equivalent.
- Extract `EditorSpeakerPopover` to own dismissal, trigger switching, invalid-name
  hold-open behavior, close animation and focus restoration. Keep mount/ref
  lifetimes and frozen-closing-content behavior. Provisional-ID scoping is dropped
  from this feature unless a concrete correctness issue is found.

Removing redundant display text and extracting the textarea/popover can proceed
even if the draft separation gate is not met. Record the gate's result explicitly.

### Reuse first

| Responsibility | Existing implementation to reuse | Planned change |
| --- | --- | --- |
| Effective text | Optimistic segment text, baseline and drafts | Consolidate readers and remove redundant `editingTexts` |
| Textarea | Existing card refs, effects and event handlers | Extract without changing interaction/ref lifetimes |
| Speaker picker | Existing actions, Popover primitives and frozen closing content | Move interaction rules into a focused component |
| Optional subscription model | PR 1 memo boundaries and existing live stores | Add selective draft subscriptions only if production profiling warrants it |

### Risks and acceptance

- Verify typing during saves/reloads, draft identity, composition commit/cancel,
  composition overlapping undo/reload, virtualisation and segment split/rejoin.
- Search, display, exports and speaker excerpts must read the intended text;
  audit consumers before changing the base segment semantics.
- Browser-check Chrome and Safari interactions where available; report gaps.
- Re-run production-browser typing at both sizes, with search cleared/set and the
  sidebar open/closed. Record whether draft separation was needed; do not promise
  to eliminate every linear pass regardless of measured cost.
- Popover: browser-check same/different trigger clicks, outside click, Escape,
  invalid names, close animation, trigger removal and sidebar navigation.
- Verify leave/sign-out and account-change protections, with disposable fixtures.

A full `EditorSession` rewrite is not a prerequisite. Do not alter loading or
external-change policy as a side effect of this refactor.

## PR 3: loading and external-change recovery

### Scope

- Fetch metadata alongside the other initial data, expose failures/retry, and
  reduce embedded-word payload duplication while preserving validation.
- Measure editor-specific paging improvements before introducing bounded
  concurrency. Leave the shared `paginateRows` helper unchanged initially.
- Reconcile external changes on focus through the existing queue, including
  text, structural changes and deletions. Distinguish own acknowledged writes
  and preserve drafts typed while a refresh was in flight.
- Retain conflicting local text in a recoverable surface. Settle the exact
  copy/discard/reapply interaction with the user in this PR's plan and obtain
  their design approval before building the UI. Never silently overwrite either
  version or automatically merge conflicting text.
- Share reconciliation rules between focus refresh and repair.

### Reuse first

| Responsibility | Existing implementation to reuse | Planned change |
| --- | --- | --- |
| Loading and word validation | Editor queries, revision pairing and word schemas | Reduce payloads and overlap metadata without weakening validation |
| External refresh | Existing focus/visibility refresh and ordered read queue | Reconcile changed text/shape and preserve in-flight drafts |
| Conflict handling | Existing reconciliation and unsaved-text copy support | Propose the recovery interaction for user approval before building |

### Risks and acceptance

- Preserve the segment/word revision relationship and initial word-loading
  independence. Test delayed/malformed/failed words and concurrent split/rejoin.
- Test two-tab edits, focus during a save, typing during refresh, offline return,
  deleted transcripts and account changes during requests.
- Measure initial display, payload/request counts and conflict recovery. Record
  browser/network results separately from jsdom and mocked request results.
- Verify project/tag/transcript-index behavior if any shared interfaces change.

Realtime, workers and sophisticated incremental repair are follow-ups only if
measurement demonstrates the need; they are not required for this PR.

## Guarantees and final integration

Every PR preserves ownership/RLS boundaries, ordered writes, resend safety,
draft identity checks, guarded history, segment holds and navigation protections
unless a separately specified behavior change is part of its scope.

The audio-recovery loop is reproduced and has the isolated PR 1 correction above.
The unguarded-unmount save race and missing completed-status condition in the text
RPC are closed as blockers for this feature, with their limits documented in the
review. This is not a claim they were fixed or that RLS enforces completed status;
no database or navigation redesign is planned for them here.

Before the final feature-to-main PR, run the full Jest suite, lint, typecheck and
production build on the integrated tree. Repeat browser checks across editing,
playback, Find/Replace, speakers, split/history, leave/sign-out and account changes.
Attach baseline-to-final measurements and disclose unverified environments.

## Delivery record

| Delivery | Status |
| --- | --- |
| Feature branch baseline | First commit; see baseline report |
| PR 1 | Not implemented; revised plan ready for the planning chat |
| PR 2 | Not started |
| PR 3 | Not started |
| Feature branch to main | Not started |
