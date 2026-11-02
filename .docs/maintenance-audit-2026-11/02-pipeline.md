# Transcription pipeline, engines, media preparation & waveforms (server side)

**Scope reviewed:** `core/transcription/**`, `core/media/`, `lib/inngest/**` (10 functions, 4 helpers), `lib/transcription/`, `lib/media/`, `lib/audio/{ffmpeg,compute-peaks}.ts`, `infra/{deepgram,soniox,assemblyai,inngest}`, `infra/supabase/{admin,transcription-results.server}.ts`, the webhook, Inngest and start routes, the six contracts and three scripts. I also read the `transition_job_status` and `save_transcript_segments` SQL. That is about 7,200 source lines, plus about 5,100 lines of domain tests skimmed.

*Paths:* `infra/supabase/migrations/…` paths are from the repo root. Every other path, including `infra/soniox` and the like, is under `frontend/`. A bare filename refers back to the full path given earlier.

**Scorecard:**

| Lens | Score | Why |
|---|---|---|
| Maintainability | 3 | Well commented and well tested. But a 633-line orchestration file sits in `core/`, four readers each decide where an attempt stands, and a fourth engine would touch about 15 files |
| Scalability | 3 | Memory stays bounded. But concurrency is global only, there is a 4.5 MB Deepgram ceiling, and the single-RPC save has never been measured at 10 h |
| Reliability | 3 | The exact-attempt write discipline is excellent. But long Deepgram files fail every time, the reaper discards late results, the save RPC has no guard, and nobody reads the failures table |
| Performance | 4 | Streaming ffmpeg, gzipped results, set-based inserts. About 25 round trips per transcript, off the hot path |

**Summary:** The pipeline is careful. Every write repeats its checks in its own WHERE clause, raw results are kept verbatim, and preparation is bounded and never blocks a transcript when it fails. The price is a lot of machinery: a receipt/lease protocol on top of Inngest's step guarantees, and four overlapping state classifiers. Most of it lives in `core/` even though it does I/O. **The biggest risk: Deepgram is the default engine and declares no length limit, but Vercel's 4.5 MB body cap makes any recording longer than about 2.5 h fail every time, after Deepgram has billed for it. The user is told it "timed out".**

## Findings

### [P1] Deepgram (the default) fails every time on recordings longer than about 2.5 h
- Lens: reliability
- Evidence: `frontend/app/api/webhooks/deepgram/route.ts:12-21` documents the 4.5 MB limit ("3+ hour recording: May exceed"). Yet `frontend/core/transcription/engines/capabilities.ts:36` sets `maxDurationSeconds: null` for Deepgram. Deepgram is the default engine (`frontend/contracts/transcription-options.ts:69`), and uploads go up to 500 MB.
- Why it matters:
  1. Deepgram transcribes the file and bills for it.
  2. Vercel answers every callback with 413 before our code runs, so nothing is stored. Deepgram keeps no copy (`mip_opt_out`, `frontend/infra/deepgram/index.ts:149`).
  3. The job stays `processing` until the reaper writes "timed out … Please try again" (`frontend/lib/inngest/functions/handle-transcription-timeouts.ts:77`).
  4. A retry pays again and fails again.
- Recommendation: Set a measured cap (about 2 h). The existing `engineLengthRefusal` path (`handle-media-prepare.ts:139-144`) and the capture dialog then send the user to AssemblyAI. Our own WebM recordings carry no header duration (`frontend/lib/audio/ffmpeg.ts:339-343`), so they skip the check. For capped engines, measure their length or pass the length the recording already knows.
- Effort: S (cap), M (unknown-duration case)
- Confidence: high

### [P2] The reaper ignores duration, and a reaped job's late result is always discarded
- Lens: reliability
- Evidence: The timeout is a fixed 45 min from start (`frontend/lib/inngest/job-checks.ts:13`, `handle-transcription-timeouts.ts:31-34`), while files can run to 10 h (`capabilities.ts:56`). `infra/supabase/migrations/20260319050000_allow_completion_recovery.sql:5-7` and `core/transcription/machine.ts:17-18` say a result arriving after a "pessimistic" timeout must still complete the job. But every reader on the callback side returns `error` → stale (`frontend/core/transcription/webhook.ts:73`, `:249`; `frontend/lib/inngest/engine-callback-state.ts:64`), and the link write requires `processing` (`webhook.ts:474`).
- Why it matters: A vendor backlog, an outage longer than Deepgram's roughly 5 min of retries, or a slow 10 h job each end as "try again", even though a paid, complete result arrives later. Soniox and AssemblyAI keep their copy unused for 30 days (`fetching-engine-callback.ts:84-88`).
- Recommendation: Pick one rule. Either accept a callback for a job errored with `error_detail='timeout'` whose request id still matches, or scale the timeout by duration and engine. Then delete the contradicting comments.
- Effort: S–M
- Confidence: high on the mechanism, medium on frequency

