# App shell, UI primitives, design system, exports & Next config
**Scope reviewed:** `app/layout.tsx`, `app/(app)/layout.tsx`, `app/globals.css` (383), all `error.tsx`/`global-error`/`not-found`, `components/ui/**` (27 files, ~1.4k), Sidebar (501), ContextualHeader (251), EmptyState, ErrorFallback, ExportModal, `lib/hairline` (~61 KB), `lib/hooks`, `core/exports` (473), `lib/exports`, `lib/supabase/export-data.ts`, 4 export routes, `media-proxy`, `next.config.mjs`, `types/`, `core/limits/rate-limit.ts`. About 6k lines. I also ran a throwaway DOCX benchmark in the scratchpad; the repo is untouched.

**Scorecard**
| Lens | Score | Why |
|---|---|---|
| Maintainability | 3 | Primitives exist and are widely used (`Button` in 29 files). But two colour systems run in parallel, Sidebar is copy-pasted markup, and the header hard-codes every route. |
| Scalability | 3 | Exports hold up on long transcripts (measured below). The rate limiter and header route logic will not scale. |
| Reliability | 2 | No error monitoring. Page errors unmount the whole shell. VTT export can emit broken cues. No CSP. |
| Performance | 3 | Context values are memoised and heavy libs are lazy (ogl, Hairline). The shell statically imports the capture stack, fonts are not preloaded, and every Tooltip registers 7 global listeners. |

**Summary:** The shell is thoughtfully built. Providers are memoised, `docx` is server-only, the export route factory is shared, and Hairline and ogl load lazily. The biggest risk is operational blindness plus fragile failure containment. Nothing reports errors (boundaries only `console.error`), and a render error on most pages replaces the whole shell, including the recording provider that CLAUDE.md says must outlive pages. Design-system drift (palette utilities plus `dark:` pairs against semantic roles) is the main long-term maintainability cost.

## Findings

### [P1] No error monitoring anywhere
- Lens: reliability
- Evidence: `frontend/app/error.tsx:8`, `frontend/app/global-error.tsx:7`, `frontend/app/(app)/transcripts/error.tsx:8` and `frontend/app/(app)/editor/[id]/error.tsx:8` only call `console.error`. There is no `instrumentation.ts`, and `package.json` has no Sentry, Vercel analytics or similar. Route handlers also only log to console.
- Why it matters: client render crashes, `ErrorFallback` digests and server 500s (exports, webhooks) are invisible in the wild. The only trace is whatever Vercel log retention keeps.
- Recommendation: add `instrumentation.ts` with `onRequestError`, and a `reportError()` helper called from all four boundaries. Use Sentry or equivalent. Show `digest` and correlate it.
- Effort: S–M. Confidence: high.

### [P1] Most routes have no boundary below the shell, so a page crash unmounts providers
- Lens: reliability
- Evidence: error boundaries exist only at `app/error.tsx`, `transcripts/error.tsx` and `editor/[id]/error.tsx`. `app/(app)/layout.tsx:44-67` has no boundary around `{children}`. Library (`/`), Projects, People and Recording have none, and there is no `loading.tsx` anywhere.
- Why it matters: `app/error.tsx` sits above `(app)/layout.tsx`, so a throw in `/projects` or `/recording/new` unmounts Sidebar, `AuthProvider`, `RecordingSessionProvider` and its unload guard. A recording in progress loses its guard and `RecoveryModal` host. `editor/[id]/page.tsx` also awaits Supabase server-side with no streaming fallback.
- Recommendation: add `app/(app)/error.tsx` so shell and providers survive page crashes. Also wrap `{children}` in a small client error boundary inside the layout. Add `loading.tsx` for `editor/[id]`.
- Effort: S. Confidence: high.

