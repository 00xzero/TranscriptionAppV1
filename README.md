# Lightweight Transcription Web App

A privacy-friendly transcription tool powered by Deepgram Nova 3 (batch STT) and open components, with speaker diarization, vocabulary watchlist corrections, an inline transcript editor, and exports (DOCX, VTT).

## Tech Stack

- Frontend: Next.js 14 (App Router), TypeScript, Tailwind CSS, wavesurfer.js
- Backend: FastAPI (Python 3.11)
- Workers: Celery + Redis
- Storage: PostgreSQL + MinIO (S3-compatible)
- Media: ffmpeg
- ML: Deepgram Nova 3 (STT), Silero VAD, Resemblyzer, WhisperX
- Infra: Docker Compose, Nginx reverse proxy

## Monorepo Layout

- `frontend/` Next.js app (TBD)
- `backend/` FastAPI service
- `worker/` Celery worker service
- `infra/` Docker Compose files and Nginx config
- `shared/` Shared schemas/utilities (TBD)

## Quickstart (Local Dev)

1. Copy environment example and adjust values:
   ```bash
   cp env.example .env
   ```
2. Ensure Docker Desktop is installed and running (WSL2 on Windows).
3. Start the stack (API, DB, Redis, MinIO, etc.):
   ```bash
   docker compose -f infra/docker-compose.yml up --build
   ```
4. API available at http://localhost:8000
5. MinIO Console at http://localhost:9001 (login from env vars)

Optional GPU path will be provided later.

## Environment Variables

See `env.example` for the full list. Key vars:
- `DATABASE_URL` Postgres connection string
- `REDIS_URL` Redis URL for Celery
- `S3_ENDPOINT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`
- `SECRET_KEY`, `SINGLE_USER_TOKEN`
- `DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL` (e.g., `nova-3`)

## Development Notes

- The backend uses Pydantic Settings for typed configuration.
- S3/MinIO access uses pre-signed URLs for secure uploads/downloads.
- Background jobs (transcription, diarization) run via Celery workers.
- Batch uploads are transcribed via Deepgram Nova 3 API.

## Roadmap

- Scaffold frontend and editor UI with waveform + transcript pane
- Implement transcription pipeline with Deepgram Nova 3
- Add diarization (Resemblyzer + spectral clustering)
- Word-level alignment via WhisperX
- Watchlist correction pipeline
- Exports (VTT, DOCX)

Refer to `PRD.md` for full requirements and acceptance criteria.
