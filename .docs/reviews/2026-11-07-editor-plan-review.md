# Editor plan review: corrections and disposition

Date: 2026-11-07. Reviewed against application code at `9245586`, with baseline
documents/harness at feature-branch tip `54ab865`. No production code was changed.
Second-review checks below were made after documentation commit `574bf93`; the
application code was unchanged.

## Decisions

| Reviewer recommendation | Disposition |
| --- | --- |
| Make PR 2's draft split conditional | Accepted. Measure production builds after PR 1 at both fixture sizes; keep optimistic segment text unless a meaningful remaining cost warrants changing ownership. Removing redundant display state and extracting UI remain useful independently. |
| Name save-answer/status costs explicitly | Accepted. Batch `writeDrafts`' saved/error results and expiry work, not only scheduling/click handling. |
| Drop provisional-ID scoping | Accepted. The module counter avoids same-module collisions; the small accumulating map is not a demonstrated user-facing problem. Avoid rewiring queued actions/history for this feature. |
| Move popover extraction to PR 2 | Accepted. It is UI simplification with substantial interaction verification, not a performance prerequisite. |
| Add scrolling; fix no-op ticks before a playback store | Refined on second review. Preserve unchanged lock and USER_SCROLL state identities. Playback time still changes screen-owned state, so decide on a time store from direct counts/cost, not the effect of reducer-only fixes. Legitimately entering virtualised rows still render. |
| Stop preserving Unicode behavior | Confirmed bug. Original-source offsets must be correct; the old output must not become an equivalence-test contract. Track the correction alongside search work in PR 1 as an identifiable correctness commit. |
| Fix audio recovery first | Fast/late/mixed retries reproduced through a re-rendering component with inline and stable callbacks. Cap automatic retries; plan an isolated first correction within PR 1, retaining three PRs. |
| Close the other two investigations | Closed as blockers for this feature, with the limitations below; no claim of a fix or broader policy guarantee. |

House rules: one CHANGELOG entry at the end of the integration branch; reuse-first
tables in all PR plans; user approval of the conflict-recovery interaction before
PR 3 builds that UI.

## Verified mechanisms

### Save answers

`useTranscriptMutations.writeDrafts` calls `showSaveStatus` once for every saved
draft at lines 198-200. Each call spreads the current status record and schedules
an independent reset; resets spread the record again. Thus batching only the
Replace All click leaves the answer/reset work intact. Draft identity checks must
still prevent an older answer clearing newer typing.

The reviewer's approximately 4-second freeze / 834-render Chromium stand-in result
was supplied in the review and was not independently rerun. Our committed jsdom
baseline already records an expensive post-save window, but `act` batching means
its commit counts cannot stand in for browser timer scheduling.

### No-op ticks and measurement attribution

Running the actual transpiled `transitionScrollSyncState` with unchanged active
segment and no locks produced equal values but a different state object and no
commands. `clearExpiredLocks` allocates unconditionally, and the hook dispatches
that replacement state. Returning the original state for an unchanged lock pair
is a bounded optimisation; expiry and command behavior require regression tests.

The second review found a separate allocation in `USER_SCROLL`. A direct probe of
the actual reducer, already in `userScrolling` with `hasUserScrolled=true`, again
produced equal values but different identity and no commands. Preserve identity
when all resulting fields are equal, while retaining lock expiry and real
seek/resume changes.

`useEditorPlayback.handleTimeUpdate` independently calls `setAudioCurrentTime` and
updates progress/duration. Changed time values still re-render their owning screen
even if the scroll reducer returns its original state. The prior expectation that
lock cleanup should first materially reduce playback rendering was misplaced.
Profile the screen directly after memos and decide on time-state isolation from
that result. A reducer-only run showing little playback improvement neither
disproves the need for a store nor tests the complete fix.

The committed render harness wraps the whole editor in a Profiler. Its 25
"screen renders" during simulated playback are 25 subtree commits, not proof of
25 calls of EditorScreen. Count the function separately before attributing all
residual time to it. A scratch memo comparator that ignores the current-match
highlight is not safe to transplant unchanged.