### [P2] `save_transcript_segments` can wipe an edited transcript
- Lens: reliability
- Evidence: The RPC deletes all segments with no status check (`infra/supabase/migrations/20261010000000_speaker_identity_review_guards.sql:350`). The only guard is a check memoized in an earlier step (`frontend/lib/inngest/functions/handle-transcription-webhook.ts:113-117`). `transcription/webhook` is sent with `inngest.send` inside a step, without an event id (`webhook.ts:512-515`), so a retried or taken-over `store-result` step sends it again.
- Why it matters:
  1. The duplicate run reads the job as `processing`.
  2. The first run completes, and the user opens the transcript and edits it.
  3. The duplicate run's store step re-inserts every segment with new UUIDs, so the edits and undo history are silently lost.

  `core/transcription/start.ts:110-114` shows this invariant already matters at the route.
- Recommendation: Guard it in the database, as CLAUDE.md asks: pass `p_job_id` and refuse within the transaction when the job or transcript is `completed`. Also send the event with id `transcription-webhook:${jobId}`.
- Effort: S
- Confidence: high on the mechanism, medium on likelihood

### [P2] The receipt/lease protocol duplicates Inngest's own guarantees
- Lens: maintainability
- Evidence: The claim, takeover and finalize code is at `webhook.ts:341-427` and `:553-633`. Two `confirm-handoff` steps exist only for it (`handle-deepgram-callback.ts:95-101`, `fetching-engine-callback.ts:149-155`), as does the lease-wait code (`frontend/lib/inngest/engine-callback.ts:17-51`). Every caller already runs under `concurrency {limit:1, key: transcriptId}` (`handle-deepgram-callback.ts:41`, `fetching-engine-callback.ts:69`). The protected writes are already idempotent: a same-key upsert and a conditional link (`webhook.ts:466-477`).
- Why it matters: It costs about 250 lines, a table, and a 5 min stall after any crashed step (`webhook.ts:22`). It also brings four attempt readers (`webhook.ts:55`, `:234`; `engine-callback-state.ts:30`, `:83`) that disagree subtly: three treat `error` as stale, one as "handed off". Every edge case has to be checked against all four.
- Recommendation: Replace the receipt with three steps: a conditional `link`, then `step.sendEvent` with a deterministic id (memoized, so durable), then `forget`. Use one `readAttempt()` query and pure classifiers in `core/`, testable without Supabase mocks. Drop `webhook_receipts`, which has no other readers.
- Effort: M
- Confidence: medium

### [P2] `core/transcription` does I/O, and its state machine is a test-only copy of the SQL
- Lens: maintainability
- Evidence: `webhook.ts:11-19` imports the Inngest client and Storage. `start.ts:9-11` imports the admin client, Inngest and storage, and reads env (`:57-59`). `transition.ts` calls an RPC. The transition table in `core/transcription/machine.ts:16-23` is used only by `__tests__/stateMachine.test.ts`; the real table is SQL (`20261023120000_workos_auth.sql:1591-1596`).
- Why it matters: This breaks CLAUDE.md's rule that `core/` makes no framework or network imports. Tests must mock infra, and the two tables can drift with nothing failing.
- Recommendation: Move `start.ts`, `webhook.ts` and `transition.ts` to `lib/transcription/`. Delete the JS table, or test it against the SQL `CASE`.
- Effort: M
- Confidence: high

