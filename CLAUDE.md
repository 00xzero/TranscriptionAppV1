# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A privacy-focused audio/video transcription web app powered by Deepgram Nova 3. Built with Next.js 14 (App Router), Supabase (auth, DB, storage, realtime), and Inngest (background jobs). Fully serverless, designed for Vercel deployment.

All active code is in `frontend/`.

## Commands

Run from `frontend/`:

```bash
npm run dev          # Dev server at http://localhost:3000
npm run build        # Production build
npm run lint         # ESLint via Next.js
npm test             # Jest tests (all)
npm run test:watch   # Jest watch mode
npm run test:ci      # Jest single-threaded (CI)
npm run inngest      # Inngest dev server (background jobs)
```

Local infrastructure (Supabase, Inngest, ngrok) — run from repo root:

```bash
cd infra && ./start-local.sh   # Start local services
cd infra && ./stop-local.sh    # Stop local services
```
# App test Authentication (login)
Use this to login to the app as a test user:
email address: ui5nvlw97q@mkzaso.com
password: 4qdGNrheWHR25Js

## Architecture

### Supabase Client Pattern

Three separate Supabase client factories — use the correct one for the context:

- `lib/supabase/client.ts` — browser-side (Client Components)
- `lib/supabase/server.ts` — server-side (RSC, API routes, Server Actions)
- `lib/supabase/admin.ts` — service-role client for Inngest functions (bypasses RLS)

### Auth & Middleware

`frontend/middleware.ts` handles auth on every request. Protected routes: `/`, `/projects`, `/editor`.

### Transcription Pipeline

1. **Upload** → `POST /api/projects` creates project + uploads media to Supabase Storage
2. **Start** → `POST /api/projects/[id]/start` sends Inngest event `transcription/requested`, which calls Deepgram's async API with a callback URL
3. **Webhook** → `POST /api/webhooks/deepgram` receives results, triggers Inngest `transcription/webhook`
4. **Processing** → Inngest function stores canonical segments/words and assigns speaker-linked segments directly from the webhook payload
5. **Complete** → Job status updated, project marked `complete`, UI updates via Supabase Realtime

Inngest functions in `lib/inngest/functions.ts`, served via `app/api/inngest/route.ts`.

### Data Model

Key Supabase tables: `projects`, `speakers`, `segments`, `words`, `jobs`, `watchlist`. All protected by RLS. Migrations in `infra/supabase/migrations/`.

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

Tailwind with custom tokens in `tailwind.config.ts`. Colors: `paper`, `ink`, `warm-highlight`, `trust-blue`, `ember-red`, `night-surface`, `night-border`. Dark mode via `class` strategy.

### Testing

Jest + React Testing Library. Tests in `frontend/__tests__/`, mocks in `frontend/__mocks__/`.

## Known Issues

- **TypeScript 6 / typescript-eslint mismatch (issue #54):** The project compiles with TypeScript 6.0.2, but `typescript-eslint@8.57.2` only supports `typescript <6.0.0`. npm resolves this by nesting a separate TS 5.9.3 for the ESLint toolchain. Lint passes but type-aware lint rules run against TS 5.9.3, not 6.0.2. Do not rely on lint alone to validate TS 6-specific features. Update `typescript-eslint` once a TS 6-compatible version ships.

## Key Conventions

- TypeScript strict mode — no `any` without justification
- Path alias: `@/*` maps to `frontend/*` (e.g., `@/lib/supabase/server`)
- Rate limiting via in-memory sliding window (`lib/rate-limit.ts`), controlled by `RATE_LIMIT_MODE` env var
- Idempotency on transcription start via `x-idempotency-key` header
