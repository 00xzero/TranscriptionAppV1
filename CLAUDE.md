# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A privacy-focused audio/video transcription web app powered by Deepgram Nova 3. Built with Next.js 16 (App Router), React 19, Supabase (auth, DB, storage, realtime), and Inngest (background jobs). Fully serverless, designed for Vercel deployment.

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
Use this to login to the app as a test user:
email address: ui5nvlw97q@mkzaso.com
password: 4qdGNrheWHR25Js

## Architecture

The codebase is layered, and the layering is load-bearing — respect it when adding code:

| Layer        | Contains                                                                    | Rule                                          |
| ------------ | --------------------------------------------------------------------------- | --------------------------------------------- |
| `contracts/` | Zod schemas + derived types (`api`, `db`, `events`, `webhook`, `state-machine`, `editor`, `primitives`) | Source of truth for shapes. No logic.         |
| `core/`      | Pure domain logic: transcription state machine, segment builder, exports, rate limiting | No framework or network imports.              |
| `infra/`     | External adapters: Supabase clients, Deepgram, Inngest client, storage       | Only place that talks to third parties.       |
| `lib/`       | App glue: recording engine, capture/upload, Inngest handlers, Supabase queries/hooks/realtime | Wires `core` to `infra` and React.            |
| `app/`       | Next App Router: pages + 12 API routes                                      | Thin — delegate to `core`/`lib`.              |

`contracts/db.ts` is the source of truth for DB row shapes, mirroring `infra/supabase/migrations/`.

### Supabase Client Pattern

Three separate Supabase client factories — use the correct one for the context:

- `infra/supabase/client.ts` — browser-side (Client Components)
- `infra/supabase/server.ts` — server-side (RSC, API routes, Server Actions)
- `infra/supabase/admin.ts` — service-role client for Inngest functions (bypasses RLS)

Also in `infra/supabase/`: `cookie.ts` (auth cookie naming) and `storage.ts`.

### Auth & Proxy

`frontend/proxy.ts` exports `proxy()` — the Next.js 16 rename of middleware. It refreshes Supabase auth tokens on every request. Protected routes: `/transcripts`, `/editor`, `/recording`. `/api/inngest` is exempted. Signed-in users hitting `/auth` are redirected out; `/auth/callback` is excluded from that redirect.

Note `/` renders `LibraryView` and is not in `PROTECTED_ROUTES`.

### Transcription Pipeline

1. **Upload** → `POST /api/transcripts` creates transcript + uploads media to Supabase Storage
2. **Start** → `POST /api/transcripts/[id]/start` sends Inngest event `transcription/requested`, which calls Deepgram's async API with a callback URL
3. **Webhook** → `POST /api/webhooks/deepgram` receives results, triggers Inngest `transcription/webhook`
4. **Processing** → Inngest function stores canonical segments/words and assigns speaker-linked segments directly from the webhook payload
5. **Complete** → `transcription/completed`, transcript marked `completed`, UI updates via Supabase Realtime

Inngest events: `transcription/requested`, `transcription/webhook`, `transcription/completed`, `transcription/failed`, `waveform/requested`.

Handlers live in `lib/inngest/functions/` (one file per handler, barrel-exported from `index.ts`), served via `app/api/inngest/route.ts`:

- `handle-transcription-requested` / `-webhook` / `-completed` / `-failed`
- `handle-transcription-timeouts` — cron `*/10 * * * *`, reaps stuck jobs
- `handle-waveform-requested` — generates waveform peaks

The state machine itself is pure and lives in `core/transcription/` (`machine.ts`, `start.ts`, `transition.ts`, `webhook.ts`). Statuses: jobs `queued|processing|completed|error`; transcripts `created|queued|processing|completed|error`; waveforms `pending|processing|ready|error|skipped`.

### Waveform Pipeline

