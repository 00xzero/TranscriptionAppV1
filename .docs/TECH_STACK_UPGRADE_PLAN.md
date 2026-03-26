# Tech Stack Upgrade Plan — Full Dependency Currency

**Date:** 2026-03-26
**Goal:** Bring all dependencies to their latest stable versions.
**Approach:** One phase per major version cluster. Each phase is independently shippable. Never combine two phases in the same branch.

---

## Ground Rules (Read Before Starting Any Phase)

1. **One phase per branch.** Branch off `main`, complete the phase, open a PR, merge before starting the next.
2. **The test suite is your safety net.** `npm run build` + `npm test` must be green before opening a PR. 286 tests — use them.
3. **Do not skip phases.** The order below is load-bearing. Later phases may assume earlier ones are complete.
4. **Read the migration guide before writing code.** Each phase links the official migration docs. Skim them first.
5. **If tests were already failing before you started** — stop. Fix the baseline first or the phase will be impossible to debug.

---

## Current vs Target — Full Picture

| Package | Current | Target | Phase |
|---|---|---|---|
| `@testing-library/jest-dom` | 6.4.8 | **6.9.1** | 1 |
| `@testing-library/user-event` | 14.5.2 | **14.6.1** | 1 |
| `@supabase/supabase-js` | 2.90.1 | **2.100.1** | 1 |
| `@supabase/ssr` | 0.7.0 | **0.9.0** | 1 |
| `docx` | 9.5.1 | **9.6.1** | 1 |
| `postcss` | 8.4.38 | **8.5.8** | 1 |
| `autoprefixer` | 10.4.19 | **10.4.27** | 1 |
| `jest` | 29.7.0 | **30.3.0** | 2 |
| `jest-environment-jsdom` | 29.7.0 | **30.3.0** | 2 |
| `@types/jest` | 29.5.12 | **30.0.0** | 2 |
| `react` | 18.3.1 | **19.2.4** | 3 |
| `react-dom` | 18.3.1 | **19.2.4** | 3 |
| `@types/react` | 18.2.66 | **19.2.14** | 3 |
| `@types/react-dom` | 18.2.22 | **19.2.3** | 3 |
| `@testing-library/react` | 14.3.1 | **16.3.2** | 3 |
| `next` | 14.2.5 | **16.2.1** | 4 |
| `tailwindcss` | 3.4.7 | **4.2.2** | 5 |
| `zod` | 3.25.0 | **4.3.6** | 6 |
| `inngest` | 3.49.1 | **4.1.0** | 7 |
| `typescript` | 5.9.3 | **6.0.2** | 8 |
| `@types/node` | 20.11.30 | **25.5.0** | 8 |

---

## Phase 1 — Patch & Minor Bumps

**Branch:** `deps/phase-1-patch-bumps`
**Effort:** ~30 mins
**Risk:** Very low — all within semver minor/patch, no breaking changes expected.

### What changes
- `@supabase/supabase-js` 2.90.1 → 2.100.0
- `@supabase/ssr` 0.7.0 → 0.9.0
- `@testing-library/jest-dom` 6.4.8 → 6.9.1
- `@testing-library/user-event` 14.5.2 → 14.6.1
- `docx` 9.5.1 → 9.6.1
- `postcss` 8.4.38 → 8.5.8
- `autoprefixer` 10.4.19 → 10.4.27

### Steps

Most packages in this repo are pinned without `^`, so `npm update` will not reach the targets. Edit `package.json` directly then install:

```bash
cd frontend
# Edit package.json: bump the 7 packages listed above to their target versions
npm install
```

Then:
```bash
npm run build
npm test
```