### [P2] Two parallel colour systems; status colours have no tokens
- Lens: maintainability
- Evidence: 452 `ink/paper/night-*` utility uses and 300 `dark:` variants, against 514 semantic-role uses. The primitives themselves break the rule: `frontend/components/ui/dialog.tsx:55,75` (`text-ink … dark:text-paper`), and tabs, toggle, toast and alert-dialog. Worst files: `app/(app)/recording/new/page.tsx` (22), `Sidebar.tsx` (16), `FindReplaceModal.tsx` (16), `RecordingPill.tsx` (11). Status colours use Tailwind defaults (59 uses): `app/(app)/transcripts/page.tsx:235-383`, `components/ui/toaster.tsx:89` (`#fff1f2`, `rgb(127 29 29)`), `Projects/TranscriptRow.tsx:27-33`, `ExportModal.tsx` (emerald). `globals.css` defines no success/warning/danger roles.
- Why it matters: every `text-ink dark:text-paper` pair is a place where a palette change or dark-mode fix has to be made by hand. Error styling already differs across four surfaces.
- Recommendation: codemod `text-ink dark:text-paper` and `/N` variants to `text-foreground[/N]`. Add `--color-success|warning|danger[-soft]` roles in `@theme inline`. Add an ESLint `no-restricted-syntax` rule on `className` for `(text|bg|border)-(ink|paper)` and `dark:`. Fix the primitives first.
- Effort: M. Confidence: high.

### [P2] Light-theme `muted` fails WCAG AA
- Lens: reliability (a11y)
- Evidence: `globals.css` `--muted: #6F6B63` on `--bg #E4E1D9` computes to 4.06:1, and 3.87:1 on the sidebar `#DFDCD4`. There are 119 `text-muted` uses, many at 10–11px (`EmptyState.tsx:113`). Alpha text is worse: `text-ink/30` is 1.85:1 and `ink/50` is 3.05:1. The header search placeholder uses `placeholder:text-ink/30 dark:placeholder:text-paper/20` (`ContextualHeader.tsx:228`).
- Why it matters: most secondary text in the light theme is below 4.5:1.
- Recommendation: darken `--muted` to about `#625E56` (4.9:1 on `--bg`, 4.7:1 on sidebar). Stop using `/20–/40` alpha for text; reserve it for decoration.
- Effort: S. Confidence: high (computed).

### [P2] VTT export can emit invalid cues
- Lens: reliability
- Evidence: `frontend/core/exports/index.ts:189-226`. `generateVtt` escapes only `&` and `<` and writes `segment.text` raw. TXT and MD normalise whitespace through the private `normalizeSegmentText`, but VTT does not. The editor allows Shift+Enter line breaks (`TranscriptSegmentCard.tsx:535`).
- Why it matters: a blank line inside a segment ends the cue early, and a `-->` in text is invalid. Players misparse the rest of the file.
- Recommendation: collapse blank lines, escape `>` or `-->`, and add tests for both.
- Effort: S. Confidence: high.

### [P2] `media-proxy` is "local dev only" by convention, not enforcement
- Lens: reliability (security)
- Evidence: `frontend/app/api/media-proxy/route.ts:32` gates only on `DEEPGRAM_USE_PROXY === "true"`. There is no `NODE_ENV` check. The shared secret travels in the query string and is compared with `!==` (`:57`). `infra/.env.docker.example:43` defaults the flag to `true`. The route buffers the whole object with `arrayBuffer()` (`:100`; uploads reach 500 MB) and advertises `Accept-Ranges` without implementing it (`:110`).
- Why it matters: it is not an open proxy or SSRF. The path regex restricts it to `uuid/uuid/file` in the `media` bucket. But copying the docker env into a deployment exposes a static-secret media reader with the secret in logs.
- Recommendation: return 404 when `NODE_ENV === 'production'`, use `crypto.timingSafeEqual`, and drop the `Accept-Ranges` header (or stream). Alternatively, replace it with Supabase signed URLs through the tunnel and delete the route.
- Effort: S. Confidence: high.

### [P2] Rate limiter is dev-only in practice
- Lens: scalability
- Evidence: `frontend/core/limits/rate-limit.ts:15` uses a per-instance `Map`. `core/transcription/start.ts:57-60` defaults `RATE_LIMIT_MODE` to `off` in production. `API_GENERAL` (`rate-limit.ts:117`) is unused. The exports and media routes have no limit. A module-level mutable store also sits in `core/`, which is meant to be pure.
- Why it matters: on serverless the in-memory counters are per-instance and reset on cold starts. The only paid-API guard (10 jobs/hour) is effectively absent in prod. The sign-in limiter has the same per-instance limit, which is documented.
- Recommendation: either back it with Postgres (an RPC counter) or Upstash, or delete the mechanism and rely on provider quotas. Delete `API_GENERAL`.
- Effort: M. Confidence: high.

