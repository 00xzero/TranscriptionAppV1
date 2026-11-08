# Editor performance PR 2 verification

The integration base is `0828ffc`. The first commit, `c97bb0e`, fixes the
sync-arrow ordering regression in [#156](https://github.com/00xzero/TranscriptionAppV1/issues/156).
Its Jest test failed on the integration base and passed after deferring the
range comparison until the segment order commits. The stable callback and
the PR 1 scroll render assertions passed. The application changes are in
`301e6e8`.

## Production typing

Chrome ran isolated Next.js production builds against local Supabase at 4× CPU
slowdown. Each cell used three batches of 32 trusted text inputs at about 65 ms
intervals. The same disposable 1,000-segment and 5,000-segment copies were used
for both builds. Each batch edited the same segment within its fixture, saved
the result and restored the text with one undo. The media and waveform requests
read from the named fixtures. All writes targeted the disposable copies.
The final checksums matched the captured text and timing for both copies and
both named sources. The two copies were then removed by ID.

Timings below are the median and p95, in milliseconds, of renderer main-thread
tasks containing the input event. Each pair is one batch.

| Fixture | Find | Sidebar | Integration median / p95 | PR 2 median / p95 |
| --- | --- | --- | --- | --- |
| 2 h | Clear | Closed | 11.17 / 14.25, 8.62 / 11.19, 9.57 / 13.44 | 11.24 / 13.13, 10.20 / 11.52, 9.79 / 13.10 |
| 2 h | Clear | Open | 9.18 / 12.57, 9.88 / 16.76, 10.02 / 15.46 | 10.44 / 14.42, 9.92 / 14.22, 9.61 / 11.51 |
| 2 h | Retained | Closed | 14.59 / 26.57, 14.58 / 18.76, 12.84 / 23.54 | 17.01 / 23.75, 12.26 / 17.86, 12.79 / 16.95 |
| 2 h | Retained | Open | 16.35 / 20.92, 19.34 / 30.47, 18.30 / 22.05 | 13.36 / 25.98, 12.95 / 22.84, 11.86 / 17.40 |
| 10 h | Clear | Closed | 14.07 / 21.91, 13.73 / 19.85, 16.80 / 21.00 | 11.44 / 22.45, 9.92 / 15.81, 9.89 / 16.14 |
| 10 h | Clear | Open | 17.46 / 26.41, 12.20 / 16.24, 15.25 / 23.97 | 9.77 / 21.83, 10.09 / 16.14, 10.53 / 13.52 |
| 10 h | Retained | Closed | 29.48 / 38.24, 23.88 / 30.00, 30.51 / 38.09 | 22.08 / 30.68, 21.77 / 28.19, 21.81 / 27.22 |
| 10 h | Retained | Open | 24.76 / 31.42, 24.43 / 31.23, 24.02 / 30.24 | 21.95 / 41.35, 23.40 / 33.88, 21.56 / 30.94 |

A separate production profiling build timed individual passes with the sidebar
open, one batch of 32 inputs per condition. These are medians per invocation,
in milliseconds. React Profiler covers child render time per commit. Layout
and style recalculation are browser trace slices. The diagnostic build adds
instrumentation overhead and its values are separate from the input task
comparison.

| Work | 2 h retained Find | 10 h clear Find | 10 h retained Find |
| --- | ---: | ---: | ---: |
| Stage draft and update optimistic segments | 0.5 | 0.8 | 0.7 |
| Rebuild playback locator | 0.0 | 0.4 | 0.1 |
| Resolve speaker presentation | 0.0 | 0.1 | 0.1 |
| Build speaker overview | 0.6 | 1.6 | 1.5 |
| Recompute sync direction | 0.0 | 0.0 | 0.0 |
| Find matches | 1.2 | 0.0 | 4.9 |
| Group Find matches | 0.1 | 0.0 | 1.9 |
| React child render | 4.1 | 2.5 | 3.7 |
| Browser layout | 0.088 | 0.089 | 0.068 |
| Browser style recalculation | 0.115 | 0.077 | 0.074 |

Retained Find crossed the timing threshold at both sidebar settings. The
largest measured difference was in Find matching and grouping. Those passes
need current text even if pending drafts are stored separately. Draft staging
itself showed a 0.2 ms median gap in the retained Find comparison. The PR
keeps optimistic segment ownership. These runs use one machine and small
batches, so compare the ranges across runs when interpreting p95.

## Interaction checks

- Chrome DevTools supplied native composition events. The X, another card's
  edit button and the speakers summary each delivered confirmation before blur.
  Each sent one guarded save on the original segment and was undone in one
  step. Cancelling the composition kept the textarea value and sent zero
  saves. Jest separately covers an unchanged reload, undo preserving Redo,
  invalidated trailing input, Escape and a virtual row remount.
- Chrome opened Find on 1,999 matches, replaced one, preserved the retained
  highlight on close and undid the replacement. It also checked speaker
  search focus, switching triggers, same-trigger close, Escape focus return,
  outside dismissal and reveal in the sidebar.
- In a 460 px viewport with Follow paused, both builds split and rejoined a
  disposable segment, removed the second row and restored the caret to offset
  58. The arrow remained down in both runs. The browser attempt did not
  reproduce the child-first range ordering confirmed in Jest.
- Chrome observed a pending guarded save succeed before the sign-out POST.
  The isolated production port differs from the configured WorkOS origin,
  so the browser run did not verify session clearing. Jest covers the
  departure and sign-out guards.
- Safari WebDriver reported that remote automation was disabled. The
  Safari-style drag and final-input ordering ran in Jest. The macOS IME
  candidate UI, browser menu undo/redo, and a live account switch were outside
  these browser runs. Jest covers native history input routing and the
  account-change protections.

## Automated checks

- Full Jest passed with 229 suites, 3,022 tests and seven snapshots. Jest
  continued to emit listener and open-handle warnings. The sandboxed attempt
  could not bind the AuthKit outage test's loopback listener. The rerun with
  localhost access passed.
- The 5,000-segment render-cost harness reported a median of one card render
  per keystroke and zero retained card renders during the scroll moves.
- Typecheck and the isolated production build passed. Lint reported zero
  errors and 55 warnings.