The reviewer's 20-to-1 typing renders, 4.7 ms render time, approximately 1.8 ms
derived passes, 400-to-0 scroll renders and 188 ms playback result are useful
reported experiments, not independently reproduced baseline numbers. They justify
measurement gates rather than a mandatory state-store refactor.

### Unicode-offset bug (open; not fixed)

The matcher lowercases the haystack, then uses those indices and the lowercased
needle length against the original string. JavaScript lowercasing can expand a
character into multiple UTF-16 code units. A direct reproduction using the current
matching/replacement expressions gives:

```text
Input:                 İstanbul the end
Search:                the
Replacement:           X
Index in original:     9
Index after lowercase: 10
Current output:        İstanbul tXend
Correct output:        İstanbul X end
```

Both Replace and Replace All consume these offsets. Highlighting, snippets and
whole-word boundaries must also refer to the intended original source range.
The earlier recommendation to preserve these edge-case outputs was incorrect.
Correct them with regression tests for matches after an expanding character,
matches involving that character, and original-string match lengths. Ordinary
forward-replacement equivalence remains useful where the source offsets are valid.

### Audio recovery loop (open; not fixed)

A temporary Jest reproduction mounted the actual `useAudioSessionRecovery` hook
with an EventTarget-based fake audio element and a successful mocked media-URL
fetch. It dispatched an initial error, then repeatedly:

1. dispatched `loadstart` for the refreshed source;
2. advanced fake timers by 5,001 ms;
3. dispatched another source error.

The fetch and refreshed-URL callbacks reached four calls, one per failure cycle.
The timeout releases `isRecoveringRef` and the general error listener can fetch
again. The hook has no bound for repeated late failures. This is a deterministic
hook-level reproduction, not a live signed-URL/network reproduction.

The reproduction plus existing recovery and scroll-machine suites passed 22
tests across three suites in 1.115 seconds. The temporary test was removed after
review so this update contains documentation only; recreate and retain the
regression in the isolated fix commit. Specify bounded retry/reset behavior and
preserve slow successful loads, user retry opportunities, position and cleanup.

### Second review: fast and mixed audio failures

The original reproduction used a stable mock callback without a source-state
re-render and only tested late failure. It did not cover the editor's inline
callbacks in `useEditorPlayback`.

A second temporary test rendered a real component with `useState(audioSrc)` and
the actual recovery hook. Mocked media responses returned successive fresh URLs,
so refresh callbacks caused real component re-renders. It tested inline callbacks
and `useCallback`-stable callbacks, dispatched `loadstart` and source errors, and
advanced fake timers to simulate three cascading failure sequences. A sequence
stopped when no new refreshed source was produced. All six results matched the
reviewer's reported matrix:

| Sequence (up to 20 refreshed-source failures) | Inline callbacks | Stable callbacks |
| --- | ---: | ---: |
| Fast: 50 ms | 21 requests | 1 request |
| Late: 6 seconds | 21 requests | 21 requests |
| One late failure, then fast | 21 requests | 21 requests |

Counts include the initial media-URL request before the refreshed-source failures.
The matrix reproduction plus existing recovery and scroll-machine suites passed
27 tests across three suites in 1.082 seconds. The temporary matrix test was
removed; only documentation is retained in this review commit. Persist this
coverage in PR 1's first fix commit with assertions for bounded requests instead
of the current looping counts.

Callback dependency changes can affect error-listener ordering across re-renders;
the timeout also permits subsequent attempts. Stabilising callbacks alone or
changing timeout handling alone is therefore insufficient. Add an explicit retry
cap and specify legitimate resets/user recovery; a self-generated refreshed URL
must not reset that cap. Retain delayed success and lifecycle cleanup tests.

## Closed as feature blockers, with explicit limits

