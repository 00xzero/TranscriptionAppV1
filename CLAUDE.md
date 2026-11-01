# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A privacy-focused audio/video transcription web app powered by Deepgram Nova 3. Built with Next.js 16 (App Router), React 19, WorkOS AuthKit (sign-in), Supabase (DB, storage, realtime), and Inngest (background jobs). Fully serverless, designed for Vercel deployment.

**Status: in active development. No users, no production traffic — we are building toward MVP.** Prefer the clean fix over the backwards-compatible one: there is no installed base to protect, so migrations can be destructive, schemas can change shape, and deprecated paths should be deleted rather than shimmed.

All active code is in `frontend/`. Node >= 24 required.

## Commands

Run from `frontend/`:

```bash
npm run dev          # Dev server at http://localhost:3000 (webpack, binds 0.0.0.0)
npm run build        # Production build
npm run typecheck    # next typegen && tsc --noEmit
npm run lint         # eslint .
npm test             # Jest tests (all)
npm run test:watch   # Jest watch mode
npm run test:ci      # Jest single-threaded (CI)
npm run inngest      # Inngest dev server (background jobs)
```

Local infrastructure — run from repo root:

```bash
cd infra && ./start-local.sh   # Supabase CLI + Docker Compose (Inngest, frontend)
cd infra && ./stop-local.sh    # Stop local services
```

`start-local.sh` starts Supabase via the Supabase CLI, then brings up `infra/docker-compose.dev.yml` (Inngest `v1.19.2` + the frontend container). See `infra/Docker-setup.md`.

# App test Authentication (login)
Use this to log in to the app as a test user on our own `/auth` page (WorkOS staging environment, password sign-in):
email address: ui5nvlw97q@mkzaso.com
password: 4qdGNrheWHR25Js
WorkOS user id (local seed owner): user_01M5MPPTWA83CYYBRZ4XC9QFW0

## Architecture

The codebase is layered, and the layering is load-bearing — respect it when adding code:

| Layer        | Contains                                                                    | Rule                                          |
| ------------ | --------------------------------------------------------------------------- | --------------------------------------------- |
| `contracts/` | Zod schemas + derived types (`api`, `db`, `events`, `webhook`, `state-machine`, `editor`, `primitives`) | Source of truth for shapes. No logic.         |
| `core/`      | Pure domain logic: transcription state machine, segment builder, exports, rate limiting | No framework or network imports.              |
| `infra/`     | External adapters: Supabase clients, Deepgram, Inngest client, storage       | Only place that talks to third parties.       |
| `lib/`       | App glue: recording engine, capture/upload, Inngest handlers, Supabase queries/hooks/realtime | Wires `core` to `infra` and React.            |
| `app/`       | Next App Router: pages + 16 API routes                                      | Thin — delegate to `core`/`lib`.              |

`contracts/db.ts` is the source of truth for DB row shapes, mirroring `infra/supabase/migrations/`.

### Supabase Client Pattern

Three separate Supabase client factories — use the correct one for the context:

- `infra/supabase/client.ts` — browser-side (Client Components); one shared client signed with the WorkOS access token from `infra/workos/access-token.ts`, which `AuthProvider` fills from AuthKit
- `infra/supabase/server.ts` — server-side (RSC, API routes, Server Actions); signed with the token from AuthKit's `withAuth()`
- `infra/supabase/admin.ts` — service-role client for Inngest functions (bypasses RLS)

Also in `infra/supabase/`: `storage.ts`. With `accessToken` set, `supabase.auth` is unavailable: never call it.

**Browser vs. server writes.** The server client runs as the same `authenticated` role as the browser, so a route only guards what that role cannot do itself. The browser talks to Supabase directly for reads and for single-step writes the database fully guards (RLS, column grants, triggers, or `SECURITY DEFINER` RPCs). Anything that needs a secret, touches Storage and the database together, or starts background work goes through a route. Guarantees belong in the database functions, not the route, because those functions are callable from the browser too. Pipeline state (`jobs`, including `result_object_key` and the `error_*` columns, transcript `status`/`duration_seconds`, waveform fields) is written only by the admin client. Segment and word rows are written by the admin client, except that the editor splits a segment and undoes the split through the guarded `split_segment` / `rejoin_segments` RPCs: they create and remove segment rows and move words between segments, but never change a word's text or timing. The browser's only segment text write is `set_segment_texts_guarded`, guarded by `revision` and the text it replaces.

