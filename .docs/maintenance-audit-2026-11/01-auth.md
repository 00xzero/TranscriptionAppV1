# Auth & account isolation
**Scope reviewed:** `frontend/proxy.ts`, `app/auth/**`, `components/auth/**`, `lib/auth/**`, `infra/workos/`, `infra/supabase/{client,server,signed-out-probe}.ts`, `AccountChangedScreen.tsx`, `AccountMenu.tsx`, `app/(app)/layout.tsx`, `contracts/auth.ts`, `scripts/authkit-contract/`, `core/limits/rate-limit.ts`, and `app_users`/`current_user_id()` in migration `20261023120000_workos_auth.sql`. About 5.3k production lines (1,012 vendored MicroSlats, 441 dead IsoSheet) and 4.4k test lines. I also read the installed AuthKit 4.5.0 and Next 16.3.1 client code where behaviour depends on them.

**Scorecard:**
| Lens | Score | Why |
|---|---|---|
| Maintainability | 3 | Well commented and tested, with a pure decision module. But AuthProvider is dense, infra imports lib, the code leans on AuthKit and Next internals, IsoSheet is dead, and protected routes are an allow-list. |
| Scalability | 4 | Stateless cookie sessions and an indexed `app_users` lookup. Only the in-memory limiter and the volume of WorkOS refreshes grow badly. |
| Reliability | 3 | Outage handling is careful and contract-tested. But waits have no upper bound, a focused tab stops retrying, and AuthKit can navigate a frozen page away. |
| Performance | 4 | Timers and cookie reads are negligible, and MicroSlats really is lazy. Some API calls block on a WorkOS renewal they don't need. |

**Summary:** The domain is careful and unusually well tested. The "one account per page" machinery is mostly contained: outside `lib/auth`, 9 client feature files and 4 API routes touch it, each with 1–3 lines through `accountBoundFetch`, `pageAccountFetch` or `getAccountChangeError`. Its runtime cost is negligible: about 2 cookie parses per Supabase request, and a 2 s interval while the tab is visible that never re-renders. The weak spots are where our state machine meets AuthKit's: AuthKit's token store keeps running after we freeze a page, and waits on AuthKit have no upper bound. **Biggest risk:** a page frozen because the user signed out in another tab can still be hard-navigated to `/auth` by AuthKit's background refresh. That skips the cover's offers to copy unsaved text or download the recording.

## Findings

### [P1] AuthKit's token refresher keeps running on a frozen (or hidden) page, and the proxy can hard-navigate it away
- Lens: reliability
- Evidence:
  - `frontend/lib/auth/AuthProvider.tsx:165` calls `useAccessToken()` inside `AppAuthProvider`, which sits above `CurrentAccountOnly` (`frontend/app/(app)/layout.tsx:44-47`). It therefore stays mounted after `freeze()` (`AuthProvider.tsx:235-242`).
  - AuthKit keeps its refresh timer and its wake handlers (`frontend/node_modules/@workos-inc/authkit-nextjs/dist/esm/components/useAccessToken.js:73-81`, `tokenStore.js:75-87`).
  - With the session cookie gone, the refresh Server Action gets `x-action-redirect` (`frontend/proxy.ts:138-145`). Next answers that with `completeHardNavigation` (`frontend/node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js:274-279`).
  - Hidden tabs skip the marker check (`AuthProvider.tsx:292-294`).
- Why it matters: `AccountChangedScreen` is meant to "never close" (`frontend/components/AccountChangedScreen.tsx:67-73`). On a signed-out page it is still navigated to `/auth` once AuthKit's token is due (within about 5 min) or on the next focus. A hidden tab can be navigated before it ever freezes. Only a `beforeunload` prompt, which browsers may suppress, then protects unsaved text or a recording held only in memory. There is no test for this path, because AuthKit is fully mocked.
- Recommendation: put the token-getter registration in a child component that is unmounted on freeze. AuthKit then has no listeners left and clears its timer. Also run the marker check while hidden. Add an `authkit-contract`-style test that pins Next's `x-action-redirect` handling.
- Effort: M
- Confidence: medium (I traced it through installed code but did not run it)

