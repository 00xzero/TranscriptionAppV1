# Platform: tooling, tests, CI, dependencies, scripts, docs + layering/dead-code scan

**Scope reviewed:** `frontend/` configs (package.json, tsconfig, eslint, jest, next.config), `__tests__/` (229 test files, 62k lines; ~25 sampled), `__mocks__/`, `frontend/scripts/` (4.5k lines), Dockerfile, `infra/*.sh` + compose, `dev.sh`, root docs, `.docs/` (72 files), `soniox-poc/`, `Olivetti.html`, `env.example`, agent dirs. Source scanned mechanically: 421 files, ~52k lines.

**Scorecard**

| Lens | Score | Why |
|---|---|---|
| Maintainability | 4 | Hygiene is excellent (0 TODO, 3 eslint-disables, 0 ts-ignore in source, 1 unreferenced file). Docs have drifted and `core/` no longer follows its documented layering. |
| Scalability | 3 | Folder discipline is strong, but nothing enforces it (no CI, no import rules), and a 5k-word CLAUDE.md is the onboarding path. |
| Reliability | 2 | No CI, no hooks, DB guarantees tested only by manual scripts, `inngest-cli@latest`, and an unflagged `critical` Next advisory. |
| Performance | 3 | Suite is deterministic, but runs `--runInBand` on 229 files, with an eager recording-session load in every test and no coverage config. |

**Summary:** The code is unusually clean and the test suite is large (229 files, no skips, no `.only`). The platform around it has no safety net: no CI, no pre-commit hook, no dependency automation, so every typecheck/lint/test run depends on someone remembering. The biggest risk is that the load-bearing guarantees (RLS, guarded RPCs, account binding) are protected only by manual local scripts and discipline. `npm audit` already shows a "critical" `next` advisory (installed 16.3.1) and a high `zod` advisory that nothing flagged.

## Findings

### [P1] No CI, no pre-commit, no dependency automation
- Lens: reliability
- Evidence: `ls .github` fails. No `.husky`, `lefthook`, `.circleci`, `vercel.json`, Dependabot or Renovate config anywhere. `.git/hooks` holds only `*.sample`. There are 143 commits since Oct 1 and 55 merge commits. The only visible gate is a review bot (commit `fix(tags): address CodeRabbit review on #149`). Test status is hand-typed prose in the changelog (`CHANGELOG.md:27` "225 suites / 2,929 tests pass"). Lint cannot gate on its own: five React 19 rules are `warn` (`eslint.config.mjs:8-12`) and nothing caps warnings.
- Why it matters: A red typecheck, failing test or lint regression can merge unnoticed.
- Recommendation: Add `.github/workflows/ci.yml` on `pull_request` and push to `main`:
  - Job `verify`: `actions/setup-node` with `node-version: 24`, `cache: npm`, `cache-dependency-path: frontend/package-lock.json`, `working-directory: frontend`. Steps: `npm ci`, `npm run typecheck`, `npm run lint -- --max-warnings=<current>`, `npm test -- --maxWorkers=2` (use `test:ci` only on a 1-vCPU runner), `npm run build` with dummy env.
  - Job `audit`: `npm audit --omit=dev --audit-level=high`, advisory at first.
  - Job `db`: see the DB finding below.
  - `.github/dependabot.yml` (weekly, grouped), and make `verify` a required check on `main`. Skip pre-commit hooks; CI is enough pre-MVP.
- Effort: S (verify + audit) / M (with db)
- Confidence: high

### [P1] Vulnerable `next` and `zod` in production deps
- Lens: reliability
- Evidence: `npm audit --omit=dev` reports 13 vulns (1 critical, 7 high). `next` 16.3.1 (`package.json:52`) is flagged for ~14 advisories, e.g. Server Actions DoS GHSA-p3m5-59mp-jv5r (`<=16.4.0`); `fixAvailable` is `16.4.4`, non-major. `zod` 4.3.6 (`package.json:59`) is flagged for GHSA-mrhx-c7xc-m3w5 (`<4.6.6`, memory exhaustion while validating, which is the API boundary).
- Why it matters: The Server Actions DoS applies (`app/auth/actions.ts` is `'use server'`). Most RCE entries do not: `grep` finds 0 uses of `next/image`, `use cache` and `next/og`, and the Windows-host RCE is irrelevant on Vercel. The real gap is that nothing alerted anyone.
- Recommendation: Bump `next` and `eslint-config-next` to 16.4.4 and `zod` to ≥4.6.6, then run the suite. Ignore the audit's "fix" of downgrading to `inngest@0.3.0` (it comes from inngest's nested zod).
- Effort: S
- Confidence: high