**Transcript files and deletion.** A transcript owns every object under `{user_id}/{transcript_id}/` in the `media`, `waveforms` and `transcription-results` buckets, linked or not; CHECK constraints keep its keys inside that folder, and `source_object_key` can be linked once but never cleared or replaced by the browser. `delete_transcript` and `finish_project_delete` refuse while a folder still holds a file, so both delete routes sweep the folder inventory (`transcript_delete_inventory`) first and once more after deleting. `transcription-results` has no user policies at all, so the routes remove those files with the admin client, using the user's own inventory. The folder check is point-in-time: an upload that commits after it is removed by its writer's compensation, the post-delete sweep, or `scripts/cleanup-orphaned-media.mjs`, which is a manual backstop that needs Inngest stopped and no uploads running.

### Auth & Proxy

Sign-in is our own page on WorkOS AuthKit: `/auth` (`app/auth/page.tsx`, `components/auth/SignInForm.tsx`) checks the details with WorkOS's API and writes AuthKit's own session cookie (`saveSession`), so everything after sign-in is AuthKit as usual. WorkOS's hosted page is never shown. Supabase accepts WorkOS access tokens as a third-party auth provider (WorkOS's JWT template sets `role: "authenticated"`). Supabase Auth itself has sign-ups off and is never called.

**Two layouts.** `app/layout.tsx` is bare (document, fonts, theme script). The app shell (providers including `AuthProvider`, sidebar, header, capture dialog) is `app/(app)/layout.tsx`, around the app's pages in `app/(app)/`; the sign-in pages (`app/auth/`) load none of it. Sign-in pages share `components/auth/AuthFrame.tsx`: a column and, from 1280px, the Micro Slats card (`components/auth/SlatSheet.tsx`, around a vendored React Bits `MicroSlats` on `ogl`, whose code loads only at that width; the earlier isometric sheet, `IsoSheet.tsx`, is kept beside it, unused). The column is pinned from the top at the height that centres the first step, not centred, so nothing above a message that appears moves; `SignInForm` puts a message a step opens with at the top, an error about a field under that field (marked and focused), and any other answer to a submit under its button.

