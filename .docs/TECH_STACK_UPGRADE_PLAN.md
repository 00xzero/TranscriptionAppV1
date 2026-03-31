# Tech Stack Upgrade Plan — Final Status

**Date:** 2026-03-31
**Goal:** Bring the frontend dependency stack to current stable versions without losing upgrade history or sending future work to stale file paths.
**Status:** The upgrade plan is complete on `codex/finish-tech-stack-upgrade`. All target dependency upgrades are in place, the Inngest 4 migration has been validated, and the remaining `@types/node` follow-up is closed.

---

## Ground Rules

1. **Keep validation anchored in TypeScript.** `npx tsc --noEmit` remains the fastest signal for upgrade regressions in this repo, especially with the known TypeScript 6 / `typescript-eslint` mismatch.
2. **Use the current architecture.** The schema layer lives in `frontend/contracts/`, service clients live in `frontend/infra/`, and application logic lives in `frontend/core/` plus `frontend/lib/inngest/`.
3. **Interpret `npm run build` carefully in restricted environments.** The current build is considered code-clean when the only remaining failure is the external `next/font` Google Fonts fetch for `Inter`, `Newsreader`, and `IBM Plex Mono`.

---

## Current vs Target

| Package | Current | Target | Status |
|---|---|---|---|
| `@testing-library/jest-dom` | 6.9.1 | 6.9.1 | Complete |
| `@testing-library/user-event` | 14.6.1 | 14.6.1 | Complete |
| `@supabase/supabase-js` | 2.100.1 | 2.100.1 | Complete |
| `@supabase/ssr` | 0.9.0 | 0.9.0 | Complete |
| `docx` | 9.6.1 | 9.6.1 | Complete |
| `postcss` | 8.5.8 | 8.5.8 | Complete |
| `autoprefixer` | Removed | Removed | Complete via Tailwind 4 migration |
| `jest` | 30.3.0 | 30.3.0 | Complete |
| `jest-environment-jsdom` | 30.3.0 | 30.3.0 | Complete |
| `@types/jest` | 30.0.0 | 30.0.0 | Complete |
| `react` | 19.2.4 | 19.2.4 | Complete |
| `react-dom` | 19.2.4 | 19.2.4 | Complete |
| `@types/react` | 19.2.14 | 19.2.14 | Complete |
| `@types/react-dom` | 19.2.3 | 19.2.3 | Complete |
| `@testing-library/react` | 16.3.2 | 16.3.2 | Complete |
| `next` | 16.2.1 | 16.2.1 | Complete |
| `tailwindcss` | 4.2.2 | 4.2.2 | Complete |
| `zod` | 4.3.6 | 4.3.6 | Complete |
| `inngest` | 4.1.0 | 4.1.0 | Complete |
| `typescript` | 6.0.2 | 6.0.2 | Complete |
| `@types/node` | 25.5.0 | 25.5.0 | Complete |

---

## Completed Work

### Phases 1-6

Previously completed:
- patch and minor dependency bumps
- Jest 30
- React 19
- Next.js 16
- Tailwind CSS 4
- Zod 4
- TypeScript 6 and the `es2025` baseline

### Phase 7 — Inngest 4

Completed on 2026-03-31.

Delivered:
- `inngest` upgraded to `4.1.0`
- v4 event definitions and typed send helper in `frontend/infra/inngest/client.ts` and `frontend/lib/inngest/events.ts`
- v4 `createFunction({ triggers }, handler)` migration across all transcription handlers
- `transcription/failed` contract aligned with real runtime behavior by making `jobId` optional
- non-Docker docs/templates explicitly calling out `INNGEST_DEV=1`
- handler tests moved to the v4-friendly `@inngest/test` engine

### Phase 8 — `@types/node` 25

Completed on 2026-03-31.

Delivered:
- `@types/node` upgraded from `20.19.37` to `25.5.0`
- `frontend/package-lock.json` refreshed for the new Node type definitions
- `frontend/scripts/test-e2e-transcription.ts` made repeatable by accepting a project id from CLI arg or `TEST_PROJECT_ID`
- the E2E script now uses `getMediaUrlForDeepgram()` so Docker-backed local verification uses the same publicly routable media URL logic as the app
- `infra/start-local.sh` now writes the current `DEEPGRAM_CALLBACK_URL` back into `infra/.env.docker` and launches ngrok with a detached `nohup` flow

---

## Validation Status

Validated on `codex/finish-tech-stack-upgrade`:

- `cd frontend && npx tsc --noEmit`
  - Passed
- `cd frontend && npm test -- --runInBand`
  - Passed: `26` suites / `295` tests
- `cd frontend && npm test -- --runInBand __tests__/deepgramWebhook.test.ts __tests__/inngestHandlers.test.ts`
  - Passed: `2` suites / `25` tests
- `cd frontend && npm run build`
  - Remains code-clean apart from the known restricted-environment `next/font` fetch failures for `Inter`, `Newsreader`, and `IBM Plex Mono`

Local Docker workflow verification:

- `cd infra && ./start-local.sh`
- `cd frontend && npx tsx --env-file=../infra/.env.docker scripts/test-e2e-transcription.ts 72d98ea6-f082-44d7-b4d3-ad4082f30292`
- Result: transcription completed successfully for `Dechra Leadership Contracting huddle 25.03`
- Observed output:
  - `278` segments
  - `146` chunks
  - `5537` chunk words
  - `13` speakers
  - output written to `frontend/scripts/test-output-72d98ea6-f082-44d7-b4d3-ad4082f30292.json`

Failure-path verification:

- Existing automated coverage still verifies that:
  - project-level error fallback works when no job can be resolved
  - `transcription/failed` remains valid when `jobId` is omitted

---

## Remaining Follow-ups

None in this plan.

---

## Completion Checklist

When the upgrade work is truly complete:

- [x] Phases 1-6 are merged
- [x] Inngest is upgraded to 4.1.0
- [x] `@types/node` is upgraded to 25.5.0
- [x] `npx tsc --noEmit` passes on the final closure branch
- [x] `npm test -- --runInBand` passes on the final closure branch
- [x] `npm run build` is code-clean, with only the documented restricted-environment Google Fonts fetch failures remaining
