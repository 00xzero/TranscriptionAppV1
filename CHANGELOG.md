# Changelog

All notable changes to this project will be documented in this file.

## [2026-03-31] - Tech Stack Upgrade: Phase 7 — Inngest 4

Upgraded the frontend Inngest integration from the v3 SDK line to Inngest 4.1.0, migrated function registration to the v4 trigger model, and tightened the failure-event contract so webhook and request failure paths still reach job or project error handling when no job ID can be resolved. This phase also refreshes local-development guidance so non-Docker work explicitly runs Inngest in dev mode.

### Added

- **`.docs/INNGEST_V4_PHASE_7_IMPLEMENTATION_PLAN.md`** — Implementation plan for the Inngest v4 migration, including trigger-model decisions, validation steps, and watch items.
- **`frontend/.env.example`** — New frontend local env template with `INNGEST_DEV=1` and Inngest key placeholders for non-Docker development.
- **`@inngest/test`** 1.0.0 added as a frontend dev dependency for v4-oriented function tests.
- **`frontend/.dockerignore`** — New Docker ignore file to keep local build contexts smaller and avoid copying local-only artifacts into the frontend image context.

### Changed

- **`inngest`** ^3.49.1 → ^4.1.0
- **`frontend/package-lock.json`** — Lockfile refreshed for the Inngest 4 dependency graph and new test helper package.
- **`frontend/infra/inngest/client.ts`** — Removed the v3 `EventSchemas().fromRecord(...)` client setup; added explicit dev-mode configuration and a typed `sendInngestEvent()` helper for app send sites.
- **`frontend/lib/inngest/events.ts`** — Reworked event definitions around v4 `eventType(...)` helpers with schema-backed trigger exports.
- **`frontend/contracts/events.ts`** — Updated `TranscriptionFailedDataSchema` so `jobId` can be omitted when webhook failure handling cannot resolve a job, matching real runtime behavior.
- **`frontend/lib/inngest/functions/*`** — Migrated all transcription handlers to the v4 `createFunction({ triggers }, handler)` shape while preserving retries, concurrency, and failure fallback behavior.
- **`frontend/core/transcription/start.ts`** and **`frontend/core/transcription/webhook.ts`** — Updated event send sites to use the new helper.
- **`frontend/__tests__/inngestHandlers.test.ts`** and **`frontend/__tests__/transcriptionTimeouts.test.ts`** — Reworked handler tests to use `InngestTestEngine` instead of reaching into function internals.
- **`frontend/__tests__/deepgramWebhook.test.ts`** and **`frontend/__tests__/startRouteIdempotency.test.ts`** — Updated mocks to follow the new `sendInngestEvent()` helper export.
- **`frontend/proxy.ts`** — Bypasses auth proxy handling for `/api/inngest` so dev-server sync and execution traffic is not redirected.
- **`frontend/package.json`** and **`infra/docker-compose.dev.yml`** — Updated local Inngest dev commands to use the current CLI invocation and explicit `--no-discovery` URL-based registration.
- **`infra/start-local.sh`**, **`README.md`**, and **`.gitignore`** — Refreshed local-dev docs and templates so `frontend/.env.example` is tracked and non-Docker development clearly documents `INNGEST_DEV=1`.

### Tests

- **`frontend`** — `npm test -- --runInBand __tests__/inngestHandlers.test.ts __tests__/transcriptionTimeouts.test.ts __tests__/deepgramWebhook.test.ts __tests__/startRouteIdempotency.test.ts`
- **`frontend`** — `npx tsc --noEmit`
- **`frontend`** — `npm run build` remains blocked in this environment by `next/font` Google Fonts fetch failures, with no remaining code-level Inngest migration errors observed before the external fetch step

## [2026-03-30] - Tech Stack Upgrade: Phase 6 — Zod 4

Upgraded Zod from 3.25.0 to 4.3.6 and adapted the schema layer to preserve the app's existing validation behavior under Zod 4. This branch introduces a shared UUID primitive to keep the project's legacy UUID-shape acceptance, updates `z.record()` usage for Zod 4 compatibility, and hardens first-error access at validation boundaries. No intended route-contract or domain-type changes.

### Added

- **`frontend/contracts/primitives.ts`** — New shared validation primitives module. Exports `UuidSchema` and `uuidString()` to preserve the project's existing UUID-shape validation semantics after Zod 4 tightened `z.string().uuid()`.

### Changed

- **`zod`** 3.25.0 → 4.3.6
- **`frontend/contracts/db.ts`** — Replaced direct `z.string().uuid()` usage with the shared UUID primitive across DB row and mutation schemas so existing project/job/speaker/segment identifiers continue to validate as before.
- **`frontend/contracts/webhook.ts`** — Switched webhook `project_id` and receipt `attempt_id` validation to the shared UUID primitive to keep Deepgram payload parsing behavior stable under Zod 4.
- **`frontend/contracts/events.ts`** — Updated event payload schemas to use the shared UUID primitive for `projectId`, `jobId`, and `userId`.
- **`frontend/contracts/state-machine.ts`** — Replaced `z.string().uuid('...')` with `uuidString('...')`; updated `z.record()` calls to the Zod 4-compatible two-argument form.
- **`frontend/app/api/projects/route.ts`** — Validation failure response now safely falls back to `'Invalid input'` if Zod returns no first issue message.
- **`frontend/app/api/webhooks/deepgram/route.ts`** — Partial `project_id` extraction now uses the shared UUID primitive; malformed-payload logging now safely falls back to `'Invalid input'`.
- **`frontend/core/transcription/transition.ts`** — Invalid transition input now safely falls back to `'Invalid input'` when no first Zod issue message is present.
- **`frontend/lib/inngest/functions/handle-transcription-webhook.ts`** — Stored Deepgram payload validation errors now safely fall back to `'Invalid input'` in the thrown error message.
- **`frontend/package-lock.json`** — Lockfile refreshed for Zod 4; `inngest` continues to resolve its own nested Zod 3 copy internally.

### Tests

- **`frontend`** — `npx tsc --noEmit`
- **`frontend`** — `npm test -- --runInBand` (`26` suites / `295` tests passing)
- **`frontend`** — `npm run build` remains blocked in this environment by `next/font` Google Fonts fetch failures, with no remaining code-level Zod or TypeScript errors

## [2026-03-30] - Tech Stack Upgrade: Phase 5 — Tailwind CSS 4

Upgraded Tailwind CSS from 3.4.7 to 4.2.2 and migrated the frontend styling setup from the legacy JS config model to Tailwind v4's CSS-first theme system. This branch updates design-token wiring, PostCSS integration, and renamed utility classes across the app UI. No intended product behavior changes; this is a styling/tooling migration.

### Added

- **`.docs/TAILWIND_V4_PHASE_5_UPGRADE_PLAN.md`** — Tailwind v4 migration plan documenting the upgrade steps, token migration targets, and post-upgrade verification checklist.
- **`@tailwindcss/postcss`** 4.2.2 added as a dev dependency for the Tailwind v4 PostCSS pipeline.

### Changed

- **`tailwindcss`** 3.4.7 → 4.2.2
- **`frontend/postcss.config.js`** — Replaced the legacy `tailwindcss` + `autoprefixer` plugin chain with the Tailwind v4 `@tailwindcss/postcss` plugin.
- **`frontend/app/globals.css`** — Replaced `@tailwind base/components/utilities` with `@import "tailwindcss"`; moved color, shadow, and font tokens into `@theme`; added the `@custom-variant dark` declaration and a base-layer border-color compatibility shim for the Tailwind v4 default border-color change.
- **`frontend/app/layout.tsx`** — Renamed Next font CSS variables to `--font-inter`, `--font-newsreader`, and `--font-ibm-plex-mono` to align with the new `@theme inline` token wiring.
- **Frontend UI components** — Updated Tailwind utility usage across auth, projects, editor, capture modal, library, sidebar, player, export, find/replace, and speaker popover surfaces to Tailwind v4-compatible class names and value syntax (for example `shadow-xs`, `rounded-xs`, `backdrop-blur-xs`, `bg-linear-to-*`, and `*(--var)` custom-property utilities).

### Removed

- **`autoprefixer`** — Removed from frontend dev dependencies because Tailwind v4 now bundles prefixing in the new pipeline.
- **`frontend/tailwind.config.ts`** — Deleted in favor of CSS-defined theme tokens in `frontend/app/globals.css`.

### Tests

- **`frontend`** — `npm run lint`