### [P2] Held token requests have no timeout, and a focused tab stops retrying after about 31 s
- Lens: reliability
- Evidence:
  - `untilAuthKnown` is released only by a render, a freeze or an unmount (`AuthProvider.tsx:209-228`, `:259-261`), and `await getAccessToken()` (`:267`) has no bound. AuthKit itself notes that its refresh promise can "wedge" for the page's lifetime (`frontend/node_modules/@workos-inc/authkit-nextjs/dist/esm/components/tokenStore.js:31-37`).
  - Timed retries stop after 5 attempts (`AuthProvider.tsx:93-121`, timer only at `:110`); after that, only focus, online or visibilitychange trigger a retry.
  - A request made while `readFailing` throws without starting a new read (`AuthProvider.tsx:266`, `lib/auth/auth-policy.ts:92`). Identity lookups behave the same way (`AuthProvider.tsx:388-391`).
- Why it matters: if a server action stalls, every Supabase request spins forever. If a WorkOS or Supabase blip at load lasts longer than about 31 s, a tab that stays focused shows "Could not confirm you are signed in" (or stays `ready=false`) until the user switches tabs. Feature "Try again" buttons can't recover it.
- Recommendation: time-limit the auth wait and the token fetch (about 10 s → counts as a failed read). On `sign-in-unconfirmed`, have the getter start a throttled `readSession()`/`rerunLookup()`. Keep a slow periodic retry after the timed ones.
- Effort: S
- Confidence: high

### [P2] The sign-in rate limit is per instance and in memory: it protects almost nothing and can block shared IPs
- Lens: scalability
- Evidence: `frontend/app/auth/actions.ts:49-55` (its own comment at `:9-10` admits this); `frontend/core/limits/rate-limit.ts:16-18`, `:70-98`, `:110-114`. It is a fixed window, though the code header and CLAUDE.md both say "sliding". Every action, including code verify and resend, shares one 10/min bucket per IP, and the result is the same `blocked` error Radar produces.
- Why it matters: Vercel scales out and cold-starts instances, so the limit is easy to bypass, and attacks from many IPs are never limited. Meanwhile one office NAT can lock out real users, and the error looks the same as Radar's block.
- Recommendation: delete it. Rely on WorkOS limits and Radar (moved out of log-only mode), plus a Vercel WAF rate-limit rule on `POST /auth*`, which applies across all instances. If an app-level limit is still wanted, use Upstash or Postgres and a separate `rate_limited` error.
- Effort: S
- Confidence: high

### [P2] Every API route renews the session itself when 30–50 s are left, blocking on WorkOS
- Lens: performance
- Evidence:
  - `frontend/infra/supabase/server.ts:29`, `:90-98` (the timer fires at 0 ms once renewal is due), `:101-105` (the first query awaits the renewal), `:123-132`.
  - AuthKit's proxy renews only below 30 s (`frontend/node_modules/@workos-inc/authkit-nextjs/dist/esm/session.js:541-542`).
  - All 7 route client factories pass `refreshSession: true`, including media-url, waveform-url, exports, create and start.
- Why it matters: with 5-minute tokens, about 7% of API calls wait for a WorkOS refresh before their first query, and rotate the refresh token, for routes that finish in milliseconds. It also adds WorkOS traffic that grows with users.
- Recommendation: use the renewing client only in the two delete routes. Everything else uses the plain client.
- Effort: S
- Confidence: high (the ~7% assumes 5-minute tokens)

### [P2] AuthProvider is a 442-line provider mixing four concerns
- Lens: maintainability
- Evidence: `frontend/lib/auth/AuthProvider.tsx:163-421`: 6 `useState`, 9 refs, 8 effects, and a `setState` during render (`:178-185`). The concerns are confirming the session (`:314-341`), looking up the identity with retries (`:343-391`), gating tokens (`:254-286`), and watching for an account change and freezing (`:235-312`).
- Why it matters: every fix above has to be threaded through shared refs and timing in one file. Timing is tested only through a 533-line integration test with AuthKit mocked.
- Recommendation: split it into `useSessionConfirmation`, `useIdentityLookup`, `useAccountWatch`, and an unmountable `TokenGate`, which also fixes the P1. Model the states as a small reducer in `auth-policy.ts`.
- Effort: M
- Confidence: high

