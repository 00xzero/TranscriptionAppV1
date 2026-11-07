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