### [P1] Test account password committed in CLAUDE.md and AGENTS.md; `.gitignore` claims they are ignored
- Lens: maintainability
- Evidence: `CLAUDE.md:39-40` and `AGENTS.md:88-89` hold the staging WorkOS email and password. `git ls-files CLAUDE.md AGENTS.md Olivetti.html` lists all three, yet `.gitignore` ignores them ("# Agent files", "# Unused files"). Added in `efa5929`. Remote is `github.com/00xzero/TranscriptionAppV1` (visibility not checked). AGENTS.md itself says not to put these in committed files.
- Why it matters: The credential stays in history. If the repo goes public or gains collaborators, the staging tenant is exposed.
- Recommendation: Rotate the password. Keep creds in an untracked file or env var and link to it from CLAUDE.md. Decide whether the agent files are tracked, then fix `.gitignore` to match.
- Effort: S
- Confidence: high (committed); medium (severity depends on repo visibility)

### [P1] DB security guarantees have no automated gate
- Lens: reliability
- Evidence: CLAUDE.md says "Guarantees belong in the database functions". Behaviour is covered only by 8 manual `psql` scripts (`frontend/scripts/smoke-test-*.sql`, `concurrency-test-tags.sh`, local only). The 11 Jest `*Migration.test.ts` files only regex-match SQL text, e.g. `serverOwnedWritesMigration.test.ts:22-36`, whose comment at lines 19-20 says "Behaviour is covered by scripts/smoke-test-... against a real database".
- Why it matters: A migration can widen a grant or break RLS and stay green.
- Recommendation: Add a CI `db` job: `supabase/setup-cli`, `supabase start`, run each smoke script with `psql -v ON_ERROR_STOP=1`, then require an empty `supabase db diff --local` (the changelog already uses that as its acceptance check). Keep the regex tests as a cheap pre-filter.
- Effort: M
- Confidence: high

### [P2] `core/` no longer matches the documented layer rule; nothing enforces any layer
- Lens: maintainability
- Evidence: see the layering table. `core/transcription/start.ts:9-11` and `webhook.ts:11-16` import `@/infra/inngest|supabase/admin|storage|transcription-results.server`. `core/transcripts/create.ts:10-11` imports `@/infra` and `@/lib/supabase/project-errors`. `start.ts:58-59` reads `process.env`. `infra/` imports `@/lib` in 4 places, and `lib/` imports `@/components` in 5. `eslint.config.mjs` has no `no-restricted-imports`.
- Why it matters: `webhook.ts` (633 lines) is really an orchestration service, so the "pure, framework-free" layer cannot be tested without mocking infra, and drift will continue as contributors join.
- Recommendation: Move `start.ts`, `webhook.ts` and `create.ts` into `lib/` (or a `services/` layer). Add ESLint `no-restricted-imports` overrides: `core/**` and `contracts/**` forbid `@/infra|@/lib|@/app|react|next|@supabase`; `infra/**` forbids `@/lib|@/components` (move `AccountChangedError`, `account-marker.server`, `diagnostics` somewhere neutral). Update CLAUDE.md: WorkOS glue lives in `lib/auth`.
- Effort: M
- Confidence: high

### [P2] Global test setup: hand-copied mock plus eager heavy import
- Lens: performance
- Evidence: `jest.setup.ts:26-29` requires `@/lib/recording/session` in `beforeEach` for all 229 files, including 83 `@jest-environment node` tests of pure logic. `jest.setup.ts:41` onward mocks all of `lib/supabase/queries` with 42 hand-written stubs. The real module exports 53. The 11 unmocked ones (`fetchProjects`, `createProject`, `splitSegment`, `rejoinSegments`, `fetchJobError`, …) become `undefined` in any test that does not override them. `queries.ts` is also the largest source file (1,094 lines, 7 domains). `jest.config.js` has no coverage settings. `test:ci` is `--runInBand` (`package.json:16`) with 4 CPUs here.
- Why it matters: Every test file loads ~55 recording modules, and the stub drifts silently from the real API. A new query that tests forget to stub fails with `undefined is not a function`.
- Recommendation: Call the recording reset only in recording and editor tests. Split `queries.ts` into `queries/{transcripts,projects,people,tags,speakers}.ts` and replace the global mock with a typed `createQueriesMock(overrides)` checked against the real module with `satisfies`. Run `--coverage` in CI as a report (no threshold yet).
- Effort: M
- Confidence: medium (load cost not measured; I did not run tests)