## [2026-03-29] - Tech Stack Upgrade: Phase 5 — TypeScript 6 + ES2025 Baseline

Upgraded TypeScript from 5.9.3 to 6.0.2 and modernized the compiler target from `es5` to `es2025`. Resolves the `Set` iteration build error introduced in Phase 4 and removes legacy ES5 workarounds. No runtime behavior changes.

### Changed

- **`typescript`** 5.9.3 → 6.0.2
- **`@types/node`** 20.11.30 → 20.19.37
- **`frontend/tsconfig.json`** — `target` changed from `es5` to `es2025`; removed redundant `baseUrl` option.
- **`frontend/infra/supabase/cookie.ts`** — `hasCookieWithNameOrChunks` now accepts `Iterable<string>` instead of `Set<string>`; unified equality and prefix check into a single loop.
- **`frontend/core/limits/rate-limit.ts`** — Replaced `Array.from()` ES5 workaround with direct `for...of` iteration on the Map.

### Fixed

- **Build failure from Phase 4**: `for...of` on a `Set` in `cookie.ts` no longer triggers TS2802 — the `es2025` target makes `Set` iteration native.

### Tests

- **`frontend/__tests__/deepgramWebhook.test.ts`** — Added explicit return types and parameter types to mock functions to satisfy TypeScript 6's stricter inference.
- **`frontend/__tests__/editor/useTranscriptMutations.test.ts`** — Removed unused `makeSeg` helper and `Seg` import.

---

## [2026-03-29] - Tech Stack Upgrade: Phase 4 — Next.js 16

Upgraded Next.js from 14.2.5 to 16.2.1, migrated to the ESLint flat-config format, hardened Supabase auth cookie resolution for chunked cookies and legacy cloud cookie names, and fixed spurious auth session warnings on the `/auth` page. No behavior changes to transcription or editor features.

### Added

- **`frontend/infra/supabase/cookie.ts`** — New shared cookie-resolution module. Exports `resolveSupabaseCookieName`, `getBrowserSupabaseCookieName`, and `getServerSupabaseCookieName`. Handles three cases in priority order: explicit `NEXT_PUBLIC_SUPABASE_COOKIE_NAME` env override → local `sb-local-auth-token` (with chunked-fragment detection) → legacy cloud `sb-{projectRef}-auth-token`.
- **`frontend/eslint.config.mjs`** — New ESLint flat config (Next.js 16 ships with ESLint 9 flat-config support; replaces the implicit `.eslintrc` approach).

### Changed

- **`next`** 14.2.5 → 16.2.1
- **`eslint-config-next`** → ^16.2.1 (version-aligned to Next.js)
- **`eslint`** ^9.39.4 added as a dev dependency (ESLint 9 flat-config era)
- **`engines.node`** set to `>=20.9.0` in `package.json` (Next.js 16 minimum)
- **`lint` script** `next lint` → `eslint .` (flat-config compatible invocation)
- **`frontend/next.config.mjs`** — Added `allowedDevOrigins` (Next.js 16 dev-server cross-origin restriction); auto-includes the `DEEPGRAM_CALLBACK_URL` host when set so webhook callbacks are not blocked in local Docker.
- **`frontend/middleware.ts` → `frontend/proxy.ts`** — Renamed file and exported function (`middleware` → `proxy`); integrated `getServerSupabaseCookieName()` for consistent cookie resolution across request, client, and server paths.
- **`frontend/infra/supabase/client.ts`** — Replaced hardcoded `NEXT_PUBLIC_SUPABASE_COOKIE_NAME || 'sb-local-auth-token'` fallback with `getBrowserSupabaseCookieName()`.
- **`frontend/infra/supabase/server.ts`** — Replaced hardcoded cookie-name fallback with `getServerSupabaseCookieName(supabaseUrl, cookieStore.getAll())`.
- **`frontend/components/ContextualHeader.tsx`** — Skips Supabase session fetch on auth routes to avoid spurious session-resolution warnings; `useEffect` dependency updated to `[isAuthRoute]`.
- **`frontend/components/Sidebar.tsx`** — Early-returns from the user-fetch `useEffect` when on an auth route; `useEffect` dependency updated to `[isAuthRoute]`.

### Fixed

- **Chunked auth cookies**: Long Supabase sessions split into browser cookie chunks (`sb-local-auth-token.0`, `.1`, …) are now detected correctly — auth is no longer lost after large sessions.
- **Auth session warning on `/auth`**: `ContextualHeader` and `Sidebar` no longer attempt to resolve a Supabase session on the auth page, eliminating spurious console warnings on first load.

### Tests

- **`frontend/__tests__/supabaseCookie.test.ts`** — New test file covering `resolveSupabaseCookieName`: explicit override, local cookie present, legacy cloud cookie, chunked-cookie detection, and default fallback.
- **`frontend/__tests__/contextualHeader.test.tsx`** — Added coverage for auth-route session-skip behavior.
- **`frontend/__tests__/editor.test.tsx`** — Updated to align with Next.js 16 / auth-flow changes.

---

## [2026-03-27] - Tech Stack Upgrade: Phase 3 — React 19

Upgraded the React ecosystem from 18.3.1 to 19.2.4, migrated all ref patterns to React 19 conventions, and aligned test infrastructure. No behavior changes.

### Changed

