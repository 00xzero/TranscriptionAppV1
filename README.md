# Lightweight Transcription Web App

A privacy-friendly transcription app built on Next.js, Supabase, Inngest, and Deepgram. It supports upload, async transcription, speaker diarization, inline transcript editing, watchlist corrections, and exports (DOCX, VTT).

## Current Stack

- Frontend + API routes: Next.js 14 (App Router), TypeScript, Tailwind
- Data/Auth/Storage: Supabase (Postgres, Auth, Storage)
- Background jobs: Inngest
- Speech-to-text: Deepgram Nova 3
- Local infrastructure: Supabase CLI + Docker Compose

## Repository Layout

- `frontend/`: Next.js app, API routes, Inngest functions, Jest tests
  - `contracts/`: Zod schemas — single source of truth for all runtime-validated types
  - `core/`: Domain logic and application services (transcription, transcripts, exports, rate limiting)
  - `infra/`: External service adapters (Supabase client factories, Deepgram, Inngest)
  - `lib/`: Cross-cutting utilities (Inngest function handlers, Supabase hooks/queries, ModalContext)
  - `components/`: React UI components
  - `app/`: Next.js App Router pages and API routes
- `infra/`: local stack scripts (`start-local.sh`, `stop-local.sh`), Supabase config, Docker Compose
- `.docs/`: architecture and refactor docs
- Legacy backend/worker components were removed from the repo during the overhaul and are not part of the active workflow

## Prerequisites

- Node.js 18+
- npm
- Docker Desktop
- Supabase CLI
- ngrok (required only for Deepgram webhook callbacks in local Docker)

## Local Development (Recommended)

Use the modern local stack (Supabase + Docker Compose):

```bash
cd infra
./start-local.sh
```

What `start-local.sh` does:
- Starts Supabase (`infra/supabase`)
- Creates `infra/.env.docker` from `infra/.env.docker.example` if missing
- Injects local Supabase keys into `infra/.env.docker`
- Starts Inngest + frontend containers
- Starts ngrok and prints the tunnel URL

### Offline startup

Before travelling, prepare the cached images and frontend dependencies while connected:

```bash
cd infra
./start-local.sh --prepare-offline
```

After preparation, the stack can be stopped normally. Start it later without connectivity using:

```bash
cd infra
./start-local.sh --offline
```

Offline mode starts the frontend, Inngest, and local Supabase services without
building images, pulling images, or refreshing npm dependencies. It skips ngrok,
the unused Supabase Edge Runtime, and its remote Deno imports, so Deepgram
transcription and webhook callbacks are unavailable. Run
`--prepare-offline` again after changing `package-lock.json`, the frontend Docker
image, the Inngest image, or the Supabase CLI version.

After first start, update `infra/.env.docker`:
- `DEEPGRAM_API_KEY` (required for transcription)
- `DEEPGRAM_API_KEY_IDENTIFIER` (used for webhook verification)
- `DEEPGRAM_CALLBACK_URL` (set to `https://<your-ngrok-domain>/api/webhooks/deepgram`)

Restart frontend after env updates so changes are picked up:

```bash
cd infra
docker compose -f docker-compose.dev.yml up -d --build frontend
```

Service URLs:

| Service | URL |
|:--|:--|
| Frontend | http://localhost:3000 |
| Supabase API | http://localhost:54321 |
| Supabase Studio | http://localhost:54323 |
| Inbucket (local email) | http://localhost:54324 |
| Inngest Dev Server | http://localhost:8288 |
| ngrok Inspector | http://localhost:4040 |

Stop everything:

```bash
cd infra
./stop-local.sh
```

## Local Development (Without Docker)

Run frontend and Inngest directly:

```bash
cd frontend
npm install
npm run dev
```

Make sure `frontend/.env.local` includes `INNGEST_DEV=1`. Inngest v4 defaults to cloud mode unless dev mode is explicitly enabled for local work.

In another terminal:

```bash
cd frontend
npm run inngest
```

Optional helper script from repo root:

```bash
./dev.sh start
./dev.sh stop
./dev.sh restart
```

## Environment Variables

Use these templates:
- Docker local stack: `infra/.env.docker.example` -> `infra/.env.docker`
- Non-Docker frontend local: `frontend/.env.example` -> `frontend/.env.local`

Commonly used vars:
- `INNGEST_DEV=1` for non-Docker local development with Inngest v4
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DEEPGRAM_API_KEY`
- `DEEPGRAM_API_KEY_IDENTIFIER`
- `DEEPGRAM_CALLBACK_URL`
- `NEXT_PUBLIC_APP_URL` (defaults to `http://localhost:3000` for local)
- `DEEPGRAM_USE_PROXY` and `MEDIA_PROXY_SECRET` (recommended for local Docker callbacks)
- `DEEPGRAM_CONCURRENCY_LIMIT`, `DEEPGRAM_MODEL`
- `TRANSCRIPTION_TIMEOUT_MINUTES`
- `RATE_LIMIT_MODE`
- `WEBHOOK_HEALTHCHECK_SECRET`

## Testing

From `frontend/`:

```bash
npm test
npm run test:ci
```

## Useful Commands

Tail local Docker logs:

```bash
cd infra
docker compose -f docker-compose.dev.yml logs -f
```

Reset local Supabase DB:

```bash
cd infra/supabase
supabase db reset
```

## Documentation

- Product requirements: `PRD.md`
- Change history: `CHANGELOG.md`
- Refactor docs: `.docs/Refactor Documentation/REFACTOR_README.md`
