# Editor performance PR 1 verification

Integration base: `30861c2`. The test-only baseline is `3bf1384`. Audio recovery
is the first production commit. See the [enriched baseline](editor-performance-baseline.md)
for the starting workload.

All four runs used the same 5,000-segment and 100,000-word Jest fixture with
real Virtuoso, mocked audio and mocked requests. Times are single-run jsdom
measurements. The deterministic checks use counts, not elapsed time.

| Measure | Baseline | Before card memo | After card memo | After scroll identity |
| --- | ---: | ---: | ---: | ---: |
| Cards rendered per keystroke, median | 20 | 20 | 1 | 1 |
| Cards rendered, 10 playback ticks | 264 | 264 | 7 | 7 |
| Cards rendered, 4 playback ticks | 143 | 143 | 6 | 6 |
| Cards rendered per scrub move, median | 20 | 20 | 0 | 0 |
| Retained card renders across 10 scrolls | 196 | 196 | 0 | 0 |
| Newly mounted rows across 10 scrolls | 12 | 12 | 12 | 12 |
| EditorScreen calls per scroll move, median | 2 | 2 | 2 | 0 |
| EditorScreen calls, 4 playback ticks | 13 | 13 | 13 | 13 |
| Find wall time to results | 820.2 ms | 105.7 ms | 66.9 ms | 72.8 ms |
| Replace All click wall time | 3,185.6 ms | 31.0 ms | 24.6 ms | 24.8 ms |
| React render time in post-Replace All window | 9,850.9 ms | 65.1 ms | 59.2 ms | 72.9 ms |

Find still counted all 9,998 matches and mounted nine snippet rows. The
Replace All run sent one guarded request for 5,000 edits. Timer tests measured
one bulk debounce and one expiry callback. The post-save jsdom observation
includes the wait and batches notifications through React testing helpers.

## Production browser

Chrome used the isolated local Next.js production build with both client and
server pointed at the local Supabase API. Browser resource timing confirmed
local segment requests on both named fixtures. The test account opened a
fresh browser profile. The two named fixtures were read-only.

On both fixtures, Find opened with six mounted snippets out of 1,999 and
9,998 matches respectively. Previous wrapped to the last result, reopening
placed that result in view, and clicking it closed the dialog and jumped
to the highlighted segment.

Playback and scrub traces used Chrome DevTools Protocol at 4x CPU slowdown,
a 1,440 x 900 browser window, and the local 10-hour transcript. Each playback
sample ran for 60 seconds. Each scrub sample used 10 seconds of trusted
pointer movement across a wide fraction of the waveform. Durations are
renderer main-thread tasks containing the corresponding event.

| Sidebar | Run | Timeupdate events | Timeupdate p95 | Scrub pointer moves | Scrub median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Closed | 1 | 224 | 1.00 ms | 202 | 48.64 ms |
| Closed | 2 | 226 | 0.87 ms | 159 | 61.63 ms |
| Open | 1 | 226 | 1.45 ms | 214 | 44.27 ms |
| Open | 2 | 226 | 1.63 ms | 187 | 51.91 ms |

The wide scrub crossed the 16 ms investigation threshold. A follow-on comparison
used the same mini scrubber and gesture with follow scrolling enabled and
suspended. With follow enabled the median was 54.28 ms across 164 pointer
moves, with 157 transcript scrolls and 2,269 card mounts. With follow suspended
the median was 2.12 ms across 307 moves, with zero transcript scrolls and zero
card mounts. The time display continued updating in both cases. This isolates
the expensive work to following the seek across virtual rows in this workload.
PR 1 keeps the existing time state.

## Save verification on disposable local copies

Both copies loaded with the named fixture audio requested through a read-only
browser route override. All text writes targeted the copies. Five inputs on
each size kept textarea focus and reached the local save path. The median
input-to-two-animation-frame proxy was 33.3 ms on the 2-hour copy and 33.0 ms
on the 10-hour copy.

On the 10-hour copy, Replace All cleared all 9,998 matches in one successful
request. Click to the second animation frame took 22.0 ms, the RPC took
1,619.7 ms, and the interval from its answer to the first Saved label was
8.6 ms. The labels expired 1,210.3 ms later. The browser reported zero Long
Tasks between the click and expiry. One guarded undo restored the copy to
the text checksum captured before copying.

The live RPC returned a response range of `0-999/*` after committing 5,000
edits. The mutation hook now advances the expected saved text for every
acknowledged edit, then adopts the rows supplied by the response. A focused
regression verifies that typing on an omitted row uses the bulk text as its
expected value.

The final production build repeated the operation in one request with the same
response cap. Typing on a row beyond the first 1,000 returned rows saved in one
additional request. Typing undo and bulk undo each took one guarded request.
Both copies matched their captured text checksums afterward and were removed
by ID from the local database.

The named 10-hour fixture changed between the initial and final reads. At
03:02:45.550249 UTC on 7 November, 3,333 rows acquired the same update timestamp.
They now contain `Friday`. Substituting `Thursday` for `Friday` in a read-only
checksum query reproduces the captured text checksum exactly. The fixture has
3,666 edited rows, up from 3,333. The matching API logs show guarded text saves
from the development app on port 3000. They do not identify the initiating
action or user. Replace All and history use the same endpoint. The PR 1 browser
save tests ran on port 3001 and wrote to the disposable copies.

For comparable PR 2 browser measurements, capture and checksum a fresh test
copy, then use that text for both the before and after runs. The named fixture
was left in its current state.

## Checks and limits

- Full Jest passed with 229 suites, 2,993 tests and seven snapshots.
- Typecheck and the isolated local production build passed. Lint reported zero
  errors and 57 warnings.
- Audio failure, delayed recovery and position continuity were exercised
  through the actual hooks with simulated media events. The production browser
  exercised regular playback, scrubbing, Find, editing, saves and undo.
- The review follow-up restored the five-second Play fallback. The regression
  exercises Play before and after the limit, verifies one URL request and one
  media play call, and checks late position restoration. The follow-up passed
  518 tests across 36 suites, typecheck and lint for the changed files.
- The Chrome task timings come from one Mac at 4x CPU slowdown. Safari,
  Windows and hosted behavior were outside these runs.