### [P2] No CSP
- Lens: reliability (security)
- Evidence: `frontend/next.config.mjs:16-24` sets X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy only. There is no CSP and no HSTS in config, and no test covers headers. Two static inline scripts exist (`app/layout.tsx:26`, `app/(app)/layout.tsx:41`).
- Why it matters: the app handles the microphone and WorkOS tokens in JS. React escaping helps, but there is no defence-in-depth. A nonce CSP would force dynamic rendering and undo the prerendering CLAUDE.md relies on.
- Recommendation: ship a static CSP now: `object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; connect-src 'self' <supabase https/wss>`, with `script-src 'self' 'unsafe-inline'`. Tighten later. Add a header test.
- Effort: S–M. Confidence: medium (HSTS may come from Vercel).

### [P2] Sidebar and header: duplicated markup, buttons as links, dead search
- Lens: maintainability / a11y
- Evidence: `frontend/components/Sidebar.tsx:116-221` is a hand-copied SSR placeholder of the nav (about 105 lines), and the real nav repeats 5 near-identical blocks (`:350-483`). Nav items are `<button onClick={navigateTo}>`, not links, and there is no `aria-current` anywhere in Sidebar. `<nav>` has no `aria-label`, and the expanded sidebar renders an `<h1>` (`:321`) alongside each page's `<h1>`. `ContextualHeader.tsx:23` re-implements `IconButton` (`ui/icon-button.tsx`) and branches on pathname for every route (`:31-95`). The "Recall a decision…" `<input>` (`:224-232`) has no handler or state.
- Why it matters: adding a page means editing three places. Users cannot open nav items in a new tab. The search box looks functional but does nothing.
- Recommendation: drive the nav from a data array (placeholder and real share one renderer, or CSS-only skeleton). Use `GuardedLink` with `aria-current`. Move route titles into per-route header slots. Remove or hide the search input.
- Effort: M. Confidence: high.

### [P2] Shell bundle: capture stack is static; fonts are not preloaded
- Lens: performance
- Evidence: `app/(app)/layout.tsx:6,59` imports `CaptureModal` statically (`components/CaptureModal/*` is ~1.5k lines, plus recording and tus code). Only 3 dynamic imports exist in the app. `ExportModal` and `FindReplaceModal` are static in `EditorScreen.tsx:7-8`. Fonts come from fontsource in `app/layout.tsx:3-8`, not `next/font`. Inter and Newsreader (normal and italic) latin faces are ~48+58+64 KB, plus 3 Plex Mono weights (~15 KB each), with no preload or size-adjusted fallback.
- Why it matters: first load on every page pays for modals most visits never open. Font swap risks layout shift. I did not measure, since no build was allowed.
- Recommendation: `next/dynamic` the capture and export modals (render on first open). Move to `next/font` (self-hosted, preloaded, adjusted fallbacks), trim italic and mono weights. Run `next build` analyzer first.
- Effort: M. Confidence: medium.

### [P3] Per-instance global listeners in Tooltip
- Lens: performance
- Evidence: `frontend/components/ui/tooltip.tsx:58-96` registers 7 window/document listeners per `Tooltip` (including capture-phase `pointermove` and `pointerdown`). There are 35 usage sites, and `TranscriptSegmentCard.tsx` mounts 2–3 per card.
- Why it matters: with a screenful of virtualised cards this is hundreds of listeners, and the effect re-subscribes whenever `onOpenChange` changes identity.
- Recommendation: hoist one shared store or listener set into the provider.
- Effort: S. Confidence: medium.