- **`react`** 18.3.1 → ^19.2.4
- **`react-dom`** 18.3.1 → ^19.2.4
- **`@types/react`** 18.2.66 → ^19.2.14
- **`@types/react-dom`** 18.2.22 → ^19.2.3
- **`@testing-library/react`** 14.3.1 → ^16.3.2 (React 19-compatible)
- **`@testing-library/dom`** ^10.4.1 added (now an explicit peer dep)
- **`package.json` overrides`** — added to force `@supabase/auth-ui-react` to resolve React 19 peers
- **`React.MutableRefObject` → `React.RefObject`** in `EditorHeader`, `TranscriptList`, `TranscriptSegmentCard`, `useEditorPlayback`, `useUserScrollDetection` — React 19 unifies both types
- **`__mocks__/react-virtuoso.tsx`** — `Virtuoso` converted from `forwardRef` wrapper to plain function with `ref` as a prop (React 19 refs-as-props model)
- **`frontend/components/AudioPlayer.tsx`** — converted from anonymous arrow function to named function inside `forwardRef`; removed now-redundant `displayName` assignment
- **`__mocks__/AudioPlayer.tsx`** — aligned to named function form for React 19 consistency

### Fixed

- **AudioPlayer callback-ref wiring** — imperative `AudioPlayerRef` handle is now delivered correctly to callback refs (used by the editor playback hook) under React 19's updated `forwardRef` semantics

### Tests

- **`frontend/__tests__/audioPlayer.test.tsx`** — updated ref types from `React.ElementRef<typeof AudioPlayer>` to the exported `AudioPlayerRef` type; added "exposes the imperative player handle to callback refs used by the editor" regression test

---

## [2026-03-26] - Tech Stack Upgrade: Phase 2 — Jest 30

Upgraded the test infrastructure from Jest 29 to Jest 30. Isolated to dev dependencies; no app code changes. All 25 suites / 288 tests remain green.

### Changed

- **`jest`** 29.7.0 → 30.3.0 (pinned exact)
- **`jest-environment-jsdom`** 29.7.0 → 30.3.0 (pinned exact)
- **`@types/jest`** 29.5.12 → 30.0.0 (pinned exact)
- **`frontend/__tests__/exportModal.ui.test.tsx`** — replaced removed `jest.SpyInstance` type with `ReturnType<typeof jest.spyOn>`
- **`frontend/__tests__/exports.test.ts`** — updated stale CLI flag comment `--testPathPattern` → `--testPathPatterns` (renamed in Jest 30)

---

## [2026-03-26] - CaptureModal Decomposition

Broke the 528-line monolithic `frontend/components/CaptureModal.tsx` into a folder-based component with focused sub-components, a shared constants/types module, and a dedicated form-state hook. No behavior changes; barrel export preserves all existing import paths.

### Added

- **`frontend/components/CaptureModal/`** — New folder-based component structure:
  - `CaptureModal.tsx` — Slim orchestration shell; composes sub-components and wires context/hooks.
  - `FileDropZone.tsx` — Drag-and-drop file target with MIME validation and visual feedback.
  - `CaptureDetails.tsx` — Language, diarization, and key-terms settings section.
  - `CaptureFooter.tsx` — Submit / Cancel footer with upload-state button text logic.
  - `KeyTermsInput.tsx` — Chip-based key-term input with add/remove controls and tag display.
  - `useCaptureForm.ts` — Form state hook encapsulating file selection, key-term management, and upload orchestration.
  - `shared.ts` — Shared constants and pure helpers (`MAX_KEY_TERMS`, `formatFileSize`).
  - `index.ts` — Barrel re-export so `@/components/CaptureModal` resolves identically to before.

### Removed

- **`frontend/components/CaptureModal.tsx`** — Monolithic 528-line file deleted; superseded by the folder structure above.

## [2026-03-25] - Clear Boundaries Architecture

Restructured `frontend/` into three explicit architectural layers — `contracts/`, `infra/`, and `core/` — and extracted business logic from the three fat route handlers into dedicated application services. No behavior changes; TypeScript import resolution confirms full coverage.

### Added

- **`frontend/contracts/`** — New Zod schema layer (rename of `lib/schemas/`). Single source of truth for all runtime-validated types and inferred TypeScript interfaces:
  - `contracts/db.ts` — DB row/insert/update shapes + status enums (absorbs `lib/supabase/types.ts` DB row re-exports)
  - `contracts/api.ts` — Request body schemas (`CreateProjectBodySchema`)
  - `contracts/events.ts` — Inngest event payload schemas
  - `contracts/webhook.ts` — Deepgram wire-format schemas
  - `contracts/editor.ts` — Editor pipeline data schemas
  - `contracts/state-machine.ts` — `TransitionJobInputSchema`
- **`frontend/infra/`** — New true-adapter layer for external service wrappers:
  - `infra/supabase/{admin,client,server,storage}.ts` — Supabase client factories
  - `infra/deepgram/index.ts` — Deepgram API client
  - `infra/inngest/client.ts` — Inngest client
- **`frontend/core/`** — New domain logic + application service layer:
  - `core/transcription/machine.ts` — State machine (moved from `lib/state-machine.ts`)
  - `core/transcription/transition.ts` — Job transition application service (moved from `lib/supabase/transition.ts`)
  - `core/transcription/start.ts` — Start-transcription application service (extracted from `POST /api/projects/[id]/start`)
  - `core/transcription/webhook.ts` — Deepgram webhook handler service (extracted from `POST /api/webhooks/deepgram`)
  - `core/transcript/consolidation.ts` — Consolidation algorithm (moved from `lib/consolidation.ts`)
  - `core/transcript/consolidation-service.ts` — Consolidation orchestration (moved from `lib/inngest/consolidation-service.ts`)
  - `core/exports/{index,data}.ts` — Export generation logic (moved from `lib/exports.ts` + `lib/exports/`)
  - `core/limits/rate-limit.ts` — Rate limiter (moved from `lib/rate-limit.ts`)
  - `core/projects/create.ts` — Create-project application service (extracted from `POST /api/projects`)
- **`.docs/V3_PHASE1_CLEAR_BOUNDARIES_PLAN.md`** — Architecture plan documenting the layer boundaries, current → target file mapping, and enforcement rules.

### Changed

- **Route handlers thinned** — `POST /api/projects`, `POST /api/projects/[id]/start`, and `POST /api/webhooks/deepgram` are now thin shells: auth → Zod parse → call `core/` service → return response. No `from()` calls or business logic in routes.
- **All consumers updated** — 65 files updated from `@/lib/schemas/` → `@/contracts/`, `@/lib/supabase/{admin,client,server,storage}` → `@/infra/supabase/`, `@/lib/deepgram` → `@/infra/deepgram`, `@/lib/inngest/client` → `@/infra/inngest/client`, and core module paths throughout tests, Inngest functions, components, and scripts.

### Removed

- **`frontend/lib/schemas/`** — All 6 files deleted; superseded by `contracts/`.
- **`frontend/lib/supabase/types.ts`** — DB row re-exports merged into `contracts/db.ts`; file deleted.
- **`frontend/lib/supabase/{admin,client,server,storage}.ts`** — Moved to `infra/supabase/`.
- **`frontend/lib/deepgram.ts`** — Moved to `infra/deepgram/index.ts`.
- **`frontend/lib/inngest/client.ts`** — Moved to `infra/inngest/client.ts`.
- **`frontend/lib/inngest/consolidation-service.ts`** — Moved to `core/transcript/consolidation-service.ts`.
- **`frontend/lib/state-machine.ts`** — Moved to `core/transcription/machine.ts`.
- **`frontend/lib/supabase/transition.ts`** — Moved to `core/transcription/transition.ts`.
- **`frontend/lib/consolidation.ts`** — Moved to `core/transcript/consolidation.ts`.
- **`frontend/lib/exports.ts`** + **`frontend/lib/exports/`** — Moved to `core/exports/`.
- **`frontend/lib/rate-limit.ts`** — Moved to `core/limits/rate-limit.ts`.

## [2026-03-23] - Zod Schema Layer

### Added

- **Central Zod schema directory**: Added `frontend/lib/schemas/` as the single source of truth for all runtime-validated types, replacing hand-written TypeScript interfaces scattered across the codebase.
  - `schemas/db.ts` — Zod schemas + inferred types for all DB row/insert/update shapes (`Project`, `Job`, `Speaker`, `Segment`, `Chunk`, `Word`, `ChunkWord`, `WatchlistTerm`) and status enums (`JobStatusSchema`, `ProjectStatusSchema`).
  - `schemas/webhook.ts` — Zod schemas for Deepgram wire types (`DeepgramWebhookPayloadSchema`, `DeepgramAsyncResponseSchema`, `DeepgramWordSchema`, `DeepgramUtteranceSchema`, `WebhookReceiptInsertSchema`).
  - `schemas/events.ts` — Zod schemas for all four Inngest event payloads (`TranscriptionRequestedData`, `TranscriptionWebhookData`, `TranscriptionCompletedData`, `TranscriptionFailedData`).
  - `schemas/state-machine.ts` — `TransitionJobInputSchema` for validating `transitionJob()` call-sites at runtime.
  - `schemas/editor.ts` — `EditorWordSchema`, `EditorChunkSchema`, `EditorSegmentSchema`, `EditorProjectSchema`, `EditorSpeakerSchema` for the editor data pipeline.
  - `schemas/api.ts` — `CreateProjectBodySchema` for the `POST /api/projects` request body.
- **Schema-level tests**: Added `frontend/__tests__/schemas.test.ts` covering `CreateProjectBodySchema`, `DeepgramWebhookPayloadSchema`, `DeepgramAsyncResponseSchema`, `TransitionJobInputSchema`, and `JobStatusSchema`/`ProjectStatusSchema` enum validation.
- **Project route unit tests**: Added `frontend/__tests__/createProject.test.ts` with request-level tests for the `POST /api/projects` handler (missing filename, empty filename, valid body, key-term passthrough).

### Changed

- **`frontend/lib/supabase/types.ts`**: Converted from a large hand-written type file to a thin re-export barrel. All types (`Project`, `Job`, `JobSummary`, `Speaker`, `Segment`, `Chunk`, etc.) now re-exported from `@/lib/schemas/db` and `@/lib/schemas/editor`. `Json` kept as a plain TypeScript type.
- **`frontend/lib/state-machine.ts`**: `JobStatus` and `ProjectStatus` are now `z.infer<>` derivations from `JobStatusSchema`/`ProjectStatusSchema` instead of manually maintained string unions.
- **`frontend/lib/supabase/transition.ts`**: `transitionJob()` now runs `TransitionJobInputSchema.safeParse()` at the entry point, returning `{ outcome: 'invalid' }` early on malformed input before touching the database.
- **`frontend/lib/deepgram.ts`**: Removed all locally defined interfaces (`DeepgramResponse`, `DeepgramWord`, `DeepgramUtterance`, `DeepgramAsyncResponse`); now re-exports from `@/lib/schemas/webhook` as the single source of truth.
- **`frontend/lib/inngest/events.ts`**: `TranscriptionEvents` data shapes now point to Zod-derived types from `@/lib/schemas/events` instead of inline object type literals.
- **`frontend/app/api/projects/route.ts`**: Request body now validated with `CreateProjectBodySchema.safeParse()`, returning `400` with a structured error on invalid input.
- **`frontend/app/api/webhooks/deepgram/route.ts`**: Webhook payload now validated with `DeepgramWebhookPayloadSchema.safeParse()`, returning `400` on structurally invalid payloads before any downstream processing.
- **`frontend/app/editor/[id]/hooks/useEditorData.ts`**: Added non-blocking `safeParse` validation for transcript items (`ChunkSchema`/`SegmentSchema`), speakers (`EditorSpeakerSchema`), and project (`EditorProjectSchema`), logging schema mismatches as warnings without breaking the UI.
- **`frontend/app/editor/[id]/types.ts`**: `Seg` type broadened from `Chunk & { words? }` to `(Chunk | Segment) & { words? }` to reflect that the editor can render both chunk and segment sources.
- **`frontend/package.json`**: Added `zod` as a production dependency.

## [2026-03-21] - Deepgram Webhook Idempotency

### Added

- **Webhook receipt tracking**: Added `infra/supabase/migrations/20260321000000_webhook_receipts.sql` to persist one receipt per Deepgram `request_id`, including attempt ownership, lease timing, processing status, and last-error metadata for webhook recovery.
- **Replay-path regression coverage**: Expanded `frontend/__tests__/deepgramWebhook.test.ts` with receipt-aware tests covering completed duplicates, fresh in-flight duplicates, stale takeovers, lost takeover races, downstream failure cleanup, and finalize-failure behavior.

### Changed

- **Webhook route idempotency flow**: `frontend/app/api/webhooks/deepgram/route.ts` now claims a receipt before persisting the payload, returns `200` for already completed duplicates, returns `503` for active in-flight duplicates and lost takeover races, reclaims stale/failed receipts, and marks failures against the owning `attempt_id`.
- **Replay guard in webhook handler**: `frontend/lib/inngest/functions/handle-transcription-webhook.ts` now checks the resolved job status before replaying a webhook event and skips transcript reprocessing when the job is already completed.

### Fixed

- **Duplicate callback handling**: Repeated Deepgram callbacks no longer re-enqueue the normal downstream flow once the webhook has already been durably accepted or is still being processed by another attempt.
- **Partial-failure recovery**: The webhook path now leaves enough receipt state behind to retry safely after transient database errors, stale attempts, or route-level failures without silently losing ownership.

## [2026-03-20] - Inngest Functions Modularization

### Refactored

- **Inngest functions split**: Broke the 856-line monolithic `frontend/lib/inngest/functions.ts` into a `functions/` directory with one file per handler, a shared helper module, and a barrel `index.ts`. No consumer changes required — `@/lib/inngest/functions` resolves identically via TypeScript directory index resolution.
  - `functions/_shared.ts` — `TranscriptionFailurePayload` type + `writeTranscriptionFailureFallback()` helper
  - `functions/handle-transcription-requested.ts` — Deepgram async API call + job status update
  - `functions/handle-transcription-webhook.ts` — Webhook parsing, segment/word storage, consolidation
  - `functions/handle-transcription-completed.ts` — Job completion + project duration update
  - `functions/handle-transcription-failed.ts` — Error classification + job/project error status
  - `functions/handle-transcription-timeouts.ts` — Cron-based stale job detection and timeout marking
  - `functions/index.ts` — Barrel re-exports for all 5 handlers

### Fixed

- **Fail-closed job lookup in failure handler**: `handle-transcription-failed.ts` now inspects the Supabase query error when looking up a job by project ID (fallback path when no `jobId` is provided). Previously the error was silently ignored, causing the handler to fall through to a project-only status update and leave the job stuck. Now throws on query error, triggering Inngest retry.

## [2026-03-19] - Transcription State Machine Rollout

### Added

- **State machine core**: Added `frontend/lib/state-machine.ts` as the shared source of truth for valid job statuses, transition validation, terminal-state checks, and derived project status rules.
- **Transition layer**: Added `frontend/lib/supabase/transition.ts` to centralize job status transitions through the `transition_job_status` RPC, including idempotent replay handling, conflict detection, and degraded-path `forceJobError()` support.
- **Database enforcement**: Added a new state-machine migration set under `infra/supabase/migrations/` to normalize legacy status/type values, enforce valid status constraints, derive `projects.status` from transcription jobs via triggers, audit job transitions in `job_events`, reconcile `failed_events`, backfill project status, and allow authoritative late completion recovery.
- **Regression coverage**: Added `frontend/__tests__/stateMachine.test.ts` and `frontend/__tests__/transitionJob.test.ts` plus expanded lifecycle tests for the start route, Deepgram webhook handling, Inngest completion/failure handlers, and timeout transitions.

### Changed

- **Derived project status model**: Transcription lifecycle code now treats `projects.status` as a database-derived value instead of manually mutating it from each application code path.
- **Start route behavior**: `frontend/app/api/projects/[id]/start/route.ts` now relies on job insert triggers to queue a project, handles the one-active-job unique index explicitly, and falls back through `forceJobError()` if the Inngest dispatch fails after job creation.
- **Inngest lifecycle transitions**: `frontend/lib/inngest/functions.ts` now moves jobs through `processing`, `completed`, and `error` via the transition layer, preserves payload metadata during timeout/completion updates, and leaves project status derivation to the database trigger.
- **Webhook failure handling**: `frontend/app/api/webhooks/deepgram/route.ts` now routes job failures through `forceJobError()` and records unresolved webhook failures in `failed_events` when a project can be identified but no active job can be resolved.
- **Status vocabulary cleanup**: Frontend status checks and Supabase types now use the canonical `queued` / `processing` / `completed` / `error` values only, removing legacy `failed` and `complete` handling from active code paths.
- **Operational scripts**: `frontend/scripts/run-consolidation.ts` and `frontend/scripts/test-e2e-transcription.ts` were updated to use the canonical `transcription` job type and state-machine-friendly completion flow.

### Fixed

- **Late success recovery**: Completion handling now supports Deepgram success arriving before the request flow marks a job `processing`, or after a local timeout/error path pessimistically marked the job as failed.
- **Project/job desynchronization risk**: Project state can no longer drift independently from job state across the start route, webhook path, timeout handler, and completion handler.
- **Idempotent replay resilience**: Duplicate lifecycle events now resolve as benign no-ops where possible instead of overwriting terminal states or surfacing false failures.

## [2026-03-15] - Editor Decomposition Refactor

### Added

- **Editor route decomposition plan**: Added `.docs/EDITOR_DECOMPOSITION_PLAN.md` to capture the approved extraction strategy, boundaries, and test targets for the editor refactor.
- **Editor orchestration layer**: Added `EditorScreen` as the client-side composition boundary for editor data loading, playback, transcript sync, search, speaker actions, and title editing.
- **Editor-local modules**: Added route-local `types.ts` and `utils.ts` to hold shared editor types, timing/search constants, formatting helpers, and word-timing utilities.
- **Focused editor hooks**: Added extracted hooks for data loading, playback, transcript sync, search, inline mutations, speaker assignment, keyboard shortcuts, title editing, and user-scroll detection.
- **Focused editor components**: Added extracted editor-local components for the header, transcript list, transcript segment card, mix-mode banner, and sync-to-audio button.
- **Hook-level regression coverage**: Added editor tests for playback fallback behavior, speaker assignment rollback, transcript mutations, transcript search, transcript sync, and shared editor utilities.

### Changed

- **Editor route wrapper**: `frontend/app/editor/[id]/page.tsx` is now a thin wrapper that renders `EditorScreen` instead of containing the full editor implementation inline.
- **Editor architecture**: The previous monolithic editor page was split into route-local hooks and components without changing the editor’s public route or feature set.
- **AudioPlayer test mapping**: Generalized the Jest `AudioPlayer` mapper to support extracted editor imports from multiple relative depths.
- **Speaker rollback flow**: Speaker reassignment rollback now uses the shared `reloadTranscript()` helper from the data hook instead of duplicating transcript reload logic inside the speaker hook.

### Fixed

- **Follow-mode recentering after scrubbing**: Restored the previous active-segment fallback after mini-scrub and player drag end, so transcript follow mode still recenters correctly when playback lands in gaps between transcript segments.
- **Decomposition cleanup**: Removed dead refs and dead cleanup code left behind in the extracted editor data hook.

## [2026-03-09] - Editor Load Performance & Edge Case Coverage

### Added

- **Parallelized data fetching in editor**: Audio source is set immediately while transcript data loads in parallel, improving perceived load time
- **Edge case test coverage**: 5 new tests covering transcript fetch failures, media URL failures, silent secondary data failures, and empty transcript data
- **Optimistic audio loading**: Audio can start buffering before transcript data resolves

### Changed

- **Editor data loading order**: `setAudioSrc` now happens before awaiting transcript resolution
- **Secondary data fetching**: Speakers and project metadata are fire-and-forget after transcript loads, with errors silently ignored
- **Test assertion**: Fixed scrollTo behavior assertion to match `'auto'` implementation

## [2026-03-09] - Scrubbing & Navigation UX Improvements

### Added

- **Scroll to Top Shortcut:** The project title in the header is now a clickable button that instantly scrolls the transcript back to the top.
- **Pause-on-Scrub Behavior:** Audio playback now automatically pauses while scrubbing (via dragging the scrubber or the audio progress bar) and resumes when released, ensuring a smoother user experience.

### Changed

- **Immediate Scrubbing:** Removed the double-click delay on the waveform scrubber, making click-to-seek and drag-to-scrub interactions instantly responsive.
- **Drag Visual Feedback:** Added real-time visual feedback to the scrubber bar while dragging, disabling CSS transitions temporarily to ensure the playhead perfectly tracks the mouse cursor.
- **Simplified Waveform Interaction:** Removed the "double-click to expand" functionality from the bottom mini-waveform to prioritize reliable, instant scrubbing.

## [2026-03-05] - Transcript Virtualization

### Added

- **`react-virtuoso` integration:** Replaced static DOM rendering of transcript segments with a virtualized list for massive performance gains on long transcripts (1hr+).
- **`customScrollParent` usage:** Kept the existing outer scroll container, preserving all existing scroll event listeners (waveform collapse, user scroll detection) without disruption.
- **Smart scrolling for Follow Mode:** Follow-mode now uses `smooth` scroll when playback advances to a nearby segment, but snaps `instant`ly when the user scrubs far away to prevent dizzying scroll animations.

### Changed

- **Sync to Audio button:** Now uses Virtuoso's `scrollToIndex` instead of direct DOM `scrollIntoView`.
- **Find/Replace navigation:** Jumping between search matches now uses `scrollToIndex` for instant navigation.
- **Sync direction detection:** `rangeChanged` callback now detects if the active segment is above or below the viewport, updating the ↑/↓ arrow on the sync button.

### Fixed

- **Scroll Container re-renders:** Wrapped the `scrollParent` ref callback in `useCallback` to prevent React from unnecessarily re-creating the function (and triggering double re-renders of the virtualizer) on every audio playback tick.
- **Stale Sync Direction:** Added a secondary effect to recompute the sync direction arrow when audio advances while the user isn't scrolling (since `rangeChanged` only fires on scroll).
- **Test Environment:** Created a `__mocks__/react-virtuoso.tsx` mock for JSDOM to ensure all 14 editor tests continue to pass without a real DOM renderer.
- **Smart Scroll Detection:** Added robust tracking for `SCROLL_INTENT_KEYS` (Arrows, Page Up/Down, Home, End) to reliably disable follow mode on keyboard scrolling, ignoring events within editable inputs.
- **Programmatic Scroll Tracking:** Differentiated programmatic scrolls (like returning to top) from user scrolls via strict timeouts, preventing the app from accidentally disengaging follow mode.
- **Dependencies:** Updated `baseline-browser-mapping` to resolve Next.js build warnings.

## [2026-02-15] - V2 Design Overhaul (Olivetti)

Complete UI overhaul of the transcription app, implementing the **Olivetti** design system across 8 phases plus extra polish. Also includes legacy code removal and doc updates.

### Added — Spec Lock (Phase 1)

- **Design system specification**: Confirmed Find/Replace modal behavior, placeholder approach for Recent Projects, and comprehensive design token documentation.
- **Architectural decisions**: Sidebar + contextual header layout, Library as landing page, Capture as modal, Tailwind `dark` class migration.
- **Component inventory**: Documented all UI components with phase assignments and implementation notes.
- **Accessibility planning**: Focus management, keyboard shortcuts, ARIA labels, color contrast verification, reduced motion support.

### Added — Design System Foundation (Phase 2)

- **Tailwind token palette:** `paper`, `ink`, `warm-highlight`, `trust-blue`, `ember-red`, `player-blue`, `night-*`, `studio-dark`.
- **Fonts via `next/font`:** Inter, Newsreader, IBM Plex Mono.
- **Paper noise texture**, custom scrollbar, glassmorphism modals (`/45` to `/90` opacity + `backdrop-blur`).
- **Theme migration** from `data-theme` to Tailwind `dark` class with `localStorage` persistence.

### Added — App Shell + Routing (Phase 3)

- **`Sidebar.tsx`**: Collapsible sidebar (`w-16` ↔ `w-64`), navigation, user section, integrated theme toggle.
- **`ContextualHeader.tsx`**: View-aware header with search, Capture, Export, and Find & Replace buttons.
- **`ModalContext.tsx`**: Global modal state context.
- **Layout restructured** to sidebar + contextual header shell.
- **`/` is now Library**; `/upload` redirects to Library and auto-opens Capture modal.

### Added — Library View (Phase 4)

- **`LibraryView.tsx`**: Real project data, duration formatting ("X mins" / "X hr Y mins"), status badges, delete with confirmation dialog.
- **Library requires authentication**; post-login redirect changed to `/` (Library).

### Added — Capture Modal (Phase 5)

- **`CaptureModal.tsx`**: Drag-and-drop upload, file type validation, key-term chips, Language/Diarization "Coming soon" fields.
- **`useCapture.ts` hook**: Upload → create project → set `source_object_key` → start transcription, with automatic rollback on failure.
- **Client-side MIME normalization** for browser alias handling (e.g., `audio/x-m4a` → `audio/mp4`).
- **Granular capture outcomes**: `started` vs `saved_needs_retry` states.

### Added — Editor Alignment (Phase 6)

- **`CollapsibleWaveform.tsx`**: Collapses on scroll >50px, interactive mini-bar scrubber (click-to-seek, drag-to-scrub, keyboard/ARIA).
- **`FloatingPlayerDeck.tsx`**: Glassmorphism floating player deck.
- **Speaker color palette**: trust-blue `#4F638C`, ember-red `#C73E1D`, yellow-600 `#CA8A04`, then brand-complementary.
- **Transcript card layout**: Inline timestamp + speaker name in header row, pencil icon for edit on hover.
- **Header/sidebar alignment**: Both use `h-[56px]` for pixel-perfect divider alignment.

