# Maintenance audit — November 2026

Domain-by-domain review of `main` @ `b57889b` (2 November 2026) for maintainability, scalability, reliability and performance. No feature work: the goal is to find where to zero in.

Eight reviewers each audited one domain read-only, with an explicit file scope, the same brief and the same output format. The lead then ran the baseline checks, read churn from git history, and checked the six top findings against the code (marked **checked** below).

| Report | Domain | Scope |
|---|---|---|
| [01-auth.md](01-auth.md) | Auth & account isolation | `proxy.ts`, `app/auth`, `components/auth`, `lib/auth`, token plumbing |
| [02-pipeline.md](02-pipeline.md) | Transcription pipeline | `core/transcription`, `lib/inngest`, engines, webhooks, media prep, waveforms |
| [03-recording.md](03-recording.md) | Capture & recording | `lib/recording`, `lib/capture`, CaptureModal, RecordingSession, create route |
| [04-editor.md](04-editor.md) | Editor | `app/(app)/editor`, `lib/editor`, `core/transcript`, speakers, player |
| [05-data.md](05-data.md) | Data layer | migrations, RLS, RPCs, `lib/supabase`, realtime, client factories |
| [06-organise.md](06-organise.md) | Library, Projects, People & Tags | lists, organisation features, delete routes |
| [07-shell.md](07-shell.md) | App shell, UI & exports | layouts, `components/ui`, design tokens, exports, `next.config.mjs` |
| [08-platform.md](08-platform.md) | Platform & tooling | CI, tests, deps, scripts, docs, repo-wide layering and dead-code scan |

## Baseline (Node 24.22.1, fresh `npm ci`)

| Check | Result |
|---|---|
| `npm run typecheck` | Clean (26 s) |
| `npm run lint` | 0 errors, 58 warnings: 39 `react-hooks/refs`, 15 `set-state-in-effect`, 3 `immutability`, 1 `purity`. 37 of the 58 are in `EditorScreen.tsx` |
| `jest` | 226 suites, 2,935 tests, all passing, 77 s. `editor.test.tsx` alone takes 38 s |
| `npm audit --omit=dev` | 13 advisories: 1 critical (`next` 16.3.1, fixed in 16.4.4), 7 high (incl. `zod` < 4.6.6) |
| CI | None: no `.github/`, no hooks, no Dependabot |

Churn (last ~4 months): `contracts/db.ts` (20 commits) and `lib/supabase/queries.ts` (19 commits, 1,094 lines) are the most-edited files. `fix:` commits outnumber `feat:` 84 to 62.

## Scorecard (1–5, reviewer judgement)

| Domain | Maintain | Scale | Reliable | Perform | P1 | P2 | P3 |
|---|---|---|---|---|---|---|---|
| Auth & account isolation | 3 | 4 | 3 | 4 | 1 | 5 | 4 |
| Transcription pipeline | 3 | 3 | 3 | 4 | 1 | 6 | 2 |
| Capture & recording | 3 | 2 | 3 | 3 | 1 | 8 | 2 |
| Editor | 3 | 2 | 4 | 2 | 3 | 4 | 2 |
| Data layer | 2 | 3 | 4 | 3 | 2 | 7 | 2 |
| Library, Projects, People & Tags | 3 | 2 | 4 | 2 | 3 | 5 | 1 |
| App shell, UI & exports | 3 | 3 | 2 | 3 | 2 | 8 | 2 |
| Platform & tooling | 4 | 3 | 2 | 3 | 4 | 5 | 2 |
| **Average** | **3.0** | **2.8** | **3.1** | **3.0** | **17** | **48** | **17** |

## Verdict

The careful parts are in good shape. Writes are idempotent and guarded in the database, engine callbacks act on one exact job attempt, recordings survive a crash, and 2,935 tests pass. Code hygiene is excellent (0 TODOs, 3 eslint-disables in ~52k lines). The gaps are elsewhere. No checks run automatically, no errors are reported, and most screens fetch and render everything at once. The happy paths are strong. The risk sits in what happens after a failure, and in long recordings and large accounts.

## Six cross-cutting patterns

1. **Nothing checks the work automatically** (platform, shell, data, pipeline). There is no CI, no error reporting and no dependency alerting. DB guarantees are tested by regex over migration text, and `failed_events` is written but never read.
   *Shared fix:* CI with a live Supabase job, error reporting via `instrumentation.ts` and the boundaries, Dependabot, and an alert on `failed_events`.
2. **Built for tens of items, not thousands** (organise, editor, data). One sequential OFFSET pager serves every list. Tags refetch every link on each window focus. Realtime refetches full lists on every event and polls every 5 s while down. The editor loads the whole transcript (about 20 MB at 100k words) and reloads all of it on a conflict. The words RLS policy scans the whole account.
   *Shared fix:* keyset pagination, refetch by id from a per-user broadcast, virtualised lists, an owner column on words, and a heavy-account seed to measure against.
3. **Whole-snapshot subscriptions, no memo boundaries** (editor, recording, organise, shell). Playback time in EditorScreen state re-renders every card about 10 times a second. The mic meter sets state on every animation frame. The recording snapshot ticks every second, and a tag edit re-renders every list row.
   *Shared fix:* extend the `playbackClock` pattern (`useSyncExternalStore` with primitive snapshots) via selector hooks, and add memo boundaries on lists.
4. **Long media is the unmeasured envelope** (pipeline, recording, data). Deepgram callbacks over 4.5 MB are rejected. The reaper allows a fixed 45 min for files up to 10 h. Soniox's 5 h cap is checked only after upload, when the local copy is already gone. The whole recording is held in RAM, the save is one JSONB call, a delete is one statement under an 8 s timeout, and TUS gives up after about 9 s.
   *Shared fix:* run 1/3/5/10 h files through every engine, set measured per-engine caps enforced while recording, scale the timeout with duration, and batch the large writes.