### [P2] Protected pages are a hand-kept allow-list that duplicates `app/(app)`
- Lens: maintainability
- Evidence: `frontend/proxy.ts:23`, `:106-108`
- Why it matters: a new page (say `/settings`) is unprotected without any error. A signed-out visitor gets the app shell, AuthProvider resolves to signed out, and Supabase reads go out with only the anon key, so the page shows empty instead of redirecting.
- Recommendation: deny by default. Everything except `/auth*` and `/api/*` is protected; there are no other public pages.
- Effort: S
- Confidence: high

### [P3] The infra layer imports lib, and `infra/workos` does not talk to WorkOS
- Lens: maintainability
- Evidence: `frontend/infra/workos/access-token.ts:10` imports `@/lib/auth/account-boundary`; `frontend/infra/supabase/server.ts:20-21` imports `lib/auth/account-marker.server` and `lib/auth/diagnostics`. `access-token.ts` is a module-level getter registry, not an adapter.
- Why it matters: it turns CLAUDE.md's layering upside down and creates lib/auth ↔ infra import cycles.
- Recommendation: move `AccountChangedError` and its constants to `contracts/auth.ts`, and the registry to `lib/auth/`. Give `server.ts` an `onRenewed` hook that a `lib/auth` wrapper supplies.
- Effort: S
- Confidence: high

### [P3] Dead code: IsoSheet
- Lens: maintainability
- Evidence: `frontend/components/auth/IsoSheet.tsx:25` and `iso-sheet.ts:87` are referenced only by each other and by `frontend/__tests__/auth/isoSheet.test.ts:1`, about 505 lines in all.
- Why it matters: CLAUDE.md prefers deleting deprecated paths. As it stands, this code and its test get type-checked and maintained for nothing.
- Recommendation: delete all three files and the CLAUDE.md mention.
- Effort: S
- Confidence: high

### [P3] Inputs sealed into attempt cookies have no size limit
- Lens: reliability
- Evidence: `frontend/lib/auth/return-path.ts:3-10` has no length cap on `next`, and `frontend/contracts/auth.ts:25` allows 4096-character signals. Both are sealed into the OAuth cookie (`frontend/lib/auth/attempt-cookies.server.ts:36-42`, `:82-89`). The reset `token` is not schema-validated (`frontend/app/auth/actions.ts:152`).
- Why it matters: browsers silently drop a cookie over 4 KB, so Google or Microsoft sign-in fails with the generic `oauth` error. A crafted `?next=` link can cause this for someone else.
- Recommendation: cap `next` at about 1–2 KB, signals at about 512 characters, and the token by schema. Check the sealed length before setting the cookie.
- Effort: S
- Confidence: medium (Radar tokens are probably short correlation ids)

### [P3] A WorkOS session with no `app_users` row lands on a silent, empty app
- Lens: reliability
- Evidence: `frontend/lib/auth/auth-policy.ts:29-30` treats it as signed out, and `frontend/proxy.ts:149-151` sends `/auth` back to `/`.
- Why it matters: after a local `supabase db reset`, or once account deletion exists, the person sees an empty library with no explanation, and sign-out is the only way out.
- Recommendation: when the lookup resolves to null, freeze with `sign-in-again`. Signing in again re-provisions the row through `completeSignIn`.
- Effort: S
- Confidence: medium

## Quick wins
- Delete IsoSheet, `iso-sheet.ts` and `isoSheet.test.ts`.
- Make the proxy deny by default.
- Use the renewing Supabase client only in the delete routes.
- Remove the per-instance sign-in limiter (or replace it with a WAF rule), and fix the "sliding window" wording in the docs.
- Cap `next`, signals and the reset token.