### [P2] Test pyramid is mock-heavy with no e2e; some server routes untested
- Lens: reliability
- Evidence: 239 `jest.mock(` calls, 93 RTL files, 83 node-env files, no Playwright/Cypress. The `media-url` and `waveform-url` routes (signed-URL minting, ownership) have no route-level test; their names appear only in `auth/accountBoundFetch.test.ts`, `proxy.test.ts`, `editor.test.tsx`. The same goes for `media-proxy`, `inngest` and `deepgram/health`. `components/auth` is 2,491 lines with 3 test files. The suite is otherwise deterministic: 0 skips, 0 `.only`, 28 files on fake timers, 18 real sleeps (almost all `setTimeout(0)` flushes).
- Why it matters: The sign-in, upload, transcribe and edit path is verified only as mocked pieces.
- Recommendation: Add route tests for media-url and waveform-url. Add one Playwright smoke test (sign in, upload a tiny file on the local stack, open the editor) as a nightly job. Replace the 1,100 ms real sleep at `__tests__/projects/projectPeopleDialog.ui.test.tsx:504` with fake timers.
- Effort: M
- Confidence: high

### [P2] Docs have drifted; CLAUDE.md is itself a maintenance burden
- Lens: maintainability
- Evidence: CLAUDE.md is 5,154 words (38 KB), CHANGELOG.md 26,831 words (212 KB), AGENTS.md 935 words.
  - Stale CLAUDE.md claims: "~80 test files" (line 190; actual 229); "~40 files under lib/recording" (line 127; actual 55); "three React 19 rules downgraded" (the config downgrades five); `eslint-config-next@16.2.1` (actual 16.3.1); data-model list omits `projects`, `people`, `organisations`.
  - Resolved "Known Issue" (line 194): installed `typescript-eslint` is 8.67.0 with peer `typescript >=4.8.4 <6.1.0`, and `npm ls` shows 0 invalid edges.
  - AGENTS.md: says Next 16.2.1 (line 9) and repeats the stale TS-eslint paragraph. Its commands, stack, creds and lint notes duplicate CLAUDE.md.
  - PRD.md: "Last updated: March 26, 2026", Deepgram-only (0 mentions of Soniox/AssemblyAI). README's stack line also lists Deepgram only.
  - Accurate: 16 API routes and the 9 Inngest events/handlers match the code.
- Why it matters: Agents and new hires get wrong facts. The 1,500-word auth and pipeline paragraphs restate code and will rot first.
- Recommendation: Cut CLAUDE.md to ~1,500 words (layers, commands, invariants, links); move the auth, pipeline and editor narratives into `.docs/` or code comments. Make AGENTS.md a short pointer. Drop numeric counts. Mark PRD.md superseded or delete it. Reduce CHANGELOG to a short index and drop the hand-typed test counts.
- Effort: M
- Confidence: high

### [P2] Dependency and environment pinning is inconsistent
- Lens: reliability
- Evidence: 22 of 63 deps are caret ranges, e.g. runtime `inngest ^4.1.0`, `react`, `docx`, `tus-js-client`, `@ffmpeg-installer/ffmpeg`, and dev `eslint`, `tsx`, `pg`. The other 41 are exact. `package.json:17` runs `inngest-cli@latest`, while `infra/docker-compose.dev.yml:12` pins `v1.19.2`, so host and Docker flows use different CLIs (`dev.sh` uses the script). `frontend/Dockerfile:6` uses `npm ci || npm install`, which hides lockfile drift. `@types/node` is 26.2.0 (`package.json:69`) against a Node 24 runtime, and there is no `.nvmrc`. Majors behind per `npm outdated`: `eslint` 9→10, `@workos-inc/node` 10.14→12.1, `iron-session` 8→9, `typescript` 6→7.
- Why it matters: Dev/prod parity and reproducible installs.
- Recommendation: Pick one policy (exact pins plus grouped Dependabot). Add the Inngest CLI as a pinned devDependency matching the compose tag. Make the Dockerfile `npm ci` only. Add `.nvmrc` (24) and align `@types/node` to 24.
- Effort: S
- Confidence: high

### [P3] Dead weight and duplicate entry points
- Lens: maintainability
- Evidence:
  - `frontend/scripts/move-job-payloads-to-storage.ts` (150 lines) is a one-time migration helper; its only consumer is the guard at `infra/supabase/migrations/20261016010000_drop_job_payload.sql:16`, which is moot with no data.
  - `components/auth/IsoSheet.tsx` is the only unreferenced module (documented as kept); `iso-sheet.ts` plus its test exist only to support it.
  - `soniox-poc/` (3 files; its own README says "delete when done"; `.claude/launch.json` still serves it) while Soniox is now a production engine. `Olivetti.html` (86 KB), `env.example` (0 bytes), `dev.sh` (233 lines) + `dev-sh-readme.md`; the README documents three local flows.
  - `.devin/workflows` and `.agent/workflows` describe completed refactors under paths that moved to `.docs/archive/`.
  - `dev.sh:124` runs `pkill -f "inngest-cli"`, which kills any Inngest CLI on the machine. `scripts/test-e2e-transcription.ts` (261 lines) is manual and may be stale.