`frontend/proxy.ts` exports `proxy()` — the Next.js 16 rename of middleware. It runs AuthKit's `authkit()` on matched requests to refresh the session so `withAuth()` works, except `/api/inngest` and paths starting with `/api/webhooks/`, which pass through without AuthKit. Provider callbacks authenticate in their own handlers: Deepgram checks Basic Auth, and Soniox and AssemblyAI check secret headers. The nested Deepgram health endpoint checks its own health token when configured; without one it returns 404 in production and remains accessible in development. Protected routes: `/` (renders `LibraryView`), `/transcripts`, `/editor`, `/recording`, `/projects`, `/people`; signed-out visitors go to `/auth?next=<path>`. A WorkOS outage is never treated as signed out: when a session cookie came in, AuthKit found no user and did not delete the cookie (a refresh that failed for a moment, or signing keys it couldn't fetch, which never reaches `onSessionRefreshError`), the proxy answers 503 instead of sending anyone to sign in: a Server Action (including AuthKit's browser token refresh) gets a plain failure, `/api/*` gets `{ code: 'AUTH_UNAVAILABLE' }`, and a page load gets a small page that reloads itself every 5 s. A session that is really over has its cookie deleted by AuthKit and goes to `/auth` as before; `__tests__/authkitOutageContract.test.ts` runs the installed AuthKit (`scripts/authkit-contract/`) to keep that true across upgrades. Signed-in users hitting `/auth` are redirected to the Library; `/auth/callback`, `/auth/finish`, `/auth/sign-out`, `/auth/oauth/*` and `/auth/reset-password` are excluded from that redirect. `POST /auth/sign-out` (a plain form post from `useAuth().signOut`, so the page simply leaves; same-origin posts only, others get 403) clears the session and answers AuthKit's logout redirect with 303; it lands on `/auth`.

**Ways in.** Email and password (sign in or create an account), Google and Microsoft. The page's Server Actions are `app/auth/actions.ts`; the WorkOS calls and what each WorkOS answer means are `lib/auth/sign-in.server.ts` (WorkOS's own messages are never shown: they include the email). Every successful sign-in takes one path: authenticate, then `completeSignIn` (`lib/auth/complete-sign-in.server.ts`: `app_users` first, retried up to 3 times, and only then the session cookie), then a full page load of `/auth/finish?to=<next>`, which checks the browser kept the cookie (else `/auth?error=session`, never a loop) and goes on. Actions never `redirect()`: they return the finish URL and the page loads it, so the app starts from fresh AuthKit state. A failure after WorkOS said yes (provisioning, saving the session) spends the attempt: the person signs in again (`not_finished`). Google and Microsoft can't use AuthKit's sign-in URL (it always opens the hosted page): `POST /auth/oauth/[provider]` (same-origin forms only) makes the PKCE pair and goes to the provider via WorkOS, and `GET /auth/callback` exchanges the code (`authenticateWithCode`). When WorkOS wants an emailed code first (`email_verification_required`, on sign-up or when OAuth meets an unconfirmed account; or Radar's `radar_email_challenge`) the page shows a code step; resend uses the user id from `getEmailVerification`, never the browser's, and a Radar challenge has no resend (Start again). Password resets: WorkOS emails a link to `/auth/reset-password?token=…` (the Password reset URL in the WorkOS dashboard); the answer to "forgot password" never says whether an account exists. `next` is kept through every step and failure (`safeReturnPath`, `lib/auth/return-path.ts`).

**Attempts in flight** live in their own sealed cookies (`lib/auth/attempt-cookies.server.ts`, iron-session with `WORKOS_COOKIE_PASSWORD`): one per Google/Microsoft attempt, named by its state, and one per code attempt, holding WorkOS's pending token so it never reaches the browser (the page only holds the attempt id). HttpOnly, SameSite=Lax, Secure over https, path `/auth`, 10 minutes, at most 5 of each kind (a sixth replaces the oldest, as AuthKit caps its own). A wrong code, a WorkOS outage or a rate limit keep the attempt; success or a spent/expired one clears it. Nothing restarts on its own.

**Bot protection.** Every form sends Radar's browser signals (`@workos/radar-signals`, waited for at most 1.5 s; a missing token never blocks a sign-in, and WorkOS's challenge or block is always honoured) plus IP and user agent; sign-up passes `radarAuthAttemptId` on. Radar for User Management is a WorkOS preview, switched on by WorkOS support, and starts in log-only mode. The Server Actions are also rate-limited per IP (`RATE_LIMITS.SIGN_IN`), per server instance only.

**Our own user ids.** Rows, storage folders, events and recordings are owned by our own UUID, never by the WorkOS id (`user_01…`). `app_users` maps one WorkOS user to one UUID, and `public.current_user_id()` returns the signed-in person's UUID (NULL when signed out or not provisioned); every policy and function uses it, never `auth.uid()`, which is NULL under WorkOS. `completeSignIn` creates the row on first sign-in (`lib/auth/provision-app-user.server.ts`, concurrency-safe; never links by email), before any session is written. API routes get the person with `getCurrentUser(supabase)` (`lib/auth/current-user.server.ts`, server-only), which resolves the UUID through the same client the route then queries with; browser code outside React uses `getCurrentUserId` (`lib/auth/current-user-id.ts`); components use `useAuth()` (`user`, `userId`, `ready`, `accountChange`, `signOut`). The root layout reads no session, so Next prerenders the pages (reading it there made every navigation wait for a server render). AuthKit learns the user once the page has loaded; until then `AuthProvider`'s token getter holds Supabase requests rather than sending them signed out, and AuthKit fetches the token only once it knows the user. The proxy does not use AuthKit's `eagerAuth`: its token cookie is read before AuthKit knows the user, so an account switch in another tab at that moment would leave the page showing the new user with the old account's token, which AuthKit never replaces. AuthKit's check on load answers "no user" even when it fails, so "no user" counts only once AuthKit's `refreshAuth` (which reports failures) has read the session; until then requests wait, and while that read fails they fail with `SIGN_IN_UNCONFIRMED_MESSAGE` and it is retried, rather than reading as signed out. In development, `window.__signedOutSupabaseRequests` lists any browser Supabase request that went out without a token (`infra/supabase/signed-out-probe.ts`); on app pages it should stay empty. Accounts made before WorkOS are linked by their UUID, by hand.