### [P2] Concurrency is global only, so one user can delay everyone
- Lens: scalability
- Evidence:
  - Preparation is capped at 2 globally (`handle-media-prepare.ts:36,45-48`), and transcription only starts after it (`:224`).
  - Engine starts share one account-scoped key `"deepgram"`, limit 5 (`handle-transcription-requested.ts:30-38`).
  - Waveform and result processing are keyed per transcript only (`handle-waveform-requested.ts:38-41`, `handle-transcription-webhook.ts:29-32`).
  - The start rate limit is off in production by default and counts per instance (`start.ts:57-59`).
- Why it matters: On Vercel each run is its own instance, so the cap of 2 protects no shared machine; it only creates a queue. Twenty large uploads from one user delay everyone's transcripts by up to 10 min before preparation is skipped (`frontend/lib/media/prepare-steps.ts:41`). Account scope likely shares the 5 engine slots with preview and staging. Nothing caps a single user's spend.
- Recommendation: Add a per-user limit (`{key: "event.data.userId", limit: 1–2}`) to prepare, waveform and start. Raise the global caps to the vendors' limits, use `scope: "env"`, and make the start limit durable.
- Effort: S–M
- Confidence: high on the config, medium on what account scope shares

### [P2] Failures are recorded where nobody looks
- Lens: reliability
- Evidence:
  - `failed_events` is written (`engine-callback.ts:77`, `webhook.ts:164`) but never read.
  - A `cleanup_failure` leaves the Soniox job counting against our quota (`infra/soniox/index.ts:5-7`), and nothing retries the delete.
  - Users see raw internal text as "Transcription failed: <200 chars>" (`core/transcription/errors.ts:65-68`).
  - `handle-transcription-completed` has no `onFailure` (`:12-17`). A failed status write leaves the segments saved, and the reaper later reports "timed out".
- Why it matters: Problems only surface through user complaints, copies at the vendors pile up, and users see PostgREST and fetch error strings.
- Recommendation:
  - Alert on `failed_events`, or use Inngest's failure alerts.
  - Add a cron that retries `forget`.
  - Show a fixed user-facing message and keep the detail in `error_detail`.
  - Add a script that reprocesses a job from its stored result; this is why the results are kept.
- Effort: M
- Confidence: high

### [P3] The engine contract is spread out; a fourth engine touches about 15 files
- Lens: maintainability
- Evidence: Starting a job and parsing its result are in `core/transcription/engines/types.ts:41-47`. Fetching, failing and forgetting are in a separate descriptor (`fetching-engine-callback.ts:27-40`) whose trigger type is a hard-coded union (`:31`). Each route checks its own auth, and the Soniox and AssemblyAI routes are copies of each other (`app/api/webhooks/{soniox,assemblyai}/route.ts`). A new engine touches:
  - contracts: options, API schema, event schema;
  - core: capabilities and a words parser;
  - infra: an adapter;
  - lib: `engines.server`, `inngest/events`, the trigger union, a handler and the barrel;
  - app: a route and `app/api/inngest/route.ts`;
  - the capture dialog;
  - a migration, because the SQL CHECKs duplicate `capabilities.ts`.

  The difference between Deepgram (it pushes the result) and the engines whose results we fetch is justified; the duplication is in the state readers, not the flows.
- Recommendation: Use one engine descriptor that includes its callback strategy, plus a generic `app/api/webhooks/[engine]/route.ts`.
- Effort: M
- Confidence: high

### [P3] Dead and stale code
- Lens: maintainability
- Evidence:
  - `scripts/move-job-payloads-to-storage.ts`: its column was dropped in `20261016010000_drop_job_payload.sql:21`.
  - `WebhookReceiptInsertSchema` is unused (`contracts/webhook.ts:85`).
  - The health route compares its token with `!==`, accepts it in the query string, and checks only `DEEPGRAM_CALLBACK_URL`, so production reports "degraded" (`app/api/webhooks/deepgram/health/route.ts:35-38,73`).
  - `scripts/backfill-waveforms.ts:136` resets the offset to 0, so rows that were skipped or raced are re-read.
  - The legacy `"transcribe"` job type is still queried (`handle-transcription-timeouts.ts:32`).
  - `job-checks.ts:12` says processing jobs are timed from creation; the code uses `started_at`.
  - `DEEPGRAM_*` env names govern every engine (`infra/public-url.ts:8`).
- Recommendation: Delete or fix each one.
- Effort: S
- Confidence: high