## Zero-in candidates
1. **The browser auth lifecycle against the real AuthKit token store** (no mocks): freezing vs. AuthKit's refresh vs. the proxy's `x-action-redirect`, and recovering from an outage in a focused tab. The fake WorkOS in `scripts/authkit-contract/` can be reused for a jsdom or Playwright harness.
2. **Session renewal inside route handlers** (`infra/supabase/server.ts`): it relies on WorkOS's 30 s refresh-token reuse window. Moving long deletes to Inngest (authorize in the route, then use the admin client scoped to the verified id) would let all in-route renewal be deleted.
3. **What actually protects sign-in from abuse:** WorkOS limits, Radar in enforcing mode, and a WAF rule, in place of the per-instance limiter.

## Test coverage notes
- `frontend/__tests__/auth/` has 21 files and about 3.9k lines. `proxy.test.ts` (388) and `authkitOutageContract.test.ts` cover outages against the real AuthKit, which is excellent. Account switching is also covered by `uploadAccountSwitch`, `realtimeAccountSwitch`, `startRouteIdempotency`, the delete-route tests and `recording/signOutGuard`.
- Gaps:
  - AuthKit is fully mocked (`__mocks__/workos-authkit-nextjs-components`), so the token store's behaviour after a freeze or in a hidden tab is untested.
  - No test for a stalled `refreshAuth`, or for more than 5 failed reads in a focused tab.
  - Nothing pins Next's `x-action-redirect` handling or the `next/dist/...` imports in `app/auth/sign-out/route.ts:18-19`.
  - No test of attempt-cookie size.
  - The rate-limit tests check only a single instance.
  - `isoSheet.test.ts` tests dead code.

## Cross-domain notes
- API routes: every call runs `withAuth()` plus a `current_user_id` RPC before its domain work (`frontend/lib/auth/current-user.server.ts:22-29`).
- Capture: `isAccountChangedError` matches by message substring (`frontend/lib/auth/account-boundary.ts:14-18`, used in `frontend/lib/capture/upload.ts:434,499`).
- Recording: the unload guard covers only in-flight states (`frontend/lib/recording/RecordingSessionContext.tsx:78`). Check whether a finalized recording held only in memory survives the P1 navigation.
- Legal: MicroSlats is vendored under "MIT + Commons Clause" (`frontend/components/auth/MicroSlats.tsx:2`); confirm that licence is acceptable for a commercial SaaS.

## Open questions
- Vercel preview hosts: `appOrigin()` uses the configured redirect URI's origin (`frontend/lib/auth/origin.server.ts:9`). The origin checks in `app/auth/sign-out/route.ts:26` and `app/auth/oauth/[provider]/route.ts:27`, and the absolute finish URLs, may then fail on previews.
- The weak-password `detail` shows WorkOS's own text (`frontend/lib/auth/sign-in.server.ts:123-124`, `frontend/components/auth/SignInForm.tsx:219`), yet CLAUDE.md says those messages are never shown. Can WorkOS's strength reasons echo the email?
- During an outage, does an RSC navigation that gets the 503 HTML (`frontend/proxy.ts:85`) fall back to a hard navigation and lose in-page state?
- How reliably does `beforeunload` prompt on a hidden tab's hard navigation? The answer sets how severe the P1 is in practice.

## What's good
- `frontend/lib/auth/auth-policy.ts` keeps the identity and token decisions as pure, separately tested functions; more logic should move there.
- `frontend/scripts/authkit-contract/outage-probe.mjs` runs the installed AuthKit against a fake WorkOS to pin the outage-vs-signed-out behaviour across upgrades. The same pattern should cover Next's internals.
- Diagnostics are sanitized (`frontend/lib/auth/diagnostics.ts:9-13`): only known codes leave, never SDK messages or emails.
- Attempt cookies are one per attempt, sealed, HttpOnly and scoped to `/auth`, and WorkOS's pending token never reaches the browser. MicroSlats loads only at 1280px and wider, pauses when it isn't visible, and stays within a pixel budget.
