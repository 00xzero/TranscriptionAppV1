# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A privacy-focused audio/video transcription web app powered by Deepgram Nova 3. Built with Next.js 14 (App Router), Supabase (auth, DB, storage, realtime), and Inngest (background jobs). Fully serverless, designed for Vercel deployment.

All active code is in `frontend/`.

## Commands

All commands run from the `frontend/` directory:

```bash
npm run dev          # Dev server at http://localhost:3000
npm run build        # Production build
npm run lint         # ESLint via Next.js
npm test             # Jest tests (all)
npm run test:watch   # Jest watch mode
npm run test:ci      # Jest single-threaded (CI)
npm run inngest      # Inngest dev server (background jobs)
```

Run a single test file:

```bash
npx jest __tests__/rate-limit.test.ts
```

Local infrastructure (Supabase, Inngest, ngrok):

```bash
cd infra && ./start-local.sh   # Start local services
cd infra && ./stop-local.sh    # Stop local services
```

## Architecture

### Supabase Client Pattern

Three separate Supabase client factories — use the correct one for the context:

- `lib/supabase/client.ts` — browser-side (Client Components), uses `createBrowserClient`
- `lib/supabase/server.ts` — server-side (RSC, API routes, Server Actions), uses `createServerClient` with cookie store
- `lib/supabase/admin.ts` — service-role client for Inngest functions (bypasses RLS)

All clients use a configurable cookie name (`NEXT_PUBLIC_SUPABASE_COOKIE_NAME`) for Docker local dev compatibility where client and server URLs differ.

### Auth & Middleware

`frontend/middleware.ts` handles auth on every request. Protected routes: `/`, `/projects`, `/editor`. Auth pages redirect to `/` if already logged in. Uses `getUser()` (not `getSession()`) for server-side JWT validation.

### Transcription Pipeline

1. **Upload** → `POST /api/projects` creates project + uploads media to Supabase Storage
2. **Start** → `POST /api/projects/[id]/start` sends Inngest event `transcription/requested`, which calls Deepgram's async API with a callback URL
3. **Webhook** → `POST /api/webhooks/deepgram` receives results, triggers Inngest `transcription/webhook`
4. **Processing** → Inngest function stores segments/words, runs consolidation algorithm to group segments into speaker-labeled chunks
5. **Complete** → Job status updated, project marked `complete`, UI updates via Supabase Realtime

Inngest functions are defined in `lib/inngest/functions.ts` and served via `app/api/inngest/route.ts`.

### Data Model

Key Supabase tables: `projects`, `speakers`, `segments`, `words`, `chunks`, `chunk_words`, `jobs`, `watchlist`. All protected by Row Level Security (user ownership). Migrations live in `infra/supabase/migrations/`.

### Data Fetching

- **Supabase Realtime** subscriptions for live updates (projects list, job status)
- Data fetching hooks in `lib/supabase/hooks.ts`, query helpers in `lib/supabase/queries.ts`

### Editor

The transcript editor (`app/editor/[id]/page.tsx`) features:

- Inline text editing with 500ms debounced auto-save
- Find & Replace with case sensitivity
- Speaker management (reassign, rename, color-code)
- Audio playback via native HTMLAudioElement with transcript sync
- Export to DOCX or VTT (`lib/exports.ts`)
- Session recovery: auto-refreshes expired Supabase Storage signed URLs on 403

### API Routes

| Route                                     | Purpose                                        |
| ----------------------------------------- | ---------------------------------------------- |
| `POST /api/projects`                      | Create project + upload media                  |
| `POST /api/projects/[id]/start`           | Start transcription (idempotency key required) |
| `GET /api/projects/[id]/media-url`        | Get signed media URL                           |
| `GET/POST /api/projects/[id]/export/docx` | Export DOCX                                    |
| `GET/POST /api/projects/[id]/export/vtt`  | Export VTT                                     |
| `POST /api/webhooks/deepgram`             | Deepgram callback                              |
| `GET /api/webhooks/deepgram/health`       | Webhook health check                           |
| `GET /api/media-proxy`                    | Proxy media with auth (local dev only)         |

### Design System

Tailwind with custom theme tokens in `tailwind.config.ts`:

- Colors: `paper`, `ink`, `warm-highlight`, `trust-blue`, `ember-red`, `night-surface`, `night-border`
- Fonts: Inter (sans), Newsreader (serif), IBM Plex Mono (mono)
- Dark mode via `class` strategy

### Testing

Jest + React Testing Library. Tests in `frontend/__tests__/`. Mocks in `frontend/__mocks__/` (AudioPlayer). Test files match `**/__tests__/**/*.test.(ts|tsx)`. Path alias `@/` mapped in `jest.config.js`.

## Key Conventions

- TypeScript strict mode — no `any` without justification
- Path alias: `@/*` maps to `frontend/*` (e.g., `@/lib/supabase/server`)
- Rate limiting via in-memory sliding window (`lib/rate-limit.ts`), controlled by `RATE_LIMIT_MODE` env var
- Idempotency on transcription start via `x-idempotency-key` header
- Modal state managed via React Context (`lib/ModalContext.tsx`)