### Added — Modals (Phase 7)

- **`FindReplaceModal.tsx`**: Glassmorphism modal with two-step Enter, debounce dirty state ("Searching..."), highlight persistence on close, cross-modal exclusion.
- **`useFocusTrap.ts`**: Lightweight focus trap hook (Tab/Shift+Tab trapping, focus save/restore).
- **`ExportModal.tsx` restyled**: Format cards (DOCX, VTT active; PDF "COMING SOON"), Olivetti glassmorphism.
- **`⌘F` / `Ctrl+F`** opens Find/Replace; **`⌘E` / `Ctrl+E`** opens Export.
- **Header→editor communication** via `CustomEvent` (`open-find-replace`, `open-export`).

### Added — QA + Cleanup (Phase 8)

- **`prefers-reduced-motion`** accessibility: disables all `transition` and `animation` globally.
- **Supabase migration** `20260211000000_expand_bucket_mime_types.sql`: Browser MIME aliases added to bucket allowlist (M4A upload fix).
- **`/import` fully removed**: Page file deleted + removed from `PROTECTED_ROUTES`.
- **Auth redirect** fixed: `/projects` → `/` (Library).
- **111/111 automated tests passing.**

### Added — Extra UI Tweaks

- **Overlay header**: `ContextualHeader` absolutely positioned (`z-40`) for content-under-header scroll pattern.
- **Interactive waveform scrubbing**: `seekToMs` skipLock parameter for high-frequency manual seeks.
- **Auth page brand mark**: Bar + dot icon above title, font-weight 400, letter-spacing `-0.02em`.
- **Body `antialiased`** for smoother font rendering globally.
- **Transcript text refinement**: `font-sans text-lg` with `ink/90` / `paper/80` opacity.
- **Mix-mode warning** collapses/expands in sync with waveform.
- **Waveform z-index**: `z-50` (collapsed) / `z-30` (expanded) for correct layering.
- **CaptureModal diarization toggle** default changed to ON (ember-red).

