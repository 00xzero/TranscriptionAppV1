# Clear Boundaries — Code Architecture (V3 Phase 1)

Restructure `frontend/` into `core/`, `contracts/`, and `infra/` layers, then extract business logic from the three fat route handlers into core application services.

---

## Scope

**In:** `contracts/` rename, true-adapter `infra/` moves, core domain logic moves, route handler extractions for the 3 fat routes  
**Out:** `lib/supabase/hooks.ts` + `queries.ts` + `realtime.ts` moves (React/UI-facing — not infra), export route thinning (already thin), state machine changes, data model migration

---

## Current → Target Mapping

### `contracts/` — rename of existing schema layer
| Current | Target |
|---|---|
| `lib/schemas/db.ts` | `contracts/db.ts` |
| `lib/schemas/api.ts` | `contracts/api.ts` |
| `lib/schemas/events.ts` | `contracts/events.ts` |
| `lib/schemas/webhook.ts` | `contracts/webhook.ts` |
| `lib/schemas/editor.ts` | `contracts/editor.ts` |
| `lib/schemas/state-machine.ts` | `contracts/state-machine.ts` |

### `infra/` — true external adapters only
| Current | Target | Note |
|---|---|---|
| `lib/supabase/admin.ts` | `infra/supabase/admin.ts` | |
| `lib/supabase/client.ts` | `infra/supabase/client.ts` | |
| `lib/supabase/server.ts` | `infra/supabase/server.ts` | |
| `lib/supabase/storage.ts` | `infra/supabase/storage.ts` | |
| `lib/deepgram.ts` | `infra/deepgram/index.ts` | |
| `lib/inngest/client.ts` | `infra/inngest/client.ts` | |
| `lib/supabase/hooks.ts` | stays in `lib/supabase/` | React hooks — UI-facing |
| `lib/supabase/queries.ts` | stays in `lib/supabase/` | UI data access — used by components |
| `lib/supabase/realtime.ts` | stays in `lib/supabase/` | React integration |
| `lib/inngest/functions/` | stays in `lib/inngest/functions/` | Inngest pipeline wiring |

### `core/` — domain logic + application services
| Current | Target | Note |
|---|---|---|
| `lib/state-machine.ts` | `core/transcription/machine.ts` | |
| `lib/supabase/transition.ts` | `core/transcription/transition.ts` | app-level job transition logic (not a pure adapter) |
| `lib/consolidation.ts` | `core/transcript/consolidation.ts` | |
| `lib/inngest/consolidation-service.ts` | `core/transcript/consolidation-service.ts` | application service — calls infra |
| `lib/exports.ts` + `lib/exports/` | `core/exports/` | |
| `lib/rate-limit.ts` | `core/limits/rate-limit.ts` | |
| `POST /api/projects` logic | `core/projects/create.ts` | extracted from route |
| `POST /api/projects/[id]/start` logic | `core/transcription/start.ts` | extracted from route |
| `POST /api/webhooks/deepgram` logic | `core/transcription/webhook.ts` | extracted from route |

### `contracts/` — also includes
| Current | Target | Note |
|---|---|---|
| `lib/supabase/types.ts` (DB row re-exports only) | `contracts/db.ts` (merge) | Editor-related types stay separate; delete `types.ts` once consumers updated |

---

## Steps

### Step 1 — `contracts/` (rename from `lib/schemas/`)
- Move all 6 files from `lib/schemas/` → `contracts/`
- From `lib/supabase/types.ts`: move only DB row type re-exports into `contracts/db.ts`; editor-related types stay separate; delete `lib/supabase/types.ts` once its consumers point to `contracts/db.ts`
- Find-replace `@/lib/schemas/` → `@/contracts/` across all affected files; update `lib/supabase/types.ts` consumers

### Step 2 — `infra/` (true adapters only)
- Move `lib/supabase/{admin,client,server,storage}.ts` → `infra/supabase/`
- Move `lib/deepgram.ts` → `infra/deepgram/index.ts`
- Move `lib/inngest/client.ts` → `infra/inngest/client.ts`
- Update imports in all consumers
- **Do not move** `hooks.ts`, `queries.ts`, `realtime.ts` — they stay in `lib/supabase/`