## Quick wins
- Give Deepgram a measured `maxDurationSeconds` (`capabilities.ts:36`).
- Give `transcription/webhook` the event id `transcription-webhook:${jobId}` (`webhook.ts:512`), and add a completed-status guard to `save_transcript_segments`.
- Add `AbortSignal.timeout` to the engine calls (`infra/deepgram/index.ts:174`, `infra/soniox/index.ts:85`, `infra/assemblyai/index.ts:93`). Today a hung start can hold one of the 5 global slots for 300 s.
- Delete the move-job-payloads script and the unused schema, and fix the backfill offset.
- Fail closed when `isDev` is true and `VERCEL_ENV=production` (`infra/inngest/client.ts:23`); `.env.example:36` ships `INNGEST_DEV=1`.

## Zero-in candidates
1. **Callback/handoff simplification:** retire the receipts, keep one attempt reader with pure classifiers, move them out of `core/`, and settle the late-result-after-timeout rule. This is where the domain's complexity and its contradictions concentrate.
2. **Long-media envelope:** run 1, 3, 5 and 10 h files through every engine. Measure the Deepgram body size, engine latency against the reaper, the save RPC's payload and time, peak memory in `store-transcription`, and waveform time. Then publish a maximum per engine and a timeout that scales with duration.
3. **Operational surfacing:** something that reads or alerts on `failed_events`, a tool to reprocess from the stored result, and the mapping from internal errors to user messages.

## Test coverage notes
Unit coverage is deep. It comes from:
- `deepgramWebhook`, `sonioxWebhook`, `assemblyaiWebhook`;
- `*CallbackHandler`, `sonioxCallbackSteps`, `exactJobCallbacks`;
- `inngestHandlers`, `transcriptionRequestedHandler`, `transcriptionTimeouts`;
- `mediaPrepareHandler`, `mediaPrepareSteps`, `preparePolicy`, `probeSourceMedia`;
- `computePeaks`, `waveformHandler`;
- `transitionJob`, `stateMachine`, `startRouteIdempotency`;
- `*Words`, `*Request`, `deepgramPipelineBaseline`.

Gaps:
- **No database runs.** Everything uses mocked Supabase, and the migration tests read the SQL text. So `transition_job_status`, `save_transcript_segments` and the PostgREST `or`-filter quirk (`webhook.ts:82-85`) are never executed.
- **No long-media or large-payload tests.**
- **No test of a duplicate `transcription/webhook` after completion.**
- **No test of the reaper racing a late callback across functions.**

## Cross-domain notes
- `core/transcripts/create.ts:10-11` imports from infra and lib, breaking the same layering rule.
- The rate limiter is per instance and off in production by default (`core/limits/rate-limit.ts`).
- Raw error text reaches the UI through `lib/supabase/queries.ts:323`.
- The waveform finalize step depends on project-delete error codes (`handle-waveform-requested.ts:13,224`).

## Open questions
- Do PostgREST's body limit and the service role's `statement_timeout` admit a 10 h save (about 100k words, about 20 MB of JSON)? How much memory does parsing a 10 h result take at peak? There is no `vercel.json` setting memory.
- Does a 10 h waveform fit in 300 s? The JS peak loop measures about 130 ms per audio hour, so ffmpeg decoding and the download dominate. There is no step budget; the ffmpeg timeout and the signed URL both last 6 h (`ffmpeg.ts:25`, `handle-waveform-requested.ts:23`). If it doesn't fit, it fails 4 × 300 s and is then marked `error`.
- Does Deepgram retry a 413 at all, and what is each vendor's latency at 5–10 h?
- Starting an engine is not idempotent. A step re-run after a lost result starts it twice, and the orphaned copy is ignored. That is correct, but we pay twice.

## What's good
- **Exact-attempt discipline:** each consequential write repeats its checks in its WHERE clause (`webhook.ts:466-477`), and steps re-read the job before acting (`job-checks.ts`).
- **Media preparation is bounded and never blocks a transcript when it fails:** a 200 MB output cap, a 270 s step budget, an output duration check, and reconciliation where the row is the truth (`lib/media/prepare-steps.ts`).
- **Results are kept verbatim** and parsed by pure `resultToWords` functions, guarded by the frozen Deepgram baseline.
- **The fetching-engine factory** keeps the Soniox and AssemblyAI handlers to about 40 lines each. All three webhooks compare secrets in constant time and authenticate before parsing.