### Added — Tests

- **`collapsibleWaveform.test.tsx`**: Component tests for scrubbing and collapse behavior.
- **`exportModal.ui.test.tsx`**: UI interaction tests for Export modal.
- **Updated `editor.test.tsx`**: 12+ new tests (Find/Replace, Export, debounce, two-step Enter, cross-modal exclusion, auto-exit edit mode).

### Added — Documentation

- **UI overhaul documentation suite**: `UIREFACTOR_PLAN.md`, `UIREFACTOR_PHASE_STATUS.md`, `UIREFACTOR_README.md`, `UIREFACTOR_ONBOARDING.md`, `UIREFACTOR_GLOSSARY.md`, `DESIGN_TOKENS.md`.
- **`Olivetti.html`**: Interactive design reference prototype.
- **`CLAUDE.md`**: AI coding guidelines.
- **`segment-split-feature.md`**, **`KEY_TERM_RETRY_GAP_ANALYSIS.md`**.

### Changed

- **`editor/[id]/page.tsx`**: Major rewrite — contextual header integration, floating player, sidebar, waveform, Find/Replace and Export modal wiring.
- **`auth/page.tsx`**: Olivetti-themed with glassmorphism and brand mark.
- **`projects/page.tsx`**: Integrated `LibraryView` component with `Suspense` boundary.
- **`layout.tsx`**: Sidebar-based shell replaces top-nav.
- **`globals.css`**: Design system CSS variables, noise texture, component styles, theme transitions, `prefers-reduced-motion`.
- **`tailwind.config.ts`**: Olivetti token palette, custom utilities.
- **`AudioPlayer.tsx`**: Simplified API surface for deck integration.
- **`middleware.ts`**: Auth routing refinements, `PROTECTED_ROUTES` updated.
- **`PRD.md`**: Updated to reflect current Next.js + Supabase + Inngest stack.
- **`README.md`**: Simplified to modern stack only; legacy references removed.
- **`env.example`**: Cleaned up.
- **`.gitignore`**: Updated patterns.