- Why it matters: Each extra entry point is something a contributor must learn and keep in sync.
- Recommendation: Delete the payload script (and make the migration a plain `DROP COLUMN`), `soniox-poc/`, `Olivetti.html`, `env.example` and the stale workflows. Keep `start-local.sh` plus `npm run dev` as the two documented flows. Decide on IsoSheet (delete both iso files and the test).
- Effort: S
- Confidence: high

### [P3] Env access is scattered and incompletely documented
- Lens: maintainability
- Evidence: 59 `process.env` reads across 28 non-test files, no central validated module. Used but absent from `frontend/.env.example`: `DEEPGRAM_STORAGE_URL`, `DG_API_KEY` (legacy alias, `app/api/webhooks/deepgram/health/route.ts:68`), `WORKOS_COOKIE_NAME`, `SUPABASE_DB_URL`.
- Why it matters: A missing variable surfaces on the first request rather than at boot.
- Recommendation: One `infra/env.ts` with a zod schema parsed lazily per entrypoint. Add the missing keys to `.env.example`. Delete the `DG_API_KEY` alias.
- Effort: M
- Confidence: medium

## Layering scan results

Commands (from `frontend/`): `grep -rnE "from ['\"](@/(infra|lib|app|components)|react|next|@supabase)" core`; the same for `contracts`; `grep -rnE "(from|import\()\s*['\"]<pkg>" app components lib core contracts proxy.ts` per SDK.

| Check | Count | Verdict |
|---|---|---|
| `core` → `@/infra` | 7 lines / 3 files: `transcription/start.ts:9-11`, `transcription/webhook.ts:11,12,16`, `transcripts/create.ts:10` | Violation: orchestration, not pure domain. |
| `core` → `@/lib` | 1: `transcripts/create.ts:11` | Violation. |
| `core` → `@supabase/supabase-js` | 4, all `import type` (`create.ts:8`, `webhook.ts:10`, `transition.ts:9`, `start.ts:8`) | Legit (types). |
| `core` → react/next/`@/app`; `fetch(` | 0 | Clean. |
| `core` `process.env` | 1 (`start.ts:58-59`) | Minor violation. |
| `contracts` imports | only `zod` and sibling contracts | Clean. |
| `@supabase` outside `infra/` | 21 type-only imports (app 2, lib 15, core 4); `lib/supabase/export-data.ts:7` is a value-form import used as a type | Legit. |
| `@workos-inc/*` outside `infra/` | 11 imports, 9 value and 2 type (`app/auth/*/route.ts` ×4, `lib/auth/*` ×6, `proxy.ts`) | Systematic exception; `infra/workos` is one 73-line file. Update the rule or move the glue. |
| `inngest` outside `infra/` | 5 (`app/api/inngest/route.ts:8`, `lib/inngest/events.ts:8`, `engine-callback.ts:8`, `handle-waveform-requested.ts:8`, `handle-transcription-timeouts.ts:6`) | Acceptable (function definitions are glue). |
| `tus-js-client`, `iron-session`, `@workos/radar-signals` | `lib/capture/storageTransfer.ts:1`, `lib/auth/attempt-cookies.server.ts:5`, `components/auth/SignInForm.tsx:21` | Rule exceptions. No Deepgram/Soniox/AssemblyAI SDK is used (raw `fetch` in `infra/`). |
| Other inversions | `infra` → `@/lib`: 4 (`workos/access-token.ts:10`, `supabase/server.ts:20,21`, `inngest/client.ts:10` type-only); `lib` → `@/components`: 5; `components` → `@/app`: 3; `lib` → `@/app`: 0 | Smells. |

## Dead-code candidates
- `components/auth/IsoSheet.tsx`: the only module with no importer (script over 421 files, `@/` alias and Next entrypoints handled). `iso-sheet.ts` is kept alive only by `__tests__/auth/isoSheet.test.ts`.
- One-offs: `frontend/scripts/move-job-payloads-to-storage.ts`, `soniox-poc/`, `Olivetti.html`, root `env.example`.
- Exports with no importer anywhere: 195, mostly types and Zod schemas that are merely over-exported (the value-level ones I spot-checked are used internally). A further 66 exports are used only by tests (e.g. `core/transcription/machine.ts` `validateJobTransition`, `isJobStatus`).

