# TranscriptionAppV1

A privacy-friendly transcription app built on Next.js, Supabase, Inngest, and Deepgram. It supports uploads and browser recording, asynchronous transcription, speaker diarization, inline transcript editing, project organization, watchlist corrections, and exports (DOCX, VTT, Markdown, and plain text).

## Current Stack

- Frontend and API routes: Next.js 16.3.1 App Router, React 19, TypeScript 6, Tailwind CSS 4
- Runtime: Node.js 24 or newer and npm
- Data/Auth/Storage: Supabase (Postgres, Auth, Storage)
- Background jobs: Inngest
- Speech-to-text: Deepgram Nova 3
- Local infrastructure: Supabase CLI, Docker Compose, and optional ngrok

## Repository Layout

- `frontend/`: Next.js app, API routes, Inngest functions, Jest tests
  - `contracts/`: Zod schemas — single source of truth for all runtime-validated types
  - `core/`: Domain logic and application services (transcription, transcripts, exports, rate limiting)
  - `infra/`: External service adapters (Supabase client factories, Deepgram, Inngest)
  - `lib/`: Cross-cutting utilities, recording state, Supabase queries/realtime, and shared hooks
  - `components/`: React UI components
  - `app/`: Next.js App Router pages and API routes
  - `__tests__/`: Jest and Testing Library tests
  - `scripts/`: Local smoke tests, maintenance scripts, and result inspection tools
- `infra/`: local stack scripts (`start-local.sh`, `stop-local.sh`), Supabase config, Docker Compose
- `.docs/`: architecture and refactor docs
- `soniox-poc/`: separate proof of concept; it is not part of the active application

## Prerequisites

- Node.js 24+
- npm
- Docker Desktop
- Supabase CLI
- ngrok (required for Deepgram callbacks when using the local Docker workflow)

## Local Development (Recommended)

Use the full local stack (Supabase + Docker Compose + optional ngrok):

```bash
cd infra
./start-local.sh
```

What `start-local.sh` does:

- Starts Supabase from `infra/supabase`.
- Creates `infra/.env.docker` from `infra/.env.docker.example` if missing.
- Injects the local Supabase keys into `infra/.env.docker`.
- Ensures the local media proxy settings exist.
- Starts the Inngest and frontend containers.
- Starts ngrok when it is installed and writes the callback URL into `.env.docker`.

Set `DEEPGRAM_API_KEY` in `infra/.env.docker` before starting transcription. The
local script generates a `MEDIA_PROXY_SECRET` and enables the media proxy for
the Docker workflow. If ngrok is unavailable, the app still starts, but
Deepgram callbacks and transcription will not complete.

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

After first start, update `infra/.env.docker` with:

- `DEEPGRAM_API_KEY` (required for transcription).
- `DEEPGRAM_API_KEY_IDENTIFIER` (used for webhook verification).
- `DEEPGRAM_CALLBACK_URL` if you are supplying an ngrok URL manually.

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

This workflow starts the frontend and Inngest directly. Supabase must already be
running separately, for example with `supabase start` from `infra/`.

Create the local frontend environment and install dependencies:

```bash
cd frontend
cp .env.example .env.local
npm ci
npm run dev
```

Set the Supabase URL and anon key in `frontend/.env.local` from `supabase status`.
Keep `INNGEST_DEV=1`; otherwise the Inngest v4 CLI can default to cloud mode.

In another terminal:

```bash
cd frontend
npm run inngest
```

The optional root helper script starts only the frontend, Inngest, and ngrok. It
does not start Supabase or Docker:

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
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` for trusted maintenance/smoke scripts
- `NEXT_PUBLIC_APP_URL` (normally `http://localhost:3000` locally)
- `DEEPGRAM_API_KEY` and `DEEPGRAM_API_KEY_IDENTIFIER`
- `DEEPGRAM_CALLBACK_URL` for the public Deepgram webhook URL
- `DEEPGRAM_USE_PROXY` and `MEDIA_PROXY_SECRET` for the local media proxy
- `DEEPGRAM_CONCURRENCY_LIMIT` and `DEEPGRAM_MODEL`
- `TRANSCRIPTION_TIMEOUT_MINUTES` and `RATE_LIMIT_MODE`
- `WEBHOOK_HEALTHCHECK_SECRET` for the webhook health endpoint

## Testing

From `frontend/`:

```bash
npm test
npm run test:ci
npm run typecheck
npm run lint
npm run build
```

For a one-off coverage report:

```bash
npm run test:ci -- --coverage --coverageReporters=text-summary
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
- Active architecture and implementation docs: `.docs/`
- Historical plans and completed migrations: `.docs/archive/`