### Removed

- **Entire `backend/` directory**: FastAPI app, Alembic migrations, models, routers, services, tests (30+ files).
- **Entire `worker/` directory**: Celery worker, Dockerfile, requirements.
- **`infra/docker-compose.yml`**: Replaced by Supabase CLI local stack.
- **Legacy frontend components**: `AuthStatus.tsx`, `ThemeToggle.tsx`, `EditKeyTermsModal.tsx`, `KeyTermsInput.tsx`.
- **Legacy pages**: `/upload`, `/import`, `/health`.
- **Deprecated libs**: `logger.ts`, `dead-letter-queue.ts`, `swr.ts`, `api.ts`.
- **Example files**: Large media binaries (MP4, DOCX, VTT).
- **Misc**: `wavesurfer.js` mock, `tsconfig.tsbuildinfo`, `mammoth.d.ts`, Jest `moduleNameMapper` entry.

### Fixed

- **Editor sync**: Prevent aggressive audio sync on first play and during search.
- **CollapsibleWaveform**: Defensive guards and clamped `audioProgress` to prevent invalid CSS widths.
- **Find/Replace**: Unicode word-boundary support for non-cased scripts.
- **Auth**: Root-route middleware conflict resolved; debug `console.log` removed.
- **Duration**: Sub-second durations labeled "< 1 sec" instead of "< 1 min".
- **Brand red**: Extracted to CSS variable for consistent theming.

## [2026-02-04] - Audio Player Robustness

### Added

- **Session Recovery**: Automatically recovers from expired audio URLs (403 Forbidden) without requiring a page refresh
  - New `useAudioSessionRecovery` hook intercepts playback errors
  - Fetches fresh signed URL from backend preserving playback position
  - Seamlessly updates audio source in `AudioPlayer`
  - Drastically improves user experience during long editing sessions

## [2026-01-30] - Production-Grade Pipeline Improvements

### Added

- **Idempotency Keys**: Prevents duplicate transcription jobs from client-side retries or double-clicks
  - Added `idempotency_key` column to jobs table with unique constraint
  - Start route checks for existing job with matching `x-idempotency-key` header before creating new one
  - Frontend generates unique key: `${projectId}-${timestamp}-${uuid}`
  - Race condition handling: Returns cached job if concurrent requests create duplicate
- **Rate Limiting**: Protects transcription endpoint from abuse
  - In-memory sliding window rate limiter (`lib/rate-limit.ts`)
  - Default limit: 10 transcriptions per hour per user
  - Returns `429 Too Many Requests` with `Retry-After` header when exceeded
  - Configurable via `RATE_LIMIT_MODE` env var (`memory`, `off`)
  - Disabled by default in production, enabled in development
- **Structured Logging**: Request tracing with correlation IDs
  - New `lib/logger.ts` utility with correlation ID support
  - Pretty logs in development, JSON output in production for log aggregation
  - Format: `[component] [correlation-id] message {data}`
  - Child logger support for request context propagation
- **Dead Letter Queue**: Disaster recovery for failed events
  - New `failed_events` table for storing events that exhausted all retries
  - Helper functions in `lib/dead-letter-queue.ts`
  - Indexes for quick lookup of unresolved failures
  - Resolution tracking with `resolved_at`, `resolved_by`, and `resolution_notes`
- **Health Check Endpoint**: Monitoring for webhook infrastructure
  - New `GET /api/webhooks/deepgram/health` endpoint
  - Checks Supabase connectivity with latency measurement
  - Validates environment configuration (Deepgram key, Inngest, callback URL)
  - Returns `healthy`, `degraded`, or `unhealthy` status
  - Optional token-based auth via `WEBHOOK_HEALTHCHECK_SECRET`
  - Hidden in production unless explicitly enabled

### Changed

- **Consolidation Failure Handling**: Transcription completes even if consolidation fails
  - Wrapped consolidation step in try-catch
  - On failure, marks `algoVersion: 'failed'` with error message
  - Stores `consolidation_warning` in job payload for debugging
  - Users can still access raw transcription segments
  - Added `consolidationError` to `transcription/completed` event type
  - Fixed: Merges consolidation warning with existing payload instead of overwriting
- **Timeout Detection**: Improved stale job detection for reliability
  - Now queries three separate categories: processing jobs, processing without start time, and queued jobs
  - Uses ISO timestamp cutoff for more efficient queries
  - Added concurrency limit to timeout handler to prevent concurrent executions
  - Fixed: Loads current payload before updating to preserve existing data
- **Health Endpoint Security**: Protected sensitive monitoring endpoint
  - Requires `x-health-token` header or `?token=` query param when `WEBHOOK_HEALTHCHECK_SECRET` is set
  - Returns 404 in production when secret is not configured
  - Open in development for easier local testing

### Fixed

- **Media Proxy Export**: Removed invalid `getProxySecret` export from Next.js route file

### Testing

- **Rate Limiting**: 10 unit tests covering all scenarios
- **Logger**: 9 unit tests for all log levels and correlation IDs
- **Rate Limit Context**: 5 additional transcription-specific tests
- **Total**: 92 tests passing (71 existing + 21 new)

### Configuration

- `RATE_LIMIT_MODE` - Rate limit mode (`memory` or `off`). Defaults to `off` in production, `memory` in development
- `WEBHOOK_HEALTHCHECK_SECRET` - Optional secret for health endpoint auth

### Documentation

- Created comprehensive walkthrough in `.docs/production_pipeline_improvements.md`

---

## [2026-01-27] - Webhook Robustness & Documentation

### Fixed

- **Large Payload Handling**: Updated client-side job fetching to exclude the potentially large `payload` column (Deepgram JSON). This prevents multi-MB payloads from being sent to browsers during job polling or realtime updates.
- **Error Display**: Implemented dedicated `fetchJobError` function to retrieve error details only when needed (for failed jobs), preserving error visibility without performance penalty.
- **Type Safety**: Introduced `JobSummary` type to enforce payload exclusion in frontend components.

### Documentation

- **Webhook Limitations**: Documented Vercel's 4.5 MB request body limit for the Deepgram webhook. Long recordings (3+ hours) may exceed this limit and require external hosting (e.g., AWS Lambda).
- **Code Comments**: Added detailed warnings in webhook handler and Supabase queries about payload size implications.

---

## [2026-01-23] - Major Stack Refactor Completion

### Added

- **Modern Tech Stack**: Migration to Next.js 14 (App Router), Supabase, and Inngest.
- **Supabase Integration**: Unified Database (Postgres), Authentication, Storage, and Realtime updates.
- **Inngest Background Jobs**: Event-driven architecture for transcription and consolidation pipelines.
- **Deepgram Async Pipeline**: Robust transcription handling with callback webhooks and automatic consolidation.
- **TypeScript Consolidation**: Ported the core consolidation algorithm from Python to TypeScript for a unified stack.
- **Local Dev Experience**: Integrated Supabase CLI and Docker Compose for a one-command local setup with ngrok support.
- **DOCX/VTT Exports**: Native Node.js implementation for transcript exports directly from the frontend.