## Hygiene counts

| Folder | LOC | TODO/FIXME/HACK | eslint-disable | ts-ignore/expect | `any` | console.log |
|---|---|---|---|---|---|---|
| app | 9,914 | 0 | 0 | 0 | 1 | 11 |
| components | 16,934 | 0 | 1 | 0 | 1 | 0 |
| lib | 18,089 | 0 | 2 | 0 | 0 | 42 |
| core | 4,347 | 0 | 0 | 0 | 0 | 7 |
| infra | 1,228 | 0 | 0 | 0 | 0 | 6 |
| contracts | 1,179 | 0 | 0 | 0 | 0 | 0 |
| scripts | 1,420 | 0 | 0 | 0 | 0 | 63 (CLI output) |
| __tests__ | 62,173 | 0 | 0 | 1 | 72 | 0 |

Largest non-test files: `lib/supabase/queries.ts` 1,094; `components/auth/MicroSlats.tsx` 1,012 (vendored); `lib/hairline/kernel.js` 721 (vendored); `EditorScreen.tsx` 660; `components/AudioPlayer.tsx` 637; `core/transcription/webhook.ts` 633; `lib/supabase/realtime/reconciliation.ts` 607; `TranscriptSegmentCard.tsx` 595; `lib/supabase/hooks.ts` 593; `ProjectPeopleDialog.tsx` 582; `lib/capture/upload.ts` 575; `contracts/db.ts` 571; `SignInSteps.tsx` 529; `lib/recording/sessionActions.ts` 502; `Sidebar.tsx` 501. Real split candidates: `queries.ts`, `webhook.ts`, `contracts/db.ts`.

## Quick wins
- Rotate the committed test password, move it out of CLAUDE.md/AGENTS.md, and fix the `.gitignore` contradiction.
- Bump `next` to 16.4.4 and `zod` to ≥4.6.6; add `.github/dependabot.yml`.
- Add the `verify` CI workflow (typecheck, lint, test, build) on Node 24 with npm cache.
- Delete `move-job-payloads-to-storage.ts`, `soniox-poc/`, `Olivetti.html`, root `env.example`, and the stale `.devin`/`.agent` workflows.
- Fix CLAUDE.md's wrong numbers, delete the resolved TS-eslint "Known Issue", and reduce AGENTS.md to a pointer.

## Zero-in candidates
1. **CI plus DB-test automation (Supabase in Actions).** Makes every other fix regression-proof and closes the biggest reliability gap.
2. **`core/` layering and `lib/supabase/queries.ts` decomposition.** Fix the boundary and the mock drift together, before more contributors arrive.
3. **Docs diet (CLAUDE.md/AGENTS.md/PRD/CHANGELOG).** Agents read these on every task, so stale content costs every session.

## Cross-domain notes
- `frontend/scripts/smoke-test-*.sql` and `infra/supabase/migrations/20261016010000_drop_job_payload.sql` (data): decide whether to wire the SQL scripts into CI; the payload guard can go.
- `app/api/webhooks/deepgram/route.ts:57-155` (pipeline): step-by-step `console.log` in a hot webhook path; use structured logs.
- `proxy.ts`, `app/auth/actions.ts` (auth): Server Actions are the surface affected by the `next` advisory.
- `frontend/Dockerfile` (infra): runs `npm run dev` as CMD, so it is a dev image only; no `vercel.json` or documented deploy path.

## Open questions
- Is `00xzero/TranscriptionAppV1` private? That sets the severity of the committed password.
- Is Vercel connected and running `next build` (which type-checks) on PRs? If so it is the only existing gate; I found no config to confirm.
- Does `scripts/test-e2e-transcription.ts` still run? Not executed.
- How long does the full suite take? The lead's baseline will show whether `--runInBand` is a real cost.

## What's good
- Exceptional code hygiene: 0 TODO/FIXME, 3 eslint-disables in ~52k source lines, 0 `ts-ignore` in source, 1 unreferenced module.
- Layers are mostly respected: `contracts/` imports only zod and siblings, `core/` has no React/Next/`fetch`, and there is no `lib` → `app` import.
- A large, deterministic suite: 229 files, 0 skip/only, fake timers in 28 files, `fake-indexeddb`, a frozen Deepgram snapshot, and an AuthKit outage contract test that runs the installed package.
- Committed lockfile, a Docker dev flow that detects lockfile changes (`frontend/scripts/docker-dev-start.sh`) with offline mode, and well-documented `infra/` scripts.