Peaks are computed with ffmpeg/ffprobe (`lib/audio/ffmpeg.ts`, `lib/audio/compute-peaks.ts`) via the `waveform/requested` event, stored in the `waveforms` bucket, and served through `GET /api/transcripts/[id]/waveform-url`. The ffmpeg/ffprobe installer packages are listed in `serverExternalPackages` in `next.config.mjs` — they are native binaries and must not be bundled. `scripts/backfill-waveforms.ts` backfills existing transcripts.

### Recording Subsystem

The largest subsystem — ~40 files under `lib/recording/` implementing durable in-browser recording:

- **Session state machine** — `sessionCore.ts`, `sessionTransitions.ts`, `sessionActions.ts`, `sessionStore.ts`, exposed via `RecordingSessionContext.tsx`
- **Persistence** — `persistence/` — IndexedDB with a write queue, validation, and GC
- **Ownership** — `lock/` — Web Locks API, ensures one recording tab owns the session
- **Presence** — `presence/` — BroadcastChannel cross-tab awareness
- **Recovery** — `recovery.ts`, `sessionRecovery.ts` — resume after crash/reload
- **Guards** — `useBeforeUnloadGuard.ts`, `guardedNavigation.tsx` — block navigation mid-recording
- Plus codec negotiation, mic constraints, size budgeting, and Safari prewarming

Each swappable concern (lock, presence, persistence) ships a real implementation plus `fake`/`noop` variants used by tests. UI lives in `components/RecordingSession/`; the page is `app/recording/new/page.tsx`.

### Editor

`app/editor/[id]/` is decomposed: `EditorScreen.tsx` plus 11 hooks (`useEditorData`, `useEditorPlayback`, `useTranscriptSync`, `useSpeakerAssignments`, `useTranscriptSearch`, `useTranscriptMutations`, …) and a `scrollSyncMachine` that keeps the transcript scroll position in sync with audio playback.

### Data Model

Supabase tables: `transcripts`, `speakers`, `segments`, `words`, `jobs`, `job_events`, `failed_events`, `webhook_receipts`, `watchlist`. All protected by RLS. Migrations in `infra/supabase/migrations/`.

Historical notes for reading migrations: `projects` was renamed to `transcripts`, and the `chunks`/`chunk_words` consolidation tables were dropped — don't reintroduce either.

Storage buckets: media and `waveforms`.

### API Routes

| Route                                   | Purpose                                        |
| --------------------------------------- | ---------------------------------------------- |
| `POST /api/transcripts`                 | Create transcript + upload media               |
| `POST /api/transcripts/[id]/start`      | Start transcription (idempotency key required) |
| `GET /api/transcripts/[id]/media-url`   | Get signed media URL                           |
| `GET /api/transcripts/[id]/waveform-url`| Get signed waveform URL                        |
| `GET /api/transcripts/[id]/export/docx` | Export DOCX                                    |
| `GET /api/transcripts/[id]/export/vtt`  | Export VTT                                     |
| `GET /api/transcripts/[id]/export/md`   | Export Markdown                                |
| `GET /api/transcripts/[id]/export/txt`  | Export plain text                              |
| `POST /api/webhooks/deepgram`           | Deepgram callback                              |
| `GET /api/webhooks/deepgram/health`     | Webhook health check                           |
| `GET /api/media-proxy`                  | Proxy media with auth (local dev only)         |
| `/api/inngest`                          | Inngest serve handler                          |

Export shaping is in `core/exports/`.

### Design System

**Tailwind v4** — there is no `tailwind.config.ts`. Tokens are declared in `@theme` blocks in `app/globals.css`. Colors: `paper`, `ink`, `warm-highlight`, `trust-blue`, `ember-red`, `transcribe`, `night-surface`, `night-border`; plus CSS custom properties (`--bg`, `--surface`, `--border`, `--accent`, `--muted`) for the light/dark palettes. Dark mode is a custom variant driven by the `.dark` class: `@custom-variant dark (&:where(.dark, .dark *))`.

UI primitives in `components/ui/` are Radix-based. Icons are `lucide-react`.

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