### Changed

- **Architecture**: Moved from a fragmented FastAPI/Celery/Redis/MinIO stack to a streamlined serverless-ready architecture.
- **Realtime**: Replaced SWR polling with Supabase Realtime subscriptions and 5s polling fallback.
- **Auth**: Switched from token-based headers to cookie-based Supabase Auth (SSR compatible).
- **Legacy Components**: Marked `backend/` and `worker/` as legacy and archived.

### Benefits

- **Simplified Operations**: Reduced infrastructure complexity with managed services.
- **Improved DX**: Single language (TypeScript) across the entire stack.
- **Better Reliability**: Idempotent job handling and robust error classification.
- **Modern UI/UX**: Faster response times with Optimistic UI updates.

---

## [2026-01-12] - Transcript Export Feature

### Added

- **Export button in editor toolbar**: Blue "Export" button positioned on the right side of the search/replace controls
- **Export modal component**: Modal dialog for selecting export format (PDF, DOCX, VTT)
- **PDF export support**: New export format generating print-friendly PDF documents
- **Enhanced DOCX export**: Updated to include "Date of Transcription" and "Duration" metadata
- **Enhanced VTT export**: Updated with proper cue identifiers and speaker voice tags
- **Proper filename generation**: All exports use format `{title}_{FORMAT}_{YYYY-MM-DD}.ext`

### Changed

- **Export data source**: Switched from raw segments to consolidated chunks for all exports
- **DOCX structure**: Now matches PRD requirements with centered title, metadata block, and speaker turns
- **VTT format**: Now includes project-based cue IDs and proper speaker voice tags (`<v Speaker Name>`)
- **Export endpoints**: Updated to pass transcription date and duration metadata

### Technical

- **Backend**: Added `reportlab` dependency for PDF generation
- **Backend**: New `generate_pdf()` function in `services/exports.py`
- **Backend**: Updated `generate_docx()` and `generate_vtt()` with new parameters
- **Backend**: Added `format_duration()` helper for human-readable duration formatting
- **Backend**: New `/projects/{id}/export/pdf` endpoint
- **Frontend**: New `ExportModal.tsx` component with loading/success/error states
- **Frontend**: Export integration in editor with modal state management
- **Tests**: Comprehensive unit tests for all export functions (format_duration, DOCX, VTT, PDF)

### Benefits

- Users can now export transcripts in three formats (PDF, DOCX, VTT)
- All exports include proper metadata (Date of Transcription, Duration when available)
- Filenames are consistent and include dates for easy organization
- PDF format provides print-friendly option for sharing
- Export UI provides clear feedback during processing

---

## [2026-01-12] - Sync to Audio Feature

### Added

- **Floating "Sync to audio" button**: Replaces aggressive auto-follow checkbox with user-controlled sync
- **Directional arrows**: Button shows ↑ or ↓ arrow indicating scroll direction to active segment
- **Auto-follow mode**: After clicking sync, transcript automatically follows audio playback
- **Smart scroll detection**: Distinguishes user scroll (wheel/touch) from programmatic scroll
- **Edit mode awareness**: Button hidden while editing transcript cards
- **Speaker popover awareness**: Button hidden when speaker popover is open

### Changed

- **Removed "Follow playback" checkbox**: Replaced with more intuitive sync button UX
- **Transcript container restructured**: Outer container now has `relative` positioning for proper button placement

### UI/UX

- Button positioned at bottom center of transcript panel (not viewport)
- Purple pill-style button with white text and SVG arrow icons
- Smooth scroll animation when syncing to active segment
- Button appears immediately when user scrolls, regardless of active segment visibility

### Technical

- New state: `isFollowMode`, `isUserScrollingRef` for tracking follow behavior
- Event listeners for `wheel`, `touchstart` plus debounced `scroll` fallback to detect user-initiated scrolling reliably across browsers
- Auto-scroll effect triggered when `activeIds.segId` changes while in follow mode
- Removed unused `isOutOfSync` state (button visibility is controlled by `isFollowMode`)

---

## [2026-01-10] - Speaker Assignment Feature

### Added

- **SpeakerPopover component**: New `frontend/components/SpeakerPopover.tsx` for speaker management
- **Clickable speaker avatars**: Avatars in transcript segments are now interactive buttons
- **Global speaker rename**: Click current speaker → inline edit → Enter to rename across all segments
- **Create & reassign speaker**: Type new name → Tag to create speaker and reassign single segment
- **Reassign to existing speaker**: Click different speaker to move segment to that speaker
- **Untag/reset speaker**: "Reset to generic name" reverts custom names back to "Speaker X" format
- **Search/filter speakers**: Typing in the input filters the suggested speakers list
- **Keyboard support**: Escape closes popover, Enter submits rename/tag

### UI/UX

- Popover positioned below clicked avatar with fixed positioning
- Current speaker highlighted with "Click to rename" hint
- Optimistic UI updates with error rollback
- Hover ring effect on speaker avatar buttons

---

## [2025-01-05] - Project Cleanup

### Removed

- **Redundant files**: `create.json`, `projects.json`, `url.txt`, `pid.txt` (test output files)
- **Root `package-lock.json`**: Empty duplicate (actual lockfile is in `/frontend`)
- **`scripts/` directory**: Windows PowerShell test scripts (unused on macOS)
- **`worker/Dockerfile`**: Obsolete Dockerfile (replaced by `Dockerfile.unified`)

### Notes

- Removed 9 redundant files totaling ~15KB
- No functional changes - only cleanup of unused/obsolete files
- Empty `__init__.py` files preserved (required Python package markers)

## [Unreleased] - 2026-01-05

### Major Architectural Improvements

This release includes significant architectural refactoring to improve code quality, scalability, security, and maintainability.

### Frontend UX Improvements (UAT)

- **Upload:** Prevent repeated submissions by locking the upload action while in-flight, disabling inputs during upload, and redirecting to **Projects** after a successful upload.
- **Projects:** Renamed **Start** to **Transcribe** with clearer button states:
  - `Transcribe` (clickable)
  - `Transcribing...` (disabled while `queued`/`processing`)
  - `Transcribed` (disabled, blue) when `completed`
- **Tests:** Improved editor test `fetch` mocking to be robust to `Request` inputs and missing `method` (defaulting to `GET`).

---

## 🔧 1. Unified Database Access Layer

**Problem:** Worker used raw `psycopg2` SQL queries while backend used SQLAlchemy ORM, creating two sources of truth and risk of schema drift.

**Solution:** Worker now imports and uses the same SQLAlchemy models as the backend.

### Changes

- **New:** `worker/Dockerfile.unified` - Builds worker with backend code included
- **Modified:** `worker/app/worker.py` - Refactored to use SQLAlchemy ORM instead of raw SQL
- **Modified:** `worker/requirements.txt` - Added `SQLAlchemy==2.0.30`
- **Modified:** `infra/docker-compose.yml` - Updated worker build context

### Benefits

- Single source of truth for database schema
- Automatic timestamp handling via ORM
- Migration-safe (Alembic changes apply to both services)
- Proper relationship and cascade support
- Eliminated SQL injection risks

---

## 📊 2. Job Lifecycle Tracking & Observability

**Problem:** Jobs table only populated on errors, no tracking for successful transcriptions, no timing metrics.

**Solution:** Full job lifecycle tracking with status transitions and timing information.

### Changes

- **Modified:** `backend/app/models.py` - Added `celery_task_id`, `started_at`, `finished_at` to Job model
- **Modified:** `backend/app/schemas.py` - Extended `JobRead` with new fields
- **Modified:** `backend/app/routers/projects.py` - Creates Job record when `/start` is called
- **Modified:** `backend/app/services/tasks.py` - Pass `job_id` to worker task
- **Modified:** `worker/app/worker.py` - Track job status: `queued` → `processing` → `completed`/`error`
- **New:** `GET /projects/{id}/jobs` endpoint for querying job history

### Benefits

- Complete audit trail for all transcription attempts
- Timing metrics (`started_at`, `finished_at`) for performance monitoring
- Link between Celery task_id and database Job record
- Detailed error information in `payload` field
- Support for retry tracking (multiple jobs per project)

---

## 🔒 3. Authentication Enforcement

**Problem:** `SINGLE_USER_TOKEN` existed in config but was never enforced on API routes.

