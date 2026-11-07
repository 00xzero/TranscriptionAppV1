# Editor performance: existing local browser fixtures

Date: 2026-11-07 (Europe/London). Supplements the
[synthetic baseline](editor-performance-baseline.md); no production application
changes have been made. Application code remains at `9245586`, with the plan and
synthetic baseline committed as `7b90603` on
`codex/editor-performance-and-simplification`.

## Setup

- Existing Docker development stack at `http://localhost:3000`, with local Supabase;
  no restart, seeding, migration, container rebuild or environment changes.
- Running frontend Node.js v24.22.2; Next.js development build, with development
  tooling and duplicate initial data requests observed. This is not the production
  build used by the earlier automated build check.
- Chrome 156.0.0.0, isolated browser context signed into the repository's test
  account. Credentials, cookies and tokens are not included in this report.
- Viewport 1,440 x 900, DPR 1, CPU slowdown 1x, no simulated network throttling.
- Only the explicitly labelled render-cost fixtures were opened for measurement;
  personal transcripts were not edited.

The existing fixtures were confirmed by read-only database counts:

| Fixture | Transcript ID | Duration | Segments | Words |
| --- | --- | ---: | ---: | ---: |
| Long meeting (2 h, render-cost test) | `7e57a1a0-0000-4000-8000-00000000a02b` | 7,200 s | 1,000 | 20,000 |
| Long meeting (10 h, render-cost test) | `7e57a1a0-0000-4000-8000-00000000a10b` | 36,000 s | 5,000 | 100,000 |

Both have four speakers and an average of 20 stored words per segment. The 10-hour fixture
matches the synthetic harness's segment/word count. It already had edits before
this check, so its content should not be assumed identical to the harness.

## Load and Find samples

One warm document navigation per fixture, with cached application assets. The
10-hour route was loaded once beforehand to warm development compilation. These
are individual samples, not repeated-run medians or controlled causal estimates.

| Measurement | 2-hour fixture | 10-hour fixture |
| --- | ---: | ---: |
| First segment card added to DOM, from navigation start | 2,221.4 ms | 3,790.4 ms |
| Last plain-segment response completed | 2,090.1 ms | 4,053.1 ms |
| Last embedded-word response completed | 2,960.2 ms | 6,030.8 ms |
| Mounted segment cards once settled | 15 | 15 |
| Plain-segment page requests observed | 4 | 12 |
| Embedded-word page requests observed | 4 | 12 |
| Find `the`: matches and rendered result buttons | 1,999 | 9,998 |
| Find: Enter to matching result summary in DOM | 167.8 ms | 676.3 ms |
| Find: Enter to second animation-frame callback after results | 250.2 ms | 1,075.9 ms |

Each data stream requested all nonempty pages and an empty terminal page twice
in this development run. The response timings include both observed streams;
they are network-completion markers, not completion of parsing or word alignment.
Cross-origin Resource Timing did not expose response byte sizes, so no browser
payload-size claim is made.

The initial cold 10-hour visit added its first card at 9,778.9 ms and included a
6,628.3 ms media-URL request. It is excluded from the warm comparison because
development startup/compilation materially changes the workload.

## Typing sample on the 10-hour fixture

With playback paused, search clear, sidebar closed and words loaded, open the
second segment's textarea and insert `x` five times using browser input. The
automation calls were several seconds apart, so autosave/status work ran between
inputs. This is a sparse-input sample, not a continuous-typing benchmark.

Measure from the capture-phase `input` listener to a nested
`requestAnimationFrame` callback. This is a responsiveness proxy spanning an
intervening rendering opportunity; it is not an INP score, hardware key-to-pixel
latency, or proof of exact paint timing.

| Sample | Input to second animation frame |
| --- | ---: |
| 1 | 143.1 ms |
| 2 | 162.9 ms |
| 3 | 134.5 ms |
| 4 | 141.5 ms |
| 5 | 139.4 ms |
| Median | 141.5 ms |

Long Tasks entries around these inputs were 128-156 ms. Later autosave/status
windows also contained long tasks of 176-211 ms. This identifies observable
main-thread work, without attributing every millisecond to a particular function.

The typed text was then restored through the normal input/autosave path. The
selected segment was already marked edited, so this did not add a new edited-row
flag. Before/after text checksums and edited-row counts matched for both fixtures:

| Fixture | Text checksum (MD5 over ordered segment IDs and text) | Edited rows before/after |
| --- | --- | ---: |
| 2-hour | `7b97bb241b525ae8ab6a1db2ffa61d4f` | 0 / 0 |
| 10-hour | `0fec8916c791b50b3057ada41189d461` | 3,333 / 3,333 |

The 2-hour fixture was not typed into. Normal autosaves updated the tested
10-hour segment's modification timestamp; text and edit flag were preserved.
No direct database updates were used for restoration.

## Repeating the browser check

1. Use an isolated test-account context and the same viewport/development mode.
   Warm application compilation separately from the measured navigation.
2. Before application scripts execute, install a MutationObserver that records
   `performance.now()` when the first `[data-testid="segment-card"]` appears,
   and a buffered Long Tasks observer. Record native Resource Timing entries for
   `/rest/v1/segments`, separating `select=*` from embedded-word requests.
3. Wait for word requests and UI work to settle, then count mounted cards. Record
   document-navigation and data-completion markers separately.
4. Open Find, set `the`, and press Enter before the 800 ms search debounce fires.
   Time from capture-phase Enter to the populated match summary and a subsequent
   double-animation-frame callback. Count the current/jump-to-match buttons.
5. For typing, use an already-edited segment in the synthetic 10-hour fixture;
   capture the original text in page memory, record five input/frame intervals,
   restore the text and wait for successful autosave. Verify checksums afterward.
6. For implementation comparisons, retain both original fixtures and report any
   changes in their content, build mode, viewport or measurement method. Repeat
   samples before making stronger performance comparisons.

Do not commit raw network traces containing session headers, signed media URLs
or transcript bodies. The temporary instrumentation used here only retained
timings/counts; its fetch wrapper did not clone or separately parse responses.

## Consequences for the three-PR plan

- The baseline already models the 10-hour size; this check adds evidence from the
  real development stack and browser, rather than increasing the synthetic size.
- Five times the words produced about five times the Find result DOM and a much
  slower search response in these samples. This supports bounding snippets and
  batching work before a larger state refactor.
- Both fixtures mounted 15 cards. Total transcript length amplifies whole-data
  work, but it does not multiply mounted cards proportionally. The existing
  harness establishes excess card render counts; no browser render counts were
  inferred from DOM mutations.
- Segments appeared before all words finished, as designed. Loading and repair
  remain PR 3 concerns; these timings do not justify expanding PR 1's scope.
- Production-build latency, repeated-run distributions, browser playback/scrub
  rendering, browser Replace All, Safari/mobile and hosted behavior remain
  unmeasured here. The synthetic Replace All baseline remains the reference until
  a dedicated browser run with controlled restoration is recorded.