5. **Recovery paths are weaker than happy paths** (recording, pipeline, auth, organise). Live Retry can dead-end, and recovery save has no progress bar and discards on one click. Late results for reaped jobs are discarded. IndexedDB rows that fail the current schema are invisible and never collected. A frozen page can be navigated away, and raw error strings reach users.
   *Shared fix:* review each domain's after-failure paths, with one upload path and explicit tests for what happens after each failure.
6. **Layering has drifted, and complexity has piled up** (7 of 8 domains). `core/` does I/O in `start.ts`, `webhook.ts`, `transition.ts` and `create.ts`. `queries.ts` covers every domain with hand-written row types. The editor's state engine (4.1k lines of hooks) lives in `app/`. Tags, Projects and People use three pending-edit patterns. A receipt/lease protocol repeats guarantees Inngest already gives, and 45 migrations hold 140 function definitions for about 65 live ones.
   *Shared fix:* move I/O out of `core/` plus `no-restricted-imports`, generated DB types, split `queries.ts`, one overlay-store primitive, then a simplification pass.

## The ten things to do first

| # | Action | Findings | Effort |
|---|---|---|---|
| 1 | Add CI (typecheck, lint `--max-warnings=58`, test, build, audit) and a Supabase smoke-SQL job | platform-1 **checked**, platform-4 | S–M |
| 2 | Bump `next` to 16.4.4 and `zod` to ≥ 4.6.6 | platform-2 **checked** | S |
| 3 | Fix the live Retry upload dead-end: upsert when `uploadIntentId` is set | recording-1 **checked** | S |
| 4 | Cap engine lengths (Deepgram ≈ 2 h) and enforce them while recording | pipeline-1 **checked**, recording-4 | S |
| 5 | Make `save_transcript_segments` refuse completed transcripts, and give `transcription/webhook` a deterministic event id | pipeline-3 **checked** | S |
| 6 | Error reporting, plus `app/(app)/error.tsx` so a page crash keeps the shell and recording provider | shell-1, shell-2 | S |
| 7 | Editor render boundaries: memo `TranscriptList`, move playback time to a store, batch Replace All | editor-1, editor-2, editor-3 | S–M |
| 8 | Owner column and simpler RLS on `words` (after the baseline squash) | data-1 **checked** | M |
| 9 | Tags and lists at scale: tag-count map, throttled focus reload, virtualisation, keyset pagination | organise-1, organise-2 | M |
| 10 | Unmount AuthKit's token getter when a page freezes | auth-1 | M |

Finding ids are `<report>-<n>`, where n counts the `### [Px]` headings in that report.

## Plan

**Phase 0 — Safety net (≈ 2–3 days).** CI, `next`/`zod` bump, Dependabot, error reporting, `app/(app)/error.tsx`, and a CI job that runs the smoke SQL against a local Supabase.

**Phase 1 — Verified quick fixes (≈ 2 days, all S).**
- Retry upsert, Deepgram cap, and the `save_transcript_segments` guard plus event id.
- `AbortSignal.timeout` on engine calls.
- Proxy that denies by default.
- `media-proxy` production guard, VTT escaping, and the `/transcripts` job-error refetch loop.
- Guarded text/title writes made `SECURITY DEFINER` with the direct UPDATE grants revoked.
- Drop `jobs`/`speakers` from the realtime publication, and add the missing `user_id` filter in `people_directory`.
- Delete dead weight: `IsoSheet`, `move-job-payloads-to-storage.ts`, `soniox-poc/`, `Olivetti.html`, the empty `env.example`.
- Correct the stale numbers in CLAUDE.md.

**Phase 2 — Deep-dives, one session each, in order.**
- **A. Schema baseline and DB tests:** squash the migrations, generate types, and test against a live DB (data-2, data-3, platform-4). This comes before any other schema change.
- **B. Data access at scale:** heavy-account seed, keyset pagination, words RLS, realtime by id, split `queries.ts` (data-1, data-8, organise-1/2, editor-4).
- **C. Long-media envelope:** per-engine measurements and caps, a duration-scaled reaper, batched save and delete, recording bitrate and memory (pipeline-2/6, recording-5/6, data-6).
- **D. Render architecture:** an `EditorSession` in `lib/editor`, selector hooks, memo boundaries, a render-count harness (editor-1/6/7, recording-8, shell-12).
- **E. Failure and recovery paths:** one upload path with resumable TUS, the late-result rule, surfacing `failed_events`, AuthKit freeze, user-facing errors (recording-2/3, pipeline-2/7, auth-2).
- **F. Structure and simplification:** layering moves and import lint, one pending-edit primitive, retire receipts and leases, cut the dialog router, slim down CLAUDE.md (platform-5/8, organise-5/7, pipeline-4).

## Decisions needed

- **Rate limiting.** The in-memory limiter is per instance on serverless, and the start limit is off in production by default; three reviewers flagged this. *Lean:* delete it, use Radar plus a Vercel WAF rule for sign-in, and add a durable per-user cap on transcription starts.
- **Squash migrations.** *Lean:* yes, as deep-dive A, repairing the remote history once.
- **Long Deepgram files.** Cap at about 2 h and route to AssemblyAI, or host that webhook somewhere with a larger body limit. *Lean:* cap and route.
- **Test credentials in CLAUDE.md / AGENTS.md** (tracked, although `.gitignore` lists both). *Lean:* fine if the repo is private and the account is staging-only. Otherwise move them to an untracked env file and rotate.
- **Error reporting vendor.** *Lean:* Sentry or equivalent, with source maps.