### [P3] Always-mounted consumers re-render every second while recording
- Lens: performance
- Evidence: `lib/recording/sessionStore.ts:78-87` replaces the snapshot each 1 s tick. `RecordingSessionProvider`, `AccountChangedScreen:82`, `RecordingPill` and `CaptureModal:63` all call `useRecordingSession()` for the whole snapshot.
- Why it matters: this is cheap today (children props are stable). It will grow with the shell.
- Recommendation: add selector hooks (`useRecordingActive()`) via `useSyncExternalStore` with a derived primitive.
- Effort: S. Confidence: medium.

**Export scalability (measured, no finding).** A scratch DOCX build with 1k, 6k and 12k segments took about 0.2 s, 0.6 s and 2.3 s, at about 56, 105 and 126 MB peak RSS delta. That is comfortable for serverless even for a 10-hour transcript. The remaining costs are small: sequential 1000-row pages (`lib/supabase/queries.ts:68,97`), `select('*')`, and a full in-memory buffer. Streaming is not needed. Routes share one factory (`lib/exports/route.ts`); the four route files are 3–5 lines each.

**Quick wins**
- Add `app/(app)/error.tsx` and an in-layout page boundary.
- Darken `--muted` to `#625E56`.
- Guard `media-proxy` on `NODE_ENV` and use a timing-safe compare.
- Normalise blank lines and `-->` in `generateVtt` and add tests.
- Delete the legacy `'blue'` theme shim (`lib/theme.ts:17`), unused `API_GENERAL`, and the dead header search input.

**Zero-in candidates**
1. Design-token consolidation (colour roles, status tokens, `@utility` and `@theme` animations in place of unlayered CSS and `animate-[fadeIn_…]` strings, z-index tokens). It reduces dark-mode bugs everywhere.
2. Failure containment and observability: boundaries, monitoring, `loading.tsx`, CSP and header tests.
3. Shell navigation architecture (data-driven Sidebar, per-route header slots, link semantics).

**Test coverage notes**
- Covered: `exports.test.ts`, `exports/{routes,filename,fetchExportData}.test.ts`, `exportModal.ui.test.tsx`, `sidebar.test.tsx`, `contextualHeader.test.tsx`, `tooltip.test.tsx`, `confirmDialog.test.tsx`, `loadingStatus.test.tsx`, `popoverFrozenWhileClosed.test.tsx`, `rateLimit.test.ts`.
- Gaps: no tests for error boundaries or `ErrorFallback`, `EmptyState`/Hairline, `media-proxy`, `next.config` headers, `(app)/layout.tsx`, or VTT edge cases (blank lines, `-->`). Most `ui/*` primitives (button, dialog, select, tabs, …) have no direct tests. DOCX is asserted only through participants; route tests mock the renderers.

**Cross-domain notes**
- `frontend/core/transcription/start.ts:57` reads `process.env` and a global limiter inside `core/` (layering).
- `frontend/infra/supabase/storage.ts:112-118` builds proxy URLs with the secret in the query string.
- `frontend/package.json` `dev` uses `--webpack` while `next build` defaults to Turbopack in Next 16 (dev/prod bundler mismatch).
- `lib/supabase/export-data.ts` belongs under `lib/exports/` (placement).

**Open questions**
- Does Vercel's edge send HSTS for this project's domain? Confirm in a deployed response.
- `ExportModal` fetches from the DB without waiting for the editor write queue (`EditorScreen.tsx:259`). Can a "Reconnecting…" edit be missing from an export? `holdLeave` could flush first.
- `formatDuration` exists three times with different output (`core/exports`, `components/Projects/format.ts:49`, `lib/utils.ts:formatClockTime`). Are the differences intentional?
- Real client JS size and CLS impact of fonts are unmeasured (needs `next build` and Lighthouse).

**What's good**
- Context values are memoised (`ProjectsProvider`, `AuthProvider`, `TagsProvider`). The toast store is module-level (`toaster.tsx`), so toasts never re-render the tree.
- `createExportHandler` keeps four routes to a few lines each, with RFC 5987 filename handling and markdown/VTT escaping tests.
- Lazy loading of Hairline and ogl, `docx` confined to `server-only` code, and `serverExternalPackages` correctly set for ffmpeg.
- First-paint sidebar width is seeded by an inline script and CSS variables, which avoids layout shift.