### Step 3 — `core/` (domain logic moves — no logic changes)
- `core/transcription/machine.ts` ← `lib/state-machine.ts`
- `core/transcription/transition.ts` ← `lib/supabase/transition.ts`
- `core/transcript/consolidation.ts` ← `lib/consolidation.ts`
- `core/transcript/consolidation-service.ts` ← `lib/inngest/consolidation-service.ts`
- `core/exports/` ← `lib/exports.ts` + `lib/exports/`
- `core/limits/rate-limit.ts` ← `lib/rate-limit.ts`
- Update all internal imports within moved files

### Step 4 — Thin the 3 fat route handlers (sequenced lowest → highest risk)

**4a. `POST /api/projects` → `core/projects/create.ts`** (101 lines — lowest risk, build confidence)
- Route shell: auth → Zod parse → `createProject({ userId, title, filename, keyTerms })` → return response
- Route creates the authenticated Supabase client (`createClient()`) and passes it in; `core/projects/create.ts` never calls `createClient()` directly

**4b. `POST /api/projects/[id]/start` → `core/transcription/start.ts`** (284 lines)
- Route shell: auth → create Supabase client → extract `idempotencyKey` from `x-idempotency-key` header → `startTranscription({ supabase, projectId, userId, idempotencyKey })` → return response
- `core/transcription/start.ts` receives only typed scalar values + the authenticated client; no `NextRequest`, no header access inside core

**4c. `POST /api/webhooks/deepgram` → `core/transcription/webhook.ts`** (438 lines — highest complexity, do last)
- Route shell: read + verify `dg-token` header → parse + Zod validate body → extract `requestId`/`projectId` → create admin client → `handleDeepgramWebhook({ supabase, requestId, projectId, payload })` → return response
- All `NextRequest` / header access stays in the route shell — core receives only typed inputs + a pre-created client
- `core/transcription/webhook.ts` handles: idempotency/lease, job lookup, payload persistence, Inngest send, receipt finalization, error cleanup

### Step 5 — Regression tests for idempotency paths
Add targeted tests before or alongside Step 4b/4c extractions to lock in behavior before moving code:
- **Start flow**: duplicate `idempotency_key` on active job returns cached → duplicate on errored job returns 409 → `idx_jobs_one_active_per_project` conflict resolves correctly
- **Webhook receipt**: first claim succeeds → duplicate returns 200 no-op → in-flight duplicate returns 503 → stale lease triggers takeover → takeover race loss returns 503

### Step 6 — Verify tsconfig path aliases + clean up `lib/`
- Confirm `@/core/*`, `@/contracts/*`, `@/infra/*` resolve (same `baseUrl: "."` as existing `@/*`)
- Update `__tests__/` import paths
- Delete `lib/schemas/`, `lib/exports/` once imports migrated
- `lib/` retains: `lib/supabase/` (hooks, queries, realtime), `lib/inngest/` (events.ts, functions/), `lib/logger.ts`, `lib/ModalContext.tsx`, `lib/hooks/`

---

## Rules enforced after this change

- `app/api/` routes: boundary validation (user auth OR token/signature check) → Zod parse → call `core/` → return response. No `from()` calls, no business logic.
- `core/` modules: may call `infra/` and `contracts/`. Application services receive typed inputs, never `NextRequest`. Never imports from `app/` or `components/`.
- `contracts/` is read-only — Zod schemas + inferred types only, no logic.
- `infra/` contains only external service wrappers (Supabase client factories, Deepgram API, Inngest client).
- ESLint `import/no-restricted-paths` enforcement is a follow-up (not Phase 1).

---

## Risk notes

- Pre-release MVP — one-shot restructure, no migration window needed
- Steps 1–3 are rename-only; TypeScript catches any missed imports
- Step 4 is sequenced lowest → highest risk; 4c (webhook) has the most complex idempotency paths
- Regression tests in Step 5 are the primary safety net for Step 4 behavior, not TypeScript
- `__tests__/` files (7 test files in the 42 affected) need import path updates
