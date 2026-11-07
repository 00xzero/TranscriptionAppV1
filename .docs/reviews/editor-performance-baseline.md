# Editor performance baseline

Date: 2026-11-07 (Europe/London).

Integration branch: `codex/editor-performance-and-simplification`.
Production-code baseline: `92455861a1f32ffb2a6dc873d0bb78f8be44b751`.
The feature branch's first commit adds the plan, this report and measurement
fixtures, with no production application changes.

See [the overall plan](../editor-performance-and-simplification-plan.md) for the
three sequential PRs and their integration rules.

The follow-up [local browser baseline](editor-performance-browser-baseline.md)
checks the existing test-account 2-hour and 10-hour fixtures. Its development-build
timings supplement, rather than replace, the synthetic measurements below.

## Environment and workload

- Local macOS 27.0.1, arm64; Node.js v24.12.0; npm 11.7.0.
- Installed application versions: Next.js 16.4.4, React 19.3.1,
  react-virtuoso 4.18.20 and Jest 30.5.2 (verify against the lockfile for reruns).
- Jest/jsdom development rendering with the real Virtuoso implementation and
  fixed geometry: 900 px viewport, 110 px item height, existing 1,200 px overscan.
- Synthetic 10-hour transcript: 5,000 segments, 20 words per segment, 100,000 words,
  four speakers rotating every three segments.
- Player callbacks and data requests are mocked; no audio, Storage, WorkOS,
  transcription-provider or database writes occur in the render harness.
- The transcript metadata mock uses a complete schema-valid fixture. This is the
  only adjustment to the pre-existing untracked harness for baseline capture.

The harness and long-transcript fixture existed untracked before this task and
are intentionally included in the baseline commit. The pre-existing
`frontend/scripts/seed-scale-account.sql` and
`frontend/scripts/measure-editor-words-query.sql` remain uncommitted and were not
run. No local accounts, recordings, databases, containers or secrets were changed.

## Reproduction

Run from `frontend/` with installed dependencies:

```sh
EDITOR_RENDER_REPORT=1 npm test -- --runInBand __tests__/editor/renderCost.test.tsx
```

Run the measurement separately from builds and other test processes to reduce
resource contention. `EDITOR_RENDER_SEGMENTS` can change the segment count for
comparisons, but the canonical recorded workload uses the default 5,000. Keep
environment, fixture, geometry and mock behavior consistent between PRs.

The five scenarios measure initial mounted cards; 20 typed characters in one
segment; ten playback callbacks over approximately one second, plus starting and
stopping playback; 20 scrub previews; and Find/Replace All of `the` with `a`.
The Replace All scenario also observes saves/status updates during an 8-second
wait. Event-loop work can make the actual elapsed interval longer than 8 seconds.

## Recorded measurements

One isolated local run on 2026-11-07; five scenarios passed in 30.665 seconds.
Timings below are milliseconds unless otherwise indicated.

| Measurement | Baseline |
| --- | ---: |
| Mounted cards | 20 |
| Typing: median card renders per keystroke | 20 |
| Typing: median Profiler commits per keystroke | 2 |
| Typing: median React render duration | 10.9 ms |
| Typing: median event wall time | 14.8 ms |
| Typing: card renders during the 1.5 s post-typing observation | 20 |
| Playback: card renders in simulated second, including start/stop | 264 |
| Playback: React render duration | 281 ms |
| Playback: Profiler commits | 25 |
| Scrub: median card renders per preview | 20 |
| Scrub: median React render duration per preview | 8.5 ms |
| Find `the`: matches | 9,998 |
| Find `the`: wall time to show matches | 841.5 ms |
| Replace All: event wall time | 3,246.8 ms |
| Replace All: React render duration | 2,697.2 ms |
| Replace All: card renders | 20 |
| Replace All: save requests | 1 |
| Replace All: segments sent in save | 5,000 |
| Post-Replace All observation: Profiler commits | 2 |
| Post-Replace All observation: React render duration | 11,303.7 ms |
| Post-Replace All observation: longest React render | 11,274.8 ms |
| Post-Replace All observation: actual elapsed wall time | 19,328.6 ms |

The counts confirm broad mounted-card invalidation and a single already-batched
save request. Expensive Replace All and status-update processing remain present
even when React batches their notifications; this baseline does not attribute all
elapsed time to any one function.

## Validation

All commands below ran from `frontend/` against the baseline application and
the metadata-fixture correction described above.

| Command | Result |
| --- | --- |
| `npm run test:ci -- --silent` | Passed: 229 suites, 2,951 tests, 7 snapshots; 104.327 s |
| `npm run lint` | Passed: 0 errors, 58 warnings |
| `npm run typecheck` | Passed (`next typegen` and `tsc --noEmit`) |
| `npm run build` | Passed: production Turbopack compilation, TypeScript and route generation |
| Isolated render-harness command above | Passed: 5 scenarios, 30.665 s |

The first sandboxed test run passed 228 suites but could not start the AuthKit
contract suite's local HTTP stub (`listen EPERM` on `127.0.0.1`). The complete
suite subsequently passed with the required local-server permissions. The
sandboxed production build stalled and was stopped; the permitted rerun passed.
Neither issue was addressed by modifying application code.

The passing full run still emitted `MaxListenersExceededWarning` messages and
Jest's delayed-exit/open-handle notice. These are recorded baseline warnings,
not fixed or diagnosed by this work. Lint's 58 warnings are likewise retained.

## Interpretation and limits

- Render counts demonstrate which work is invalidated in this workload. Timings
  are a single local sample, not production-browser input latency or a performance
  service-level target. The mocked player is driven by the test; this does not
  establish a browser's actual playback/scrub event frequency.
- React Profiler durations exclude parts of event handling and do not include
  browser layout/paint. The harness's labels saying "screen renders" count
  Profiler commits under the editor, not strictly EditorScreen function calls.
- The active word can legitimately render independently. Not every playback
  render should disappear after memoisation.
- React `act` batches asynchronous updates in these scenarios. Commit counts do
  not establish how many separate browser renders the individual timers cause;
  batched updater processing can still be expensive.
- This is diagnostic instrumentation, not yet an assertion-based performance
  regression suite. Each implementation PR should add deterministic expectations
  for its fixed behavior without locking in today's excessive counts.
- The harness records neither initial HTTP payload/latency nor database query
  plans. The linked browser report adds local development navigation, typing and
  Find samples. Production-build measurements, two-tab behavior, Safari/mobile,
  network transfer bytes, hosted behavior and long-session memory remain unverified.
- No improvements are claimed in this baseline commit. Compare post-PR results
  against this report and record workload changes explicitly.