**One account per page.** The session cookie is shared by every tab, so another tab can sign out or sign in as someone else. A page belongs to the first account it resolves for its whole life and never takes on another: `AuthProvider` stops it for good (`accountChange`: `switched`, `signed-out`, or `sign-in-again` for a session older than the account cookie), after which every token request throws `AccountChangedError`, Realtime is disconnected, playback pauses, and everything inside `CurrentAccountOnly` (the app shell in `app/(app)/layout.tsx`: projects, sidebar, pages, capture) unmounts, so no feature keeps fetching or showing the old account. The recording provider sits above it, since a recording outlives pages. `AccountChangedScreen` then offers the editor's unsaved text (`LeaveGuard.unsavedTexts`, read before the editor unmounts, and still guarded against leaving), a running recording's Stop, and on a device that can't keep recordings (`snapshot.durable` false) the stopped recording as a file (`getFinalizedRecordingFile`). It never closes. Its button follows the account cookie as it is when clicked: someone signed in → reload; `none` → the sign-in page; no cookie → sign out first. So a stale screen can never sign out an account that signed in since. Signing out is blocked while a recording runs in this tab or another (`useRemotePresenceStatus`), so the usual way a recording tab gets frozen can't happen. The signal is the readable `olivetti-account` cookie (`lib/auth/account-marker.ts`): our UUID, or `none`, written in the same response as the session cookie by `completeSignIn` and the sign-out route. It lasts 400 days whatever `WORKOS_COOKIE_MAX_AGE` says, and is renewed only alongside a real session renewal (the proxy, when AuthKit writes a new session cookie, and route handlers' own renewals), so a slow request can never write an old account back over a newer one. The page reads it before and after every token, on focus, `visibilitychange` and `pageshow`, and every 2 s while visible; AuthKit reporting another user, a token issued for someone else, or a route answering `ACCOUNT_CHANGED` stop it too. It is only a signal: who someone is still comes from WorkOS. Features hold no per-account resets of their own. The three read-only API calls the browser makes (media and waveform URLs, exports) go through `pageAccountFetch`, which refuses on a stopped page.

### Transcription Pipeline

Capture fixes its owner at the start of each attempt (`CaptureUploadOptions.userId`). The four mutation endpoints—transcript create, start, transcript delete and project delete—require `x-expected-user-id` to match `getCurrentUser()` after authentication and before domain work. Missing or mismatched expectations return `409` with `code: ACCOUNT_CHANGED_CODE`; project deletion also returns `stage: 'begin'`. The header is an expectation, never authentication. Browser callers of these endpoints use `accountBoundFetch`, which performs the original-owner token preflight, adds the header and stops the page on an account-change code without replaying the write. `createClientForUser()` and `getAccessToken(userId)` refuse tokens once the page's account changes, including during a token fetch; storage transfer receives the original owner explicitly and TUS checks it on every request. A recording's runtime user id is fixed at start/recovery and is never reassigned by auth updates.

Each transcript is made by one **engine** (`transcripts.engine`, chosen with the other transcription options and fixed once the row exists): `deepgram` (Nova-3), `soniox` (v5) or `assemblyai` (Universal-3.5 Pro, EU servers), picked by brand name in the capture dialog's Advanced section and shown in the editor header. AssemblyAI falls back to Universal-2 for Russian; the pipeline records the model it really used in `transcripts.engine_model`, written before the segments, and the header names it (`engineLabel`). The pipeline talks to an engine only through the contract in `core/transcription/engines/types.ts`: `start` a job, and turn its stored result into our words (`resultToWords`). `lib/transcription/engines.server.ts` is the one place that maps an engine name to its code; `core/transcription/engines/capabilities.ts` says what each engine can do (languages, filler words a person can choose to keep or that an engine always keeps, profanity masking per language, longest file) and is safe in the browser. Each engine has its own callback route. Soniox keeps no filler words and masks no profanity, and takes audio up to 5 hours. AssemblyAI always keeps "um/uh" (the switch is locked on), masks profanity in every language but Russian, takes audio up to 10 hours, and for Mixed languages listens for our nine other than Russian (with Russian in the list it would drop every other language). CHECKs on `transcripts` refuse the combinations an engine can't do; media preparation enforces each engine's longest file once it has measured it. Key terms are at most six words each, for every engine (`KeyTermSchema`). Options saved before the engine could be chosen (queued events, recordings waiting in the browser, remembered choices) go through `SavedTranscriptionOptionsSchema` and `resolveTranscriptionOptions`, which give them Deepgram. `__tests__/deepgramPipelineBaseline.test.ts` freezes what Deepgram results become; never update its snapshot to make a change pass.

1. **Upload** → `POST /api/transcripts` creates the transcript row; the browser uploads the media straight to Supabase Storage and links its key (uploads up to 500 MB)
2. **Start** → `POST /api/transcripts/[id]/start` checks a media URL the engine can fetch can be made, creates the job and sends Inngest event `media/prepare-requested`
3. **Prepare** → `handle-media-prepare` probes the upload once and applies `core/media/prepare-policy.ts`: a video's sound is copied out (or repacked), lossless or oversized sound (above 96 kbps and at least 10 MB) is repacked to mono 64 kbps AAC `.m4a`, everything else is kept untouched, including our own recordings (Opus, or AAC that `lib/recording/codecs.ts` asks for at 64 kbps). A video's AAC is copied only when its track bitrate is known to be at most 96 kbps. A prepared file replaces the original at `{user_id}/{transcript_id}/{job_id}.m4a` (the admin client swaps `source_object_key` and deletes the original), so only one file is kept. Preparation never blocks a transcript: if probing or converting fails it goes on with whichever file the row points at (only a job or row that can't be read at all fails the job, since the source check must not be skipped), and a job that has waited over 10 minutes in line (`PREPARE_START_LIMIT_MS`) skips it. Then it sends `transcription/requested` and claims the waveform. Every job and row check runs inside a step (replays must not stop it once the engine has moved the job on), and a write whose answer is lost is settled by reading the row back
4. **Transcribe** → `transcription/requested` signs the row's current key and starts the job with the transcript's engine (Deepgram's async API, with a callback URL), only while the job is still `queued`. The step keeps its id `call-deepgram-async`: renaming a step lets a run caught mid-deploy repeat it
5. **Webhook** → Deepgram's request names its exact job attempt and owner in `extra` (`transcript_id`, `job_id`, `user_id`), and its callback URL carries `deepgram:<DEEPGRAM_WEBHOOK_SECRET>@`, which Deepgram sends back as Basic Auth on every callback (`getCallbackUrl`; its `dg-token` header is not sent on every callback, so it is not checked). `POST /api/webhooks/deepgram` refuses a callback without those credentials, then stores the body exactly as Deepgram sent it, gzipped, in the server-only `transcription-results` bucket at `{user_id}/{transcript_id}/{job_id}.json.gz` (`infra/supabase/transcription-results.server.ts`), and passes it to Inngest as `deepgram/callback` (`stageDeepgramResult`). It holds no receipt, so a request cut off anywhere is simply redone by Deepgram's next retry (10 tries, 30 s apart). It writes only for a job that already carries this request id (503 until then), reads the job again after the upload and removes the file if the transcript went meanwhile, and removes a leftover file when the transcript is gone. `handle-deepgram-callback` then links it as `jobs.result_object_key`, triggers `transcription/webhook` and confirms the receipt, through `recordEngineResult` resumed from the stored file: Inngest retries it, waiting out a held lease, however long Deepgram's own retries lasted. A redelivery overwrites the same file and becomes the same event; a new run is a new job and gets its own. The file stays as the record of what Deepgram returned.
   **Soniox** calls back with only its job id and status, on `POST /api/webhooks/soniox?transcript_id=…&job_id=…` (secret in `Authorization`). The route passes it to `handle-soniox-callback`, which reads our records first (a replayed callback fetches nothing), fetches the result, stores `{ transcription, transcript }` the same way through `recordEngineResult` for that exact job attempt, and only once it is handed off deletes the job at Soniox (otherwise kept 30 days). `recordEngineResult` always acts on one exact job attempt (for both engines), and `persistWebhookFailure` does when given a `jobId`, with their checks repeated in the write; a callback for a failed or other attempt is `stale` and changes nothing of ours. Soniox's copy is deleted only for an orphaned start (its job carries another Soniox request); a failed attempt's copy is kept, retrievable. Running out of retries never deletes Soniox's copy.
   **AssemblyAI** works the same way: its callback brings only `{ transcript_id, status }`, on `POST /api/webhooks/assemblyai?transcript_id=…&job_id=…` (secret in `Authorization`), and `handle-assemblyai-callback` fetches its transcript, stores it exactly as returned, hands it off and only then deletes it at AssemblyAI (it refuses to delete one still running; one it no longer knows answers 400 "not found", which counts as deleted). Both Soniox and AssemblyAI run on one shared handler, `lib/inngest/fetching-engine-callback.ts`; each keeps its own function and step ids, and the storing step reads our records again so a retry resumes from our stored copy rather than fetching. Japanese comes back from AssemblyAI in pieces; word spacing is read from AssemblyAI's own text (`assemblyai-words.ts`).
6. **Processing** → Inngest function downloads that file, has the transcript's engine turn it into words, stores canonical segments/words (`lib/transcription/segments-payload.ts`) and assigns speaker-linked segments
7. **Complete** → `transcription/completed`, transcript marked `completed`, UI updates via Supabase Realtime

Inngest events: `media/prepare-requested`, `transcription/requested`, `transcription/webhook`, `transcription/completed`, `transcription/failed`, `waveform/requested`, `soniox/callback`, `assemblyai/callback`, `deepgram/callback`.

Handlers live in `lib/inngest/functions/` (one file per handler, barrel-exported from `index.ts`), served via `app/api/inngest/route.ts`:

- `handle-media-prepare` — probes and possibly shrinks the upload, then requests transcription and the waveform
- `handle-transcription-requested` / `-webhook` / `-completed` / `-failed`
- `handle-transcription-timeouts` — cron `*/10 * * * *`, reaps stuck jobs
- `handle-waveform-requested` — generates waveform peaks
- `handle-soniox-callback` — fetches, stores and hands off a Soniox result, then deletes it at Soniox
- `handle-assemblyai-callback` — the same for an AssemblyAI result (both built by `lib/inngest/fetching-engine-callback.ts`)
- `handle-deepgram-callback` — hands off a Deepgram result its route stored

Every callback handler reads our records first (`lib/inngest/engine-callback-state.ts`) and share how storing is read, how a held receipt is waited out and what running out of retries does (`lib/inngest/engine-callback.ts`).

The state machine itself is pure and lives in `core/transcription/` (`machine.ts`, `start.ts`, `transition.ts`, `webhook.ts`). Statuses: jobs `queued|processing|completed|error`; transcripts `created|queued|processing|completed|error`; waveforms `pending|processing|ready|error|skipped`.

### Waveform Pipeline

Peaks are computed with ffmpeg/ffprobe (`lib/audio/ffmpeg.ts`, `lib/audio/compute-peaks.ts`) via the `waveform/requested` event, which media preparation sends once the final file is linked, stored in the `waveforms` bucket, and served through `GET /api/transcripts/[id]/waveform-url`. The ffmpeg/ffprobe installer packages are listed in `serverExternalPackages` in `next.config.mjs` — they are native binaries and must not be bundled. `scripts/backfill-waveforms.ts` backfills existing transcripts.

### Recording Subsystem

The largest subsystem — ~40 files under `lib/recording/` implementing durable in-browser recording:

- **Session state machine** — `sessionCore.ts`, `sessionTransitions.ts`, `sessionActions.ts`, `sessionStore.ts`, exposed via `RecordingSessionContext.tsx`
- **Persistence** — `persistence/` — IndexedDB with a write queue, validation, and GC
- **Ownership** — `lock/` — Web Locks API, ensures one recording tab owns the session
- **Presence** — `presence/` — BroadcastChannel cross-tab awareness
- **Recovery** — `recovery.ts`, `sessionRecovery.ts` — resume after crash/reload
- **Guards** — `useBeforeUnloadGuard.ts`, `guardedNavigation.tsx` — block navigation mid-recording; sign-out (`Sidebar`) is blocked while a recording is active in this tab or another
- Plus codec negotiation, mic constraints, size budgeting, and Safari prewarming

Each swappable concern (lock, presence, persistence) ships a real implementation plus `fake`/`noop` variants used by tests. UI lives in `components/RecordingSession/`; the page is `app/(app)/recording/new/page.tsx`.

### Editor

The editor opens only completed transcripts (the page redirects others to `/transcripts`, and `/media-url` refuses them), because media preparation may replace and delete the upload until then. `app/(app)/editor/[id]/` is decomposed: `EditorScreen.tsx` plus focused hooks (`useEditorData`, `useEditorPlayback`, `useTranscriptSync`, `useSpeakerAssignments`, `useTranscriptSearch`, `useTranscriptMutations`, …) and a `scrollSyncMachine` that keeps the transcript scroll position in sync with audio playback. Stored `words` are the fixed record of what the engine heard; each card aligns its (possibly edited) segment text against them with `core/transcript/word-alignment.ts` for click-to-seek and the playing-word highlight. The highlight is exact or off: a segment without stored words gets no highlight, and clicks fall back to an even spread across it. Text written without spaces (Japanese) is matched character by character and rejoined per word; engines mark such words `joinsPrevious`, so segment text keeps no spaces between them. The highlighted card and the playing word both follow a frame-accurate `playbackClock`; the scroll machine (timeupdate-paced, offset, held after seeks) drives scrolling only. Enter (or the scissors button) splits the segment being edited at the caret: `core/transcript/segment-split.ts` picks the cut, and `useSegmentSplit` waits for the database before showing it. The editor has one undo/redo history in page memory (`useEditorHistory`) for typing, replacements, splits, speaker actions and the title, capped at 1,000 steps; Cmd/Ctrl+Z and the header's ↶ ↷ use it, and typing is grouped into steps as Word does (`core/editor/typing-steps.ts`). Every editor write (text saves, speaker actions, splits, titles) runs through one ordered queue (`useEditorWriteQueue`); a split saves pending text first, never on top of it. Writes never outlive the editor; leaving waits for them instead (`useLeaveEditor`). Every in-app navigation goes through `lib/recording/guardedNavigation.tsx`, which hands it to the open editor (`lib/editor/leaveGuard.ts`) while it has unsaved work: it goes once the queue is empty, and offers Stay or Leave without saving if a save fails or stalls. Reloading or closing the tab asks first. Browser Back/Forward can't be held: the editor sends its waiting drafts once as it closes, and says so, with their text to copy, if that fails. Each write names what it expects to replace and recognises its own earlier success, so the editor resends one whose answer was lost until the database answers (`lib/editor/untilAnswered.ts`), showing "Reconnecting…" meanwhile; a resend that finds something else refreshes and clears the history.

### Data Model

Supabase tables: `app_users`, `transcripts`, `speakers`, `segments`, `words`, `jobs`, `job_events`, `failed_events`, `webhook_receipts`, `watchlist`. All protected by RLS. Owner columns reference `app_users(id)`, not `auth.users`. Migrations in `infra/supabase/migrations/`.

`segments.revision` counts shape changes (split, rejoin). Every write to a segment names the revision it was made against, text saves and speaker changes alike, so text typed against an old shape is refused rather than written into the new one, where it would duplicate the moved text, and a speaker change chosen while a segment was whole is refused rather than applied to its first half only.

Historical notes for reading migrations: `projects` was renamed to `transcripts`, and the `chunks`/`chunk_words` consolidation tables were dropped — don't reintroduce either.

Storage buckets: `media`, `waveforms` and `transcription-results` (server-only; each engine's result as it returned it). Job failures are recorded in `jobs.error_message`, `error_type` and `error_detail`; `transition_job_status` refuses fields it does not know.

### API Routes

| Route                                   | Purpose                                        |
| --------------------------------------- | ---------------------------------------------- |
| `POST /api/transcripts`                 | Create transcript row (browser uploads media)  |
| `POST /api/transcripts/[id]/start`      | Start transcription (idempotency key required) |
| `POST /api/transcripts/[id]/delete`     | Delete transcript and its folder's files       |
| `POST /api/projects/[id]/delete`        | Delete project branch and its files            |
| `GET /api/transcripts/[id]/media-url`   | Get signed media URL                           |
| `GET /api/transcripts/[id]/waveform-url`| Get signed waveform URL                        |
| `GET /api/transcripts/[id]/export/docx` | Export DOCX                                    |
| `GET /api/transcripts/[id]/export/vtt`  | Export VTT                                     |
| `GET /api/transcripts/[id]/export/md`   | Export Markdown                                |
| `GET /api/transcripts/[id]/export/txt`  | Export plain text                              |
| `POST /api/webhooks/deepgram`           | Deepgram callback (stored, passed to Inngest)  |
| `POST /api/webhooks/soniox`             | Soniox callback (passed to Inngest)            |
| `POST /api/webhooks/assemblyai`         | AssemblyAI callback (passed to Inngest)        |
| `GET /api/webhooks/deepgram/health`     | Webhook health check                           |
| `GET /api/media-proxy`                  | Proxy media with auth (local dev only)         |
| `/api/inngest`                          | Inngest serve handler                          |

Export shaping is in `core/exports/`.

### Design System

**Tailwind v4** — there is no `tailwind.config.ts`. Tokens are declared in `@theme` blocks in `app/globals.css`. Colors: `paper`, `ink`, `warm-highlight`, `trust-blue`, `ember-red`, `transcribe`, `night-surface`, `night-border`; plus CSS custom properties (`--bg`, `--surface`, `--border`, `--accent`, `--muted`) for the light/dark palettes. Dark mode is a custom variant driven by the `.dark` class: `@custom-variant dark (&:where(.dark, .dark *))`.

Use semantic role utilities (`text-foreground`, `bg-surface`, `border-border`, and similar) when styling a UI responsibility that should follow the active theme. Use palette utilities (`text-ink`, `bg-ember-red`, and similar) only when the exact color identity is an intentional brand, status, highlight, or inverse treatment. Do not add unlayered helper classes that duplicate Tailwind utilities; expose reusable semantic roles through `@theme inline` instead.

UI primitives in `components/ui/` are Radix-based. Icons are `lucide-react`.

Empty states use one component, `components/EmptyState.tsx`: a line drawing, a mono label, a serif line, a sentence and at most one action, in a `full` size (centred under a page title, unboxed) or a `compact` one (beside a section heading: Library, Unfiled). While a page is empty its action lives in the empty state, not the header. The drawing is a Hairline figure from `lib/hairline/` (a vendored MIT kernel plus our own figures, plain JS with an `index.d.ts`), mounted in the browser into a box reserved on the server. Only the drawing answers the pointer: the part under it moves (that key, that card), and off the drawing it rests; the action previews its answer, and it makes one short entrance (skipped under reduced motion); `mountFigure` returns those controls. Its lines are mixed from `--text` into `--bg` in `globals.css`. Keep the pointer answers subtle. Previews and decisions are in `.docs/empty-state-illustrations/`.

### Testing

Jest + React Testing Library, config in `jest.config.js` via `next/jest`. Tests in `frontend/__tests__/` (~80 files), mocks in `frontend/__mocks__/` (AudioPlayer, MediaRecorder, getUserMedia, react-virtuoso, recording-session). `fake-indexeddb` backs the persistence tests.

## Known Issues

- **TypeScript 6 / typescript-eslint mismatch (issue #54):** The project compiles with TypeScript 6.0.2. `eslint-config-next@16.2.1` bundles `typescript-eslint@8.57.2`, which declares `typescript >=4.8.4 <6.0.0`. npm dedupes to the single installed TS 6.0.2 and flags every one of those peer edges `invalid` — type-aware lint rules run against a TypeScript version they don't officially support. Lint passing is therefore not proof that TS 6-specific code is sound; run `npm run typecheck` too. Revisit once a TS 6-compatible `typescript-eslint` ships.
- Three React 19 lint rules (`react-hooks/refs`, `react-hooks/set-state-in-effect`, `react-hooks/immutability`) are downgraded to warnings in `eslint.config.mjs` — pre-existing patterns from the Next 16 upgrade, not regressions. Worth cleaning up.

## Key Conventions

- TypeScript strict mode — no `any` without justification
- Path alias: `@/*` maps to `frontend/*` (e.g., `@/infra/supabase/server`)
- Zod schemas in `contracts/` are the source of truth; derive types with `z.infer` rather than hand-writing parallel interfaces
- Rate limiting via in-memory sliding window (`core/limits/rate-limit.ts`), controlled by `RATE_LIMIT_MODE` env var
- Idempotency on transcription start via `x-idempotency-key` header; uploads dedupe on `upload_intent_id`
- Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) are set globally in `next.config.mjs`
