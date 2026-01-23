# Lightweight Transcription Web App

A privacy-friendly transcription tool powered by Deepgram Nova 3 (batch STT) and open components, with speaker diarization, vocabulary watchlist corrections, an inline transcript editor, and exports (DOCX, VTT).

> **Recent Updates:** This codebase has undergone significant architectural improvements including unified database access, job lifecycle tracking, authentication enforcement, Alembic migrations, memory-efficient media handling, and smart data fetching, plus UAT UX improvements to prevent upload spam and clarify transcription actions. See [CHANGELOG.md](CHANGELOG.md) for details.

## Tech Stack

### New Stack (Recommended)
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, wavesurfer.js
- **Backend:** Supabase (Postgres, Auth, Storage, Realtime)
- **Background Jobs:** Inngest
- **ML:** Deepgram Nova 3 (STT)
- **Deployment:** Vercel + Supabase Cloud + Inngest Cloud

### Legacy Stack (Being Deprecated)
- **Backend:** FastAPI (Python 3.11), SQLAlchemy, Alembic
- **Workers:** Celery + Redis
- **Storage:** PostgreSQL + MinIO (S3-compatible)

## Monorepo Layout

- `frontend/` Next.js app (TBD)
- `backend/` FastAPI service
- `worker/` Celery worker service
- `infra/` Docker Compose files and Nginx config
- `shared/` Shared schemas/utilities (TBD)

## Quickstart: Docker Local Dev (New Stack)

> **Prerequisites:** Docker Desktop, [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started)

1. Install Supabase CLI (one-time):
   ```bash
   brew install supabase/tap/supabase
   ```

2. Start everything with one command:
   ```bash
   cd infra && ./start-local.sh
   ```

3. Update Deepgram API key in `infra/.env.docker`

4. Access the application:
   | Service | URL |
   |:---|:---|
   | Frontend | http://localhost:3000 |
   | Supabase Studio | http://localhost:54323 |
   | Inngest | http://localhost:8288 |
   | Inbucket (email) | http://localhost:54324 |

5. Stop services:
   ```bash
   cd infra && ./stop-local.sh
   ```

## Quickstart: Legacy Stack (Deprecated)

> **Note:** This stack will be removed after Phase 11. Use the new Docker local dev stack above.

1. Copy environment example and adjust values:
   ```bash
   cp env.example .env
   ```

2. Set your Deepgram API key in `.env`:
   ```bash
   DEEPGRAM_API_KEY=your_api_key_here
   ```

3. Ensure Docker Desktop is installed and running (WSL2 on Windows).

4. Start the stack (API, DB, Redis, MinIO, Worker, Frontend):
   ```bash
   cd infra
   docker compose up --build
   ```

5. Access the application:
   - **Frontend:** http://localhost:3001
   - **API:** http://localhost:8000
   - **API Docs:** http://localhost:8000/docs
   - **MinIO Console:** http://localhost:9001 (login: minioadmin/minioadmin)

6. Default authentication token for local dev: `devtoken`


## Environment Variables

See `env.example` for the full list. Key vars:

### Backend
- `DATABASE_URL` - Postgres connection string
- `REDIS_URL` - Redis URL for Celery
- `S3_ENDPOINT_URL` - MinIO/S3 endpoint (internal)
- `S3_PUBLIC_BASE_URL` - Public S3 URL for Deepgram URL fetch
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` - S3 credentials
- `SECRET_KEY` - Application secret key
- `SINGLE_USER_TOKEN` - API authentication token (default: `devtoken`)
- `DEEPGRAM_API_KEY` - **Required** for transcription
- `DEEPGRAM_MODEL` - STT model (default: `nova-3`)

### Frontend
- `NEXT_PUBLIC_API_URL` - Backend API URL (default: `http://localhost:8000`)
- `NEXT_PUBLIC_API_TOKEN` - API authentication token (default: `devtoken`)

## Development Notes

### Architecture
- **Unified ORM:** Worker and backend share SQLAlchemy models for consistency
- **Job Tracking:** Full lifecycle tracking with `queued` → `processing` → `completed`/`error` states
- **Authentication:** Token-based auth via `Authorization: Bearer <token>` or `X-API-Key: <token>`
- **Migrations:** Alembic manages database schema evolution
- **Smart Polling:** Frontend only polls when jobs are active
- **Memory Efficient:** Deepgram fetches media directly from S3 (production) or falls back to byte upload (local dev)

### Database Migrations
```bash
# Check current migration version
docker compose exec api alembic current

# Generate new migration after model changes
docker compose exec api alembic revision --autogenerate -m "Description"

# Apply pending migrations
docker compose exec api alembic upgrade head

# Rollback one migration
docker compose exec api alembic downgrade -1
```

### API Authentication
All `/projects/*` endpoints require authentication:
```bash
# Using Bearer token
curl -H "Authorization: Bearer devtoken" http://localhost:8000/projects

# Using X-API-Key header
curl -H "X-API-Key: devtoken" http://localhost:8000/projects
```

## Features

### ✅ Implemented
- **Transcription:** Deepgram Nova 3 with speaker diarization
- **Editor:** Waveform visualization with inline transcript editing
- **Exports:** DOCX and VTT format support
- **Watchlist:** Vocabulary term boosting for improved accuracy
- **Job Tracking:** Full observability with timing metrics
- **Authentication:** Token-based API security
- **Smart Polling:** Efficient frontend data fetching

### 🚧 Roadmap
- Enhanced speaker identification
- Real-time transcription support
- Multi-user authentication with JWT
- WebSocket support for live updates
- Advanced export formats

Refer to `PRD.md` for full requirements and `CHANGELOG.md` for recent improvements.