### What to watch for
- `@supabase/ssr` 0.7 → 0.9 is still pre-1.0. Check the [changelog](https://github.com/supabase/ssr/releases) for any deprecated helpers. The three client factories (`frontend/infra/supabase/client.ts`, `server.ts`, `admin.ts`) and `middleware.ts` are the only touch points.

### Done when
- `npm run build` passes
- `npm test` passes (all 286 tests green)
- `package-lock.json` committed alongside `package.json`

---

## Phase 2 — Jest 30

**Branch:** `deps/phase-2-jest-30`
**Effort:** ~1–2 hrs
**Risk:** Low — isolated to test infrastructure, no app code changes.
**Migration guide:** https://jestjs.io/docs/upgrading-to-jest30

### What changes
- `jest` 29.7.0 → 30.3.0
- `jest-environment-jsdom` 29.7.0 → 30.3.0
- `@types/jest` 29.5.12 → 30.0.0

### Steps

```bash
cd frontend
npm install --save-dev jest@30.3.0 jest-environment-jsdom@30.3.0 @types/jest@30.0.0
```

Then:
```bash
npm test
```

### What to watch for
- Jest 30 dropped Node 16 support — not relevant here, but worth knowing.
- **Snapshot format changed** — if you have any `.snap` files, delete them and let Jest regenerate. Run `npm test -- --updateSnapshot`.
- Some matchers had minor behavioral adjustments. Read the migration guide's "Breaking Changes" section — it's short.
- `jest.config.js` / `jest.config.ts` syntax changes are minimal but check if your config uses any deprecated options (e.g., `testRunner`).
- Check `frontend/__tests__/` for any `jest.fn()` or `jest.spyOn()` patterns that relied on old mock reset behavior.

### Done when
- All tests pass with no skips added
- No snapshot files left stale

---

## Phase 3 — React 19 + Testing Library 16

**Branch:** `deps/phase-3-react-19`
**Effort:** ~3–5 hrs
**Risk:** Medium-High — React 19 has real breaking changes in refs, context, and deprecated APIs.
**Migration guides:**
- https://react.dev/blog/2024/04/25/react-19-upgrade-guide
- https://testing-library.com/docs/react-testing-library/migrate-to-v16

### What changes
- `react` 18.3.1 → 19.2.4
- `react-dom` 18.3.1 → 19.2.4
- `@types/react` 18.x → 19.2.14
- `@types/react-dom` 18.x → 19.2.3
- `@testing-library/react` 14.3.1 → 16.3.2

### Steps

```bash
cd frontend
npm install react@19.2.4 react-dom@19.2.4
npm install --save-dev @types/react@19.2.14 @types/react-dom@19.2.3 @testing-library/react@16.3.2
```

### Key breaking changes to address

**1. `forwardRef` is gone — refs are now props**

Before (React 18):
```tsx
const MyComponent = forwardRef<HTMLDivElement, Props>((props, ref) => (
  <div ref={ref} {...props} />
))
```
After (React 19):
```tsx
const MyComponent = ({ ref, ...props }: Props & { ref?: React.Ref<HTMLDivElement> }) => (
  <div ref={ref} {...props} />
)
```
Search the codebase: `grep -r "forwardRef" frontend/` to find all instances.

**2. `ReactDOM.render` is removed** — already using App Router so this likely doesn't apply, but verify.

**3. `act()` import changed** in Testing Library v16 — it's now re-exported from `react` directly. Update any test files that import `act` from `react-dom/test-utils`.

**4. Context consumer syntax** — `<Context.Consumer>` still works but `useContext` is now preferred. Not a hard break but type errors may surface.

**5. Deprecated lifecycle warnings become errors** — `componentWillMount`, `componentWillReceiveProps`, `componentWillUpdate`. Unlikely in this codebase but scan third-party components.

### What to watch for in this codebase
- `AudioPlayer.tsx` uses an imperative ref API — check `forwardRef` usage there
- `useFocusTrap.ts` uses refs — verify behavior unchanged
- Test mock at `frontend/__mocks__/AudioPlayer.tsx` — update if ref prop signature changes
- All test files in `frontend/__tests__/` — check for `act` imports

### Done when
- `npm run build` passes with zero TypeScript errors
- All 286 tests pass
- No `@ts-ignore` or `any` added to paper over type errors

---

## Phase 4 — Next.js 16

**Branch:** `deps/phase-4-nextjs-16`
**Effort:** ~4–6 hrs
**Risk:** High — Next.js 14→16 spans two major versions (14→15→16). Async params/searchParams, caching overhaul, Turbopack default.
**Migration guides:**
- https://nextjs.org/docs/app/building-your-application/upgrading/version-15
- https://nextjs.org/docs/app/building-your-application/upgrading/version-16

> **Prerequisite:** Phase 3 (React 19) must be complete. Next.js 16 requires React 19.

### What changes
- `next` 14.2.5 → 16.2.1

### Steps

```bash
cd frontend
npm install next@16.2.1
```

Next.js ships a codemod for the v15 upgrade. Run it first:
```bash
npx @next/codemod@latest upgrade latest
```

Then fix anything it couldn't automate, then:
```bash
npm run build
npm test
```

### Key breaking changes to address

**1. `params` and `searchParams` are now async Promises**

Every page and route handler that destructures `params` or `searchParams` must be updated.

Before:
```tsx
export default function Page({ params }: { params: { id: string } }) {
  const { id } = params
}
```
After:
```tsx
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
}
```

Run the official codemod — it handles most of this automatically. Then manually verify:
- `app/editor/[id]/page.tsx`
- `app/projects/[id]/` routes
- All `app/api/` route handlers

**2. `fetch` caching defaults flipped**

In Next.js 14, `fetch` was cached by default (`force-cache`). In Next.js 15+, it defaults to `no-store`. Any `fetch` calls that relied on implicit caching now need an explicit `{ cache: 'force-cache' }` option.

Search: `grep -r "fetch(" frontend/app` and audit each call.

**3. Turbopack is now the default dev bundler**

`npm run dev` now uses Turbopack. If you hit build issues in dev that don't appear in `npm run build`, it's likely a Turbopack edge case. Add `--turbopack=false` temporarily to isolate.

**4. Middleware changes**

`frontend/middleware.ts` — verify auth logic still works. Middleware config and matcher syntax had minor changes between v14 and v16. Test protected routes (`/`, `/projects`, `/editor`) manually after upgrade.

**5. `@supabase/ssr` compatibility**

After upgrading Next.js, re-verify the three Supabase client factories work. The `createServerClient` call in `lib/supabase/server.ts` is the most likely touch point.

### Done when
- `npm run build` passes
- `npm test` passes
- Auth flow tested manually: login, protected route redirect, session persistence
- Webhook route (`/api/webhooks/deepgram`) tested end-to-end in local dev

---

## Phase 5 — Tailwind CSS 4

**Branch:** `deps/phase-5-tailwind-4`
**Effort:** ~4–6 hrs
**Risk:** High — Tailwind v4 is a near-complete rewrite. The `tailwind.config.ts` format is gone; configuration moves entirely to CSS.
**Migration guide:** https://tailwindcss.com/docs/upgrade-guide

> **This phase is independent** — it does not depend on Phases 3 or 4 and can be worked on in parallel by a separate person if needed. It only requires Phase 1 to be complete.

### What changes
- `tailwindcss` 3.4.7 → 4.2.2

### Steps

Run the official upgrade tool first — it handles most of the mechanical migration:
```bash
cd frontend
npx @tailwindcss/upgrade@latest
```

This will:
- Rewrite `tailwind.config.ts` content into your CSS file as `@theme` blocks
- Update `postcss.config.js`
- Migrate most class names automatically

Then manually verify the custom design tokens (see below) and run:
```bash
npm run build
npm run dev  # visual inspection
```

### Key breaking changes to address

**1. Config moves to CSS**

The entire `frontend/tailwind.config.ts` must be migrated to CSS custom properties inside your global CSS file using `@theme`:

```css
/* Before (tailwind.config.ts) */
colors: { paper: '#F5F0E8', ink: '#1A1A1A', 'trust-blue': '#2B6CB0' }

/* After (globals.css) */
@theme {
  --color-paper: #F5F0E8;
  --color-ink: #1A1A1A;
  --color-trust-blue: #2B6CB0;
}
```

Your full token set to migrate from `tailwind.config.ts`:
- Colors: `paper`, `ink`, `warm-highlight`, `trust-blue`, `ember-red`, `night-surface`, `night-border`
- Fonts: `serif` (Newsreader), `sans` (Inter), `mono` (IBM Plex Mono)
- Shadows: `shadow-elevation`, `shadow-float`

**2. Utility class renames**

Several class names changed in v4. The upgrade codemod handles the common ones. Check for any that were missed:
- `shadow-sm` → `shadow-xs`
- `ring-offset-*` utilities changed
- Some `text-*` size utilities adjusted

**3. `@tailwind` directives replaced**

```css
/* Before */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* After */
@import "tailwindcss";
```

**4. Dark mode**

Dark mode via `class` strategy is still supported — verify `.dark` class still triggers correctly on `<html>`.

**5. PostCSS config**

Tailwind v4 ships its own PostCSS plugin. The upgrade tool updates `postcss.config.js` automatically, but verify it looks correct after running the codemod.

### What to watch for in this codebase
- Every component using `warm-highlight`, `trust-blue`, `ember-red`, `night-surface`, `night-border` tokens
- `FindReplaceModal.tsx` — uses `warm-highlight` + `outline-ember-red` for search highlights
- `ExportModal.tsx` — glassmorphism styles using `night-surface`
- `CollapsibleWaveform.tsx`, `FloatingPlayerDeck.tsx` — custom shadow tokens

### Done when
- `npm run build` passes
- Visual inspection of key pages: editor, library, modals, dark mode
- All design tokens rendering correctly

---

## Phase 6 — Zod 4

**Branch:** `deps/phase-6-zod-4`
**Effort:** ~2–4 hrs
**Risk:** Medium — Zod v4 has API changes but the impact is isolated to `frontend/lib/schemas/`.
**Migration guide:** https://zod.dev/v4

### What changes
- `zod` 3.25.0 → 4.3.6

### Steps

```bash
cd frontend
npm install zod@4.3.6
```

Then run `npm run build` and address TypeScript errors one by one.

### Key breaking changes to address

**1. Error shape changed**

`ZodError.issues` structure changed in v4. If anything in the codebase inspects `.issues` or `.errors`, update those accessors. Check `lib/supabase/transition.ts` which calls `safeParse` and reads the result.

**2. `.parse` vs `.safeParse` behavior**

The return type of `safeParse` is unchanged (`{ success, data, error }`), but error messages and shapes differ. All `safeParse` callers in the codebase:
- `lib/supabase/transition.ts`
- `app/api/projects/route.ts`
- `app/api/webhooks/deepgram/route.ts`
- `app/editor/[id]/hooks/useEditorData.ts`

**3. Some method names changed**

- `.nullable()` / `.optional()` behavior is slightly stricter
- `z.record()` key type handling changed
- `z.discriminatedUnion()` — verify it still works with your event schemas in `lib/schemas/events.ts`

**4. Schema files to audit** (all in `frontend/lib/schemas/`):
- `db.ts`
- `state-machine.ts`
- `webhook.ts`
- `events.ts`
- `api.ts`
- `editor.ts`

### Done when
- `npm run build` passes with zero TypeScript errors
- `npm test` passes
- No `safeParse` call silently swallowing errors that v4 now surfaces

---

## Phase 7 — Inngest 4

**Branch:** `deps/phase-7-inngest-4`
**Effort:** ~2–3 hrs
**Risk:** Medium — breaking SDK changes but impact is isolated to `lib/inngest/`.
**Migration guide:** https://www.inngest.com/docs/sdk/migration

### What changes
- `inngest` 3.49.1 → 4.1.0

### Steps

```bash
cd frontend
npm install inngest@4.1.0
```

### Key breaking changes to address

**1. Event name typing**

Inngest v4 changes how events are typed. The `EventSchemas` definition in `lib/inngest/client.ts` likely needs updating to match the new SDK generics.

**2. Function definition syntax**

`inngest.createFunction()` signature may have changed. Check `lib/inngest/functions/` for any deprecated options.

**3. `step.run()` / `step.sleep()` / `step.waitForEvent()`**

These are the core primitives — verify their signatures haven't changed in ways that break existing calls.

**Files to touch:**
- `lib/inngest/client.ts`
- `lib/inngest/events.ts`
- `lib/inngest/functions/` (all files)
- `app/api/inngest/route.ts`

### Testing this phase
Inngest logic can't be unit tested easily. After the build passes:
1. Run `npm run inngest` (Inngest dev server)
2. Run `cd infra && ./start-local.sh`
3. Trigger a transcription end-to-end and verify the full pipeline completes

### Done when
- `npm run build` passes
- End-to-end transcription pipeline completes in local dev
- Inngest dev server dashboard shows no function errors

---

## Phase 8 — TypeScript 6 + @types/node

**Branch:** `deps/phase-8-typescript-6`
**Effort:** ~2–4 hrs
**Risk:** Medium — TypeScript 6 tightens type checking. Expect new errors in code that previously compiled.
**Migration guide:** https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html

> **Do this last.** TypeScript 6 is the newest release in this list. Waiting ensures the ecosystem (type definitions, Next.js, etc.) has had time to fully support it.

### What changes
- `typescript` 5.9.3 → 6.0.2
- `@types/node` 20.11.30 → 25.5.0

### Steps

```bash
cd frontend
npm install --save-dev typescript@6.0.2 @types/node@25.5.0
```

Then:
```bash
npm run build
```

Fix TypeScript errors top-to-bottom. Do not use `// @ts-ignore` or `any` as a workaround — fix the underlying type issue.

### Key breaking changes to address

**1. Stricter function parameter checking**

TypeScript 6 enforces stricter checking on callback parameter types. Patterns that previously compiled silently may now error.

**2. `@types/node` 20 → 25**

Node.js globals and module types will be updated. This is mostly additive but some deprecated Node APIs may have been removed from types.

**3. `tsconfig.json` options**

Some compiler options deprecated in TS 5.x may be removed in TS 6. Check `frontend/tsconfig.json` against the TS 6 changelog.

### Done when
- `npm run build` passes with zero TypeScript errors — no suppressions added
- `npm test` passes
- Strict mode remains on (do not downgrade `"strict": true`)

---

## Completion Checklist

Once all 8 phases are merged:

- [ ] `npm run build` passes on `main`
- [ ] All 286 tests pass on `main`
- [ ] Full end-to-end transcription works in local dev
- [ ] Auth flow works (login, protected routes, session)
- [ ] Visual QA: editor, library, modals, dark mode
- [ ] Deploy to staging and smoke test
- [ ] `package.json` versions match the target table above