- **Unexpected unmount:** normal guarded navigation flushes drafts and waits for
  the queue. The unguarded-unmount fallback is best effort; an older save can make
  a newer departure snapshot's expected text stale and refuse it. Guarded writes
  prevent an overwrite and the fallback attempts an unsaved-text notification.
  This does not guarantee the newest draft persists after an abrupt departure.
  No navigation redesign is part of this performance feature.
- **Completed status:** the editor page redirects readable unfinished transcripts;
  the text RPC checks account ownership plus expected text/revision. The RPC/RLS
  do not enforce completed status. The pipeline's current content-save function
  separately refuses a completed transcript or a non-processing job under the
  transcript lock. This is sufficient to remove the item as a performance blocker,
  not proof of a universal database rule rejecting all unfinished text edits.

## Supplied Claude review on `9302cc2`: disposition

This follow-up was requested by Hamza after the baseline documentation was
consolidated into `9302cc2`. Hamza explicitly reconfirmed continuous scrolling
for Find results, not pages. Only planning/review documents change here.

The supplied review reports approval of the audio toast ("Couldn't load the
audio", Retry), a separate single-Replace skip correction, and a default of no
playback store without a demonstrated problem. These decisions are incorporated
in the owning plan alongside continuous virtualised Find results.

| Supplied correction | Disposition |
| --- | --- |
| 1. Do not rearm on loadeddata immediately | Accepted. Require 60 seconds without an intervening failure before the next automatic recovery credit. Invalidate/consume that load's credit at its next failure, including failed fetches; time passing after an early failure cannot rearm it. |
| 2. Retry from Play and toast; truthful failed state | Accepted. Share an explicit guarded manual retry path; cap visibility too. Preserve one feedback notification per failed attempt/episode and stop false playing state. No optional online listener is planned. |
| 3. Retain original position across attempts | Accepted. Capture once per unresolved recovery and keep it across failed source swaps/fetches; Play retry requests resumption. Verify highlight behavior in integration tests. |
| 4. Cap shared refresh, including stalled | Accepted. All automatic triggers pass the shared cap; manual retry is explicit. Add the full six-sequence matrix for both callback styles. |
| 5. Explicit Unicode mechanism and partial expansion policy | Accepted. Whole-string lowercase, direct-offset fast path, expansion mapping, widening partial hits, existing lowered whole-word checks. Also prevent overlapping source ranges after mapping. |
| 6. Concrete debounce/status batching design | Accepted. Keep typing timers, add one bulk timer, clear all on saveAll; saved expiry alone uses a deadline Map/earliest timeout. Preserve synchronous drafts and identity checks. |
| 7. Continuous virtualised Find | Accepted. Use the installed Virtuoso, lazy row snippets, current-result initial positioning and content-driven height capped at 300 px. No result pages or range caption. Scratch-page animation variation needs verification in the actual modal before acceptance. |
| 8. Direct click-to-jump | Accepted and independently reproduced. Add jumpToMatch rather than depending on an effect disabled by closing. |
| 9. Separate commits/configurations and enriched harness | Accepted with clarification. Capture the enriched unchanged-application baseline before fixes; step 6 is additionally a pre-memo run after earlier changes, not an original baseline. Persist separate memo and reducer measurements. |
| 10. Numeric production-browser playback gate | Qualified acceptance. Use 16 ms for investigation and the proposed 50% retention target on comparable runs, but require attribution before adding a store. Windows frame problems need demonstrated improvement in that problem; task timings alone do not justify the store. 4 Hz is a reference stimulus, not a universal browser event rate. |
| 11. Protect named fixtures from Replace All | Accepted and verified from the RPC. Use disposable copies because undo does not restore is_edited. The unedited 2-hour fixture also cannot receive restorable typing without changing flags; use a copy for that. |
| 12. Fix Replace skipping | Accepted and independently reproduced. Separate small commit, source-position advancement past inserted text, and explicit end/wrap/no-next-target tests. |

Minor refinements accepted: plain React.memo; all four speaker display primitives;
stable range callbacks using existing refs; search-clear render-isolation assertions;
unchanged-edit filtering and updates only to existing editingTexts keys; a pure
per-draft guarded-edit builder that leaves copy-out collection alone; unchanged
speaker-assignment row identity; and existing keyed editor-session remounts.

Keep the prior per-segment current-match value instead of deliberately passing a
different global index to every card on navigation. Both can be correct, but the
per-segment prop provides simple isolation without a custom comparator. For scroll
state, a local complete field comparison can canonicalise every equal reducer
result, but the hook must also skip dispatch; commands must execute even when
state is unchanged. Preserve expiry and seek/resume fields in the comparison.

### Additional checks actually run in this planning review

- Two temporary Jest tests under `/private/tmp` exercised the current actual
  search hook, and the hook with the actual Find modal. Three Replace actions
  changed segments 0, 2 and 4, leaving 1 and 3 unchanged. Clicking the fifth result
  closed the modal with zero transcript scroll calls. Both reproduction assertions
  passed (1 suite, 2 tests, 1.039 seconds). These demonstrate current bugs, not fixes;
  retain intended-behavior regressions with the implementation. No application/test
  file was added to the repository for these checks.
- A Node v24.12.0 scan of Unicode scalar values found one code point whose default
  lowercase form expands in UTF-16 (`U+0130`) and none that shrink in that runtime.
  Whole-string `ΛΟΓΟΣ` lowercased to `λογος`, while separately lowercasing characters
  produced `λογοσ`. This supports retaining whole-string comparison, not hardcoding
  a permanent claim about all future Unicode/JavaScript versions.
- Environment classification, without printing keys or endpoint values, confirmed
  local Supabase in `infra/.env.docker` and a non-local target in
  `frontend/.env.local`. Installed Next.js environment documentation confirms public
  build-time inlining and process-environment precedence. Explicit local build and
  runtime settings are required before production-browser fixture writes.
- Read the actual text RPC: its update sets `is_edited=true`; undo uses guarded text
  writes and does not restore the original edit flags. Read the actual query/hook,
  player and reducer paths supporting the batching/retry/identity concerns.

The supplied audio load-then-fail/stalled counts, Chromium dead-source behavior,
Find scratch-page results and timing comparisons were not independently rerun in
this turn. They remain attributed reviewer evidence. No production-browser,
Safari or Windows performance measurement, full test suite, build, or database
write was run here. The 16 ms threshold is a proposed decision rule, not a measured
current problem. Both untracked SQL scripts remain untouched.

## Final rereview: disposition

Accepted both audio corrections and the three implementation notes. These
refine the previous disposition; they do not expand PR 1 beyond the existing
recovery and Find workstreams.

| Rereview item | Disposition |
| --- | --- |
| Distinguish refresh failure from media failure | Only `audio.error` on the current source triggers terminal controls/toast. A healthy source's failed proactive refresh consumes the allowance, logs a warning and leaves playback/clock running. Test no toast and one request under repeated stale-stalled events. |
| Report the first suppressed terminal failure | A genuine error after a load inside 60 seconds stops false playing and reports once even if the cap prevents a fetch. Repeated events stay silent. Cover a later genuine error following a quiet proactive failure too. |
| Guard the recovery clock directly | `useEditorPlayback` refreshes once when playing goes false, and the frame loop reads the attached player while playing. Guard both around terminal failure and successful swaps, preserving the last meaningful position until restoration. Test both paths. |
| Keep Play intent during an in-flight attempt | Record resume intent without another request, respect newer Pause intent and make an old toast Retry inert after the session closes. |
| Use only initial positioning on Find mount | Let Virtuoso position the current result initially; skip the mount effect's redundant imperative scroll and verify subsequent navigation. Continuous scrolling remains unchanged. |
| Commit the baseline harness first | Accepted. A test-only first commit makes the unchanged-application baseline reproducible. Audio remains the first production fix; retain a separately labelled pre-memo measurement. |

The recovery and clock paths above were checked against source. No new runtime
reproduction, browser benchmark or application change was made for this rereview.
