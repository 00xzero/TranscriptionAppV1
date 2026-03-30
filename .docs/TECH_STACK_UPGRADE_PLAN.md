# Tech Stack Upgrade Plan — Current Status

**Date:** 2026-03-30
**Goal:** Bring the frontend dependency stack to current stable versions without losing upgrade history or sending future work to stale file paths.
**Status:** Phases 1-6 are complete. The remaining major upgrade is Inngest 4. A small `@types/node` follow-up is still open if we want full version currency against the original target list.

---

## Ground Rules

1. **One upgrade per branch.** Do not combine the remaining dependency follow-ups in one branch.
2. **Use the current architecture, not the old pre-refactor paths.** The schema layer lives in `frontend/contracts/`, Supabase/Inngest clients live in `frontend/infra/`, and application logic lives in `frontend/core/` plus `frontend/lib/inngest/`.
3. **Use the current test baseline.** The frontend suite is currently **26 suites / 295 tests**.
4. **Treat `npx tsc --noEmit` as required.** TypeScript catches upgrade breakage faster than lint in this repo, especially with the known TS 6 / `typescript-eslint` mismatch.
5. **Interpret `npm run build` carefully in restricted environments.** The current build can fail on `next/font` Google Fonts fetches (`Inter`, `Newsreader`, `IBM Plex Mono`) even when the code is otherwise healthy. Distinguish network/font failures from real upgrade regressions.

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
| `inngest` | 3.49.1 | 4.1.0 | Remaining |
| `typescript` | 6.0.2 | 6.0.2 | Complete |
| `@types/node` | 20.19.37 | 25.5.0 | Remaining follow-up |

---

## Completed Work

### Phase 1 — Patch & Minor Bumps

Completed on `deps/phase-1-patch-bumps`.

Delivered:
- `@supabase/supabase-js` 2.100.1
- `@supabase/ssr` 0.9.0
- `@testing-library/jest-dom` 6.9.1
- `@testing-library/user-event` 14.6.1
- `docx` 9.6.1
- `postcss` 8.5.8

### Phase 2 — Jest 30

Completed on `deps/phase-2-jest-30`.

Delivered:
- `jest` 30.3.0
- `jest-environment-jsdom` 30.3.0
- `@types/jest` 30.0.0

### Phase 3 — React 19

Completed on `deps/phase-3-react-19`.

Delivered:
- `react` 19.2.4
- `react-dom` 19.2.4
- `@types/react` 19.2.14
- `@types/react-dom` 19.2.3
- `@testing-library/react` 16.3.2

### Phase 4 — Next.js 16

Completed on `deps/phase-4-nextjs-16`.

Delivered:
- `next` 16.2.1
- ESLint flat-config migration
- Next 16-compatible auth/cookie handling

### Phase 5 — Tailwind CSS 4

Completed on `tailwind-v4-migration`.

Delivered:
- `tailwindcss` 4.2.2
- `@tailwindcss/postcss` pipeline
- CSS-first theme migration
- Removal of `autoprefixer`

### Phase 6 — Zod 4

Completed on `deps/phase-6-zod-4`.

Delivered:
- `zod` 4.3.6
- Shared UUID primitive in `frontend/contracts/primitives.ts` to preserve the app's existing UUID-shape acceptance under Zod 4
- `z.record()` updates for Zod 4 compatibility
- Safer first-error handling at validation boundaries

### Phase 8 — TypeScript 6

The TypeScript half of the old Phase 8 is already complete.

Delivered:
- `typescript` 6.0.2
- `es2025` baseline

Still open from the old Phase 8:
- `@types/node` is still on `20.19.37`, not `25.5.0`

---

## Remaining Phase — Inngest 4

**Branch:** `deps/phase-7-inngest-4`
**Effort:** ~2-3 hrs
**Risk:** Medium
**Migration guide:** https://www.inngest.com/docs/sdk/migration

### What changes

- `inngest` 3.49.1 -> 4.1.0

### Real file paths to audit

- `frontend/infra/inngest/client.ts`
- `frontend/lib/inngest/events.ts`
- `frontend/lib/inngest/functions/` (all files)
- `frontend/app/api/inngest/route.ts`
- `frontend/__tests__/inngestHandlers.test.ts`

### Expected work

1. Upgrade the package:

```bash
cd frontend
npm install inngest@4.1.0
```

2. Fix the client typing first:
- Revisit `new EventSchemas().fromRecord<TranscriptionEvents>()` in `frontend/infra/inngest/client.ts`
- Confirm the v4 event typing model still matches the current `TranscriptionEvents` definition in `frontend/lib/inngest/events.ts`

3. Fix function definitions next:
- Audit every `inngest.createFunction(...)` call in `frontend/lib/inngest/functions/`
- Re-check `step.run()`, `step.sleep()`, and `step.waitForEvent()` signatures
- Keep existing event names unchanged unless the SDK forces a rename

4. Re-check the Next route integration:
- Verify `serve(...)` usage in `frontend/app/api/inngest/route.ts`
- Confirm GET/POST/PUT exports remain correct under the new SDK

### Validation

Run:

```bash
cd frontend
npx tsc --noEmit
npm test -- --runInBand
npm run build
```

Then do local workflow verification:

1. Run `npm run inngest`
2. Run `cd infra && ./start-local.sh`
3. Trigger a transcription end-to-end
4. Confirm the Inngest dev dashboard shows no handler errors
5. Confirm the Deepgram webhook -> job update -> transcript completion pipeline still finishes

### Done when

- `inngest` is on 4.1.0
- `npx tsc --noEmit` passes
- `npm test -- --runInBand` passes
- `npm run build` is code-clean
- End-to-end transcription succeeds locally

---

## Remaining Follow-up — @types/node 25

**Branch:** `deps/phase-8-node-types-25`
**Effort:** ~30-60 mins
**Risk:** Low-Medium

This is no longer a TypeScript 6 migration. TypeScript 6 is already done. This is now just a Node type-definition refresh if we still want full currency against the original target.

### What changes

- `@types/node` 20.19.37 -> 25.5.0

### Steps

```bash
cd frontend
npm install --save-dev @types/node@25.5.0
npx tsc --noEmit
npm test -- --runInBand
npm run build
```

### What to watch for

- Route-handler and script code that relies on older Node global typings
- Any `Buffer`, `process`, stream, or crypto type changes surfaced by newer Node definitions
- Compatibility with the repo's existing Next 16 / TypeScript 6 setup

### Done when

- `@types/node` is on 25.5.0
- `npx tsc --noEmit` passes
- `npm test -- --runInBand` passes
- `npm run build` is code-clean

---

## Completion Checklist

When the upgrade work is truly complete:

- [x] Phases 1-6 are merged
- [ ] Inngest is upgraded to 4.1.0
- [ ] `@types/node` is upgraded to 25.5.0, or we explicitly decide to keep the current version
- [ ] `npx tsc --noEmit` passes on `main`
- [ ] `npm test -- --runInBand` passes on `main`
- [ ] `npm run build` passes on a machine that can reach Google Fonts or uses a local-font fallback
