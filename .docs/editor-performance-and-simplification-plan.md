# Editor performance and simplification

Status: baseline and implementation plan only. No production editor changes implemented.

Agreed on 2026-11-07. The work is delivered through three sequential PRs into
one integration feature branch, then one final PR into `main`.

Revised after the [plan review](reviews/2026-11-07-editor-plan-review.md): draft
separation is conditional, UI extraction moves to PR 2, and PR 1 explicitly covers
save-answer/status costs, scroll rendering and no-op state transitions. A second
review adds the fast/late/mixed audio failure matrix, repeated-scroll no-ops and
the independent playback-time state path. The review also records two reproduced
correctness bugs; no fixes are implemented here.

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
- Preserve three substantive PRs. The audio retry correction is an isolated first
  fix/commit within PR 1, reviewed separately from the optimisations, rather than
  silently creating a fourth PR or changing baseline application code now.
- PR 3's conflict-recovery UI requires the user's review and approval of its
  proposed interaction before implementation. Read-only design and independent
  loading work need not wait for that decision.

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

## PR 1: performance and bounded correctness fixes

### Scope

- Build one `TextEdit[]` for Replace All from matches grouped by segment. Reuse
  it for one history step and bulk draft/save scheduling. Preserve valid ordinary
  replacement behavior, but do not preserve the confirmed Unicode-offset bug.
  Correct original-text offsets/lengths in matching before consolidating consumers;
  single Replace, Replace All, highlights, snippets and undo must agree. Keep this
  correctness fix identifiable in its own commit and regression coverage.
- Batch optimistic segment/draft/status updates and debounce/expiry work instead
  of repeating whole-array/record work for each changed segment. Remove idle
  status entries. Retain the existing batched text RPC and ordered write queue.
  Specifically batch the save answer: `writeDrafts`' per-segment `saved` loop,
  error statuses and the reset work that follows. Faster click handling alone
  does not satisfy this item; retain draft identity checks for in-flight typing.
- Share private guarded-write construction between autosave and departure
  snapshots without changing captured revisions, baselines or error handling.
- Bound Find result/snippet work, avoid closed-modal construction, and keep all
  matches navigable. A bounded window must include the current result, including
  results beyond the first window. Preserve highlights after closing.
- Memoise the list/cards with stable callbacks, per-segment props and stable
  empty/speaker values. Preserve clock subscriptions, current-segment transitions,
  current-match highlighting, scroll behavior, caret updates and virtualised row
  identity. Reviewer scratch comparators are evidence, not production comparators.
- Preserve state identity in `clearExpiredLocks` when neither lock changes and in
  `USER_SCROLL` when its resulting fields are already equal. Test genuine expiry,
  seek/resume transitions and commands, not only repeated no-op events.
- Decide on moving playback time/progress values into a store from direct
  EditorScreen render counts and measured attributable work after card/list memos.
  `handleTimeUpdate` still sets screen-owned time state on each changed tick, so
  no-op reducer fixes alone are not expected to remove playback renders. Little
  improvement from those fixes must not be interpreted as evidence against the
  time store. Test the complete combination if time-state isolation is justified,
  reusing the existing clock/subscription approach where suitable.
- First, isolate and cap automatic audio-URL recovery attempts. Test a component
  that actually re-renders on source refresh with both inline and stable callbacks:
  fast failures (50 ms), late failures (6 s), and one late failure followed by fast
  ones. A timeout-only fix leaves the fast loop; stable callbacks alone leave the
  late loop. Preserve late successful loading, position restoration, explicit retry
  opportunities and cleanup. Define the cap's reset policy explicitly; the hook's
  own refreshed URLs, callback identities and repeated failures must not reset it
  into an unlimited cycle. Add these regressions before changing retry behavior.

Primary areas: `frontend/app/(app)/editor/[id]/EditorScreen.tsx`, its list/card
components and mutation/search/speaker hooks, and `frontend/components/FindReplaceModal.tsx`.

### Reuse first

| Responsibility | Existing implementation to reuse | Planned change |
| --- | --- | --- |
| Text replacement and history | `TextEdit`, `recordReplace`, existing grouped matches | Build one edit list with correct source offsets |
| Sending and completion | `saveAll`, `writeDrafts`, guarded RPC, draft identity checks | Batch scheduling, answer statuses and expiry around them |
| Playback/follow | `playbackClock`, scroll reducer and current-word subscription | Fix no-op identity; independently profile screen-owned time state to decide on selective subscriptions |
| Audio recovery | `useAudioSessionRecovery`, pending-wait cleanup | Cap automatic recovery across re-renders and fast/late/mixed failure sequences |
| Result navigation/list | Existing Find modal and Virtuoso list | Bound snippets and narrow memoised card props |

### Risks and acceptance

- Replacement/history: verify Unicode, repeated matches, replacement text
  containing the search term, undo/redo, typing during a save, lost answers and
  conflicts within a batch. Uncontended Replace All remains one RPC and one
  history step, without per-segment whole-transcript updates/reset timers. Measure
  click handling, save-answer processing and the complete status-reset window
  separately in the browser; `act` batching is not proof of browser render counts.
- Rendering: ordinary playback ticks within one segment must not render unrelated
  cards; typing must not render every mounted card. Test active-word/segment
  transitions, scrubbing, search, speaker edits and splits as well as counts.
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
  through a re-rendering component. Repeated automatic requests must stop at the
  chosen cap in every cell; assert the cap's legitimate reset/retry conditions.
  Retain slow successful load, original-source abort, pause/play position, unmount,
  account-change and user-triggered retry behavior. A stable mocked callback on a
  non-re-rendering hook mount is insufficient regression coverage.
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
