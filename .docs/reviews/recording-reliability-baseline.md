# Recording reliability baseline

Recorded on 2026-11-09 on `codex/recording-reliability-and-simplification`.
Application source at `5a02579f5ebf301bf7d6087afedb021d98e71624`, which
matched local `main` and its `origin/main` tracking ref when the integration
branch was created. See the [delivery plan](../recording-reliability-and-simplification-plan.md)
for the review decisions and PR sequence.

## Checks

Node 24.12.0, npm 11.7.0, Next.js 16.4.4. Commands ran from `frontend/`.

| Check | Result |
| --- | --- |
| `npm run test:ci -- --silent` | 230 suites, 3,065 tests, 7 snapshots passed in 85.6 s |
| Five focused suites listed below | 55 tests passed in 1.8 s |
| `npm run lint` | 0 errors, 60 warnings |
| `npm run typecheck` | Passed route type generation and TypeScript |
| `npm run build` | Passed Turbopack production compilation, TypeScript and static generation |

The sandboxed full Jest run could not bind the AuthKit contract test's
loopback stub. The full run with loopback access passed. The passing run
still reported listener-limit and delayed-exit warnings. Typecheck and build
ran in a temporary copy from `git archive HEAD frontend` with the installed
dependencies and dummy configuration. Neither wrote build output into the
running app's checkout.

Focused suites, run with `npm run test:ci -- --silent --runTestsByPath`:

- `__tests__/recording/retryAfterAmbiguousLink.test.ts`
- `__tests__/recording/uploadIdempotency.test.ts`
- `__tests__/recording/recoveryModal.test.tsx`
- `__tests__/capture/storageTransfer.test.ts`
- `__tests__/auth/uploadAccountSwitch.test.tsx`

## Production browser baseline

Headless Chrome 156.0.8078.80 on macOS at 1,440 × 900, using the isolated
production build, a disposable Chrome profile, and Chrome's synthetic
microphone. Browser recording, IndexedDB, Web Locks, navigation and UI
were real. A loopback stub supplied a synthetic WorkOS signing key and
Supabase responses. Browser request interception supplied transcript create
and start responses. No live identity, database, project, provider job or
Storage object was used. The profile and loopback processes were torn down
at the end.

| Scenario | Observed |
| --- | --- |
| Live stop, failed source link and failed reconcile read | The error screen showed Retry upload. One transcript and the local chunks remained, and no start request had been sent. |
| Live Retry after the object already existed | Reused the transcript and object path. The Storage stub accepted the second write with upsert. One start request was sent and local chunks were cleared. |
| Navigate away mid-capture and save recovery | The modal surfaced persisted audio. After the stub dropped the start response following a successful link, the modal closed and local chunks were cleared. The library did not show a status-unknown notice on this recovery route. |
| Select synthetic WAV and fail start after link | The library opened with `capture=saved_needs_retry` and displayed the injected start error. The synthetic transcript kept its media link. |
| Switch account marker with a recovered recording visible | The original account shell unmounted while the recovery modal remained visible. The two chunks and their 24,440 bytes stayed in IndexedDB. The test did not click Discard. |

### Render and short recording sample

Counted committed Capture Modal renders using Chrome DevTools Protocol and a
React commit observer. The observer identified the modal component in the
production bundle and counted commits where its fiber did work. Counts
exclude attempted renders that never committed. The mic test clock started
at the Test microphone click, so it includes startup. The recording
window began after the recording page showed Stop & transcribe, with the
capture modal closed.

| Window | Capture Modal renders | Recording data |
| --- | ---: | --- |
| Mic test, 3.0 s | 17 | Chrome synthetic microphone |
| Active recording, 20.005 s | 44 | 20 added IndexedDB chunks, 328,760 bytes, about 131 kbps |

The 17-render count is a smoke measurement for the default synthetic input.
`useMicTest.ts` only publishes a new level when the rounded peak changes.
A steady input can suppress those updates, so use speech for the PR 2
mic-meter comparison.

Chrome's reported JS heap usage moved from 15,288,632 to 14,005,912 bytes
across that window. This is a single sample affected by garbage collection.
It does not measure native Blob memory, browser process footprint, or
long-session growth. The byte rate describes this synthetic microphone and
Chrome's current encoding, so it is not an audio quality or bitrate target.

### Repeat for comparison

1. Compile the same source in isolation with dummy settings and launch a
   fresh Chrome profile with a synthetic microphone. For PR 2's mic-meter
   comparison, use the same speech WAV before and after with
   `--use-fake-device-for-media-stream` and
   `--use-file-for-fake-audio-capture=/absolute/path/to/speech.wav`.
   [Chromium's microphone test switches](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/base/media_switches.cc#245)
2. Use the Capture dialog's Record Audio tab. Click Test microphone, wait
   for the meter to respond, then count modal commits for the same
   three-second speech window in both builds. For the separate recording
   sample, start recording, wait for
   Stop & transcribe, and sample modal commits, IndexedDB chunk count and
   bytes, and JS heap before and after twenty seconds. Avoid navigating
   during the sample.
3. Make the Storage write succeed and fail both the link PATCH and its
   reconciliation read. Retry in the page. Verify intent and object path
   reuse, a single start dispatch, and local cleanup. Repeat with a fresh
   capture interrupted by navigation and a dropped start response after
   the recovered media links.
4. Select a synthetic WAV and fail start after link. Verify the saved outcome.
   For an account-change check, change the test profile's account marker
   while the recovery modal is visible and check modal visibility and the
   old account's IndexedDB data without deleting either fixture.

Local Supabase was stopped, and the running development app pointed at a
hosted Supabase URL. The isolated browser check therefore used only local
stubs. Real WorkOS and Supabase policies, project deletion, a real TUS
transfer, provider behavior, Safari/mobile and multi-hour sessions remain
outside this baseline.
