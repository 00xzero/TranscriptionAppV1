# Inngest v4 Phase 7 Implementation Plan

**Date:** 2026-03-30  
**Branch:** `deps/phase-7-inngest-4`  
**Goal:** Upgrade the frontend Inngest integration from v3 to v4.1.0 with no runtime regressions in the transcription pipeline.

## Scope

This phase covers the Inngest SDK upgrade only. It does not include the later `@types/node` refresh.

## Key Decisions

1. Use the v4 `createFunction({ triggers }, handler)` shape everywhere.
2. Move event definitions to a v4-compatible model.
3. Treat typed `inngest.send()` preservation as an explicit implementation choice, not an assumption.
4. Fix the `transcription/failed` event contract so it supports the current "unknown job ID" failure path safely.
5. Treat `INNGEST_DEV=1` as required for non-Docker local development.

## Required File Changes

### Dependency upgrade

- `frontend/package.json`
  - Upgrade `inngest` to `^4.1.0`.
- `frontend/package-lock.json`
  - Update lockfile after install.

### Event typing and client

- `frontend/lib/inngest/events.ts`
  - Replace the v3 record/type-map pattern with v4-compatible event definitions.
  - Recommended shape: one export per event trigger.
- `frontend/infra/inngest/client.ts`
  - Remove the v3-only `EventSchemas().fromRecord(...)` pattern.
  - Configure the client in a v4-compatible way.
  - Decide whether to preserve typed `send()` now or accept a temporary reduction in send-site inference.

### Contract fix required by runtime validation

- `frontend/contracts/events.ts`
  - Update `TranscriptionFailedDataSchema` so it matches real send behavior.
  - Current blocker: the webhook `onFailure` path can emit `jobId = ""`, which is incompatible with UUID validation.
  - Preferred fix: make `jobId` optional or nullable, and update senders to omit it when unknown instead of sending an empty string.

### Function migrations

- `frontend/lib/inngest/functions/handle-transcription-requested.ts`
- `frontend/lib/inngest/functions/handle-transcription-webhook.ts`
- `frontend/lib/inngest/functions/handle-transcription-completed.ts`
- `frontend/lib/inngest/functions/handle-transcription-failed.ts`
- `frontend/lib/inngest/functions/handle-transcription-timeouts.ts`

For each file:

- Import the appropriate trigger helper or event definition.
- Move the trigger into `triggers` on the function config.
- Collapse `createFunction()` from 3 arguments to 2.
- Keep retries, concurrency, and `onFailure` behavior intact unless type errors force a targeted change.

### No expected structural changes, but must verify

- `frontend/app/api/inngest/route.ts`
  - `serve()` should remain structurally unchanged.
- `frontend/core/transcription/start.ts`
  - `inngest.send()` call should still work after client/event updates.
- `frontend/core/transcription/webhook.ts`
  - `inngest.send()` call should still work after client/event updates.

### Docs and local-dev support

- `README.md`
  - Document that non-Docker local development requires `INNGEST_DEV=1`.
- `frontend/.env.example`
  - Add `INNGEST_DEV=1` under the Inngest section.
- `.gitignore`
  - Ensure `frontend/.env.example` is not ignored so the template can be tracked.

## Suggested Implementation Order

1. Create branch `deps/phase-7-inngest-4`.
2. Upgrade the package and regenerate the lockfile.
3. Update the event contract in `frontend/contracts/events.ts`.
4. Replace the v3 event definitions in `frontend/lib/inngest/events.ts`.
5. Update `frontend/infra/inngest/client.ts`.
6. Migrate the five function files one by one.
7. Type-check after the client/events migration and again after all functions are updated.
8. Update docs and env template.
9. Run validation.

## Validation Commands

From `frontend/`:

```bash
npx tsc --noEmit
npm test -- --runInBand
npm run build
```

Targeted safety checks:

```bash
npm test -- --runInBand --runTestsByPath __tests__/inngestHandlers.test.ts __tests__/transcriptionTimeouts.test.ts
```

## Manual Verification

1. Add `INNGEST_DEV=1` to `frontend/.env.local`.
2. Start the frontend locally.
3. Start `npm run inngest`.
4. Start the local infra stack with `cd infra && ./start-local.sh`.
5. Trigger a transcription end-to-end.
6. Confirm the Inngest dev dashboard shows successful handler runs.
7. Confirm the Deepgram webhook path completes the job successfully.
8. Confirm a forced failure still updates project/job error state even when no job ID can be resolved up front.

## Watch Items

- `frontend/__tests__/inngestHandlers.test.ts`
  - Uses internal `.fn` and `.onFailureFn` properties.
- `frontend/__tests__/transcriptionTimeouts.test.ts`
  - Uses internal `.fn` property.
- `frontend/lib/inngest/functions/handle-transcription-webhook.ts`
  - Failure path currently resolves no job ID in some cases.
- `frontend/package-lock.json`
  - Baseline currently resolves `inngest@3.52.7`, not `3.49.1`.

## Done When

- Inngest is upgraded to `4.1.0`.
- The `transcription/failed` contract matches real event payloads.
- `npx tsc --noEmit` passes.
- `npm test -- --runInBand` passes.
- `npm run build` is code-clean apart from known external font-fetch issues.
- Local end-to-end transcription succeeds with Inngest v4 in dev mode.