**Solution:** Token-based authentication via Bearer token or X-API-Key header.

### Changes

- **New:** `backend/app/core/auth.py` - Authentication dependency with token validation
- **Modified:** `backend/app/routers/projects.py` - Applied `require_auth` to all routes

### Benefits

- All `/projects/*` endpoints now require authentication
- Supports both `Authorization: Bearer <token>` and `X-API-Key: <token>` headers
- `/health` endpoint remains open for load balancer checks
- Returns proper 401 Unauthorized responses

### Usage

```bash
# Bearer token (standard)
curl -H "Authorization: Bearer devtoken" http://localhost:8000/projects

# X-API-Key header (simpler for scripts)
curl -H "X-API-Key: devtoken" http://localhost:8000/projects
```

---

## 🗄️ 4. Database Migrations with Alembic

**Problem:** Using `Base.metadata.create_all()` is fragile and can't handle schema evolution.

**Solution:** Proper migration management with Alembic.

### Changes

- **New:** `backend/alembic.ini` - Alembic configuration
- **New:** `backend/alembic/env.py` - Alembic environment with SQLAlchemy integration
- **New:** `backend/alembic/script.py.mako` - Migration template
- **New:** `backend/alembic/versions/20260105_000000_initial_schema.py` - Initial migration
- **Modified:** `backend/app/main.py` - Added `run_migrations()` function, runs on startup
- **Modified:** `backend/Dockerfile` - Copy alembic files into container

### Benefits

- Schema evolution support (add/remove columns, indexes, constraints)
- Version tracking via `alembic_version` table
- Rollback support for reverting schema changes
- Team collaboration with version-controlled migrations
- Production-safe, reviewable schema changes

### Migration Commands

```bash
# Check current revision
docker compose exec api alembic current

# Generate new migration
docker compose exec api alembic revision --autogenerate -m "Add new column"

# Apply migrations
docker compose exec api alembic upgrade head

# Rollback one migration
docker compose exec api alembic downgrade -1
```

---

## 💾 5. Memory-Efficient Media Handling

**Problem:** Worker downloaded entire media files into RAM before uploading to Deepgram (500MB file = 500MB RAM spike).

**Solution:** Deepgram URL fetch - Deepgram downloads directly from S3.

### Changes

- **Modified:** `worker/app/worker.py` - Added `_presign_get_url()`, `_can_use_url_fetch()` functions
- **Modified:** `worker/app/worker.py` - `transcribe_project()` uses URL fetch when S3 is publicly accessible

### Benefits

- **Zero memory pressure** on worker for large files
- **Faster processing** - eliminates double transfer (S3→Worker→Deepgram becomes S3→Deepgram)
- **Automatic fallback** - uses byte upload for local dev (when S3 is on localhost)
- **Production-ready** - controlled via `S3_PUBLIC_BASE_URL` environment variable

### Behavior

- **Local dev** (`S3_PUBLIC_BASE_URL=http://localhost:9000`): Uses byte upload fallback
- **Production** (`S3_PUBLIC_BASE_URL=https://storage.example.com`): Uses URL fetch

---

## ⚡ 6. Smart Data Fetching with SWR

**Problem:** Frontend used manual `fetch()` + unconditional 5-second polling, no caching, no error handling.

**Solution:** SWR (stale-while-revalidate) for intelligent data fetching.

### Changes

- **Modified:** `frontend/package.json` - Added `swr: 2.2.5`
- **New:** `frontend/lib/swr.ts` - SWR configuration, fetchers, and custom hooks
- **Modified:** `frontend/app/projects/page.tsx` - Refactored to use `useProjects()` hook

### Benefits

- **Smart polling** - Only polls when projects are in `processing`/`queued` state
- **Automatic caching** - Deduplicates requests, reduces network traffic
- **Built-in auth** - All requests include authentication headers
- **Error handling** - Automatic retry with exponential backoff
- **Optimistic updates** - Instant UI feedback for mutations
- **Focus revalidation** - Auto-refresh when user returns to tab

### New Hooks

```typescript
// Projects list with smart polling
const { projects, isLoading, mutate } = useProjects();

// Single project
const { project, isLoading } = useProject(projectId);

// Project jobs
const { jobs, isLoading } = useProjectJobs(projectId);

// Mutations
const { startProject, deleteProject } = useProjectActions();
```

### Code Reduction

- **Before:** 70+ lines with `useEffect`, manual polling, no caching
- **After:** ~35 lines with declarative hooks

---

## Database Schema Changes

### New Columns (Jobs Table)

- `celery_task_id` VARCHAR(64) - Links to Celery async task
- `started_at` TIMESTAMP - When job processing began
- `finished_at` TIMESTAMP - When job completed/failed

### Migration

For existing databases, the schema was updated via manual ALTER statements. For new deployments, Alembic migrations handle this automatically.

---

## Configuration Changes

### New Environment Variables

- `NEXT_PUBLIC_API_TOKEN` - Frontend API authentication token (defaults to `devtoken`)

### Updated Variables

- `S3_PUBLIC_BASE_URL` - Now used to determine URL fetch vs byte upload strategy

---

## Breaking Changes

### API Authentication

All `/projects/*` endpoints now require authentication. Clients must include either:

- `Authorization: Bearer <token>` header, or
- `X-API-Key: <token>` header

### Frontend

The frontend now requires `NEXT_PUBLIC_API_TOKEN` to be set (defaults to `devtoken` for local dev).

---

## Upgrade Guide

### For Existing Deployments

1. **Update database schema:**

   ```bash
   docker compose exec postgres psql -U app -d meeting -c "
   ALTER TABLE jobs ADD COLUMN IF NOT EXISTS celery_task_id VARCHAR(64);
   ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;
   ALTER TABLE jobs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP WITH TIME ZONE;
   CREATE INDEX IF NOT EXISTS ix_jobs_celery_task_id ON jobs(celery_task_id);
   "
   ```

2. **Stamp database with initial migration:**

   ```bash
   docker compose exec api alembic stamp 001_initial
   ```

3. **Rebuild containers:**

   ```bash
   docker compose build
   docker compose up -d
   ```

4. **Set authentication token:**
   Add to `.env`:
   ```
   SINGLE_USER_TOKEN=your-secure-token-here
   NEXT_PUBLIC_API_TOKEN=your-secure-token-here
   ```

### For New Deployments

Simply run:

```bash
docker compose up --build
```

Alembic will automatically create the database schema on first startup.

---

## Technical Debt Addressed

- ✅ Worker bypassing backend domain layer → **Fixed with shared ORM**
- ✅ Missing job lifecycle tracking → **Fixed with full job status tracking**
- ✅ No authentication enforcement → **Fixed with token-based auth**
- ✅ Using `create_all` instead of migrations → **Fixed with Alembic**
- ✅ Downloading full media into RAM → **Fixed with URL fetch**
- ✅ Manual fetch + polling in frontend → **Fixed with SWR**

---

## Contributors

- Architectural review and implementation: January 2026

---

## 🎯 7. Key Term Prompting & Retry [08-01-2026]

**Problem:** Users couldn't provide context-specific terms (names, acronyms) to improve transcription accuracy. Transcription failures due to invalid terms (e.g., too many) were unrecoverable, requiring re-upload.

**Solution:** Implemented key term support during upload, robust error handling for term limits, and a retry flow for correcting terms post-failure.

### Changes

- **Database:** Reused `Watchlist` table with unique constraint on `(project_id, canonical)`
- **API (New endpoints):**
  - `PATCH /projects/{id}/key-terms` - Update terms for existing project
  - `GET /projects/{id}` - Now returns `key_terms`
  - `POST /projects` - Accepts `key_terms` payload
- **Worker:**
  - Uses `keyterm` parameter for Deepgram (replacing legacy `keywords`)
  - Classifies errors (`keyterm_error` vs `transcription_error`)
  - Returns user-friendly error messages (e.g., "Too many key terms")
- **Frontend:**
  - `KeyTermsInput` component with scrollable chips and pasting support (normalizes newlines/tabs)
  - `EditKeyTermsModal` for fixing and retrying failed projects
  - Error banner on projects page with direct "Edit Key Terms" action

### Benefits

- **Higher Accuracy:** Domain-specific terms are correctly transcribed.
- **Recoverability:** Users can fix term-limit errors without re-uploading large files.
- **Better UX:**
  - Immediate visual feedback on term count/length
  - Easy pasting of lists from spreadsheets/docs
  - Clear explanations for failures
