# Engineer Onboarding Guide

> **Purpose**: Get up to speed quickly when joining any phase of the refactor.

## Quick Start (5 minutes)

1. **Read the app overview**: [README.md](../README.md)
2. **Understand current architecture**: [ARCHITECTURE.md](./ARCHITECTURE.md)
3. **See where we're going**: [REFACTOR_PLAN.md](./REFACTOR_PLAN.md)
4. **Check current phase status**: [PHASE_STATUS.md](./PHASE_STATUS.md)


## What Does This App Do?

A transcription tool that:
1. User uploads audio/video file
2. Deepgram Nova 3 transcribes with speaker diarization
3. User edits transcript in a waveform-synced editor
4. User exports to DOCX/VTT

## Architecture Overview

### Current Stack (Legacy)
```
Frontend (Next.js) → FastAPI → Celery/Redis → Deepgram
                         ↓
              PostgreSQL + MinIO (S3)
```

### Target Stack (Refactor)
```
Frontend (Next.js/Vercel) → Supabase (DB/Auth/Storage/Realtime)
                                ↓
                        Inngest (background jobs) → Deepgram
```

## Key Concepts

| Term | What It Is |
|:---|:---|
| **Project** | A single transcription job (one audio file → one transcript) |
| **Segment** | Raw Deepgram output: a chunk of speech with timestamps |
| **Chunk** | Consolidated segments for display (post-processed for UX) |
| **Speaker** | A labeled voice in the transcript (Speaker 0, Speaker 1, etc.) |
| **Key Terms** | Domain vocabulary sent to Deepgram for better recognition |
| **Job** | Background task record (queued → processing → completed/error) |

## Codebase Map

```
/
├── frontend/           # Next.js 14 app
│   ├── app/           # Pages (upload, projects, editor)
│   ├── components/    # React components
│   └── lib/           # API client, utilities
│
├── backend/           # FastAPI service (LEGACY during refactor)
│   ├── app/
│   │   ├── models.py  # SQLAlchemy ORM models
│   │   ├── routers/   # API endpoints
│   │   └── services/  # Business logic
│   └── alembic/       # DB migrations
│
├── worker/            # Celery worker (LEGACY during refactor)
│   └── app/worker.py  # Transcription pipeline
│
├── infra/             # Docker Compose files
│
└── .docs/             # This documentation
```

## Finding Your Task

1. Check [PHASE_STATUS.md](./PHASE_STATUS.md) for current phase
2. Read the phase section in [REFACTOR_PLAN.md](../REFACTOR_PLAN.md)
3. Look at open issues/PRs tagged with the phase number
4. Check `task.md` in any active branch for granular todos

## Common Questions

### Where is the database schema?
- **Legacy**: `backend/app/models.py` (SQLAlchemy)
- **New**: `infra/supabase/migrations/` (SQL files)

### Where is the transcription logic?
- **Legacy**: `worker/app/worker.py` → `transcribe_project()`
- **New**: Inngest functions (TBD during Phase 4-5)

### Where is the consolidation algorithm?
- **Legacy**: `backend/app/services/consolidation.py`
- **New**: TBD after Phase 0 spike

### How do I run locally?
- **Legacy**: `cd infra && docker compose up --build`
- **New**: See [LOCAL_DEV.md](./LOCAL_DEV.md) (created in Phase 9)

### Where are API endpoints defined?
- **Legacy**: `backend/app/routers/projects.py`
- **New**: `frontend/app/api/` (Next.js API routes)

## Phase-Specific Context

Each phase has a dedicated section in [REFACTOR_PLAN.md](../REFACTOR_PLAN.md) with:
- **Deliverables**: What must be done
- **Tasks**: Granular work items
- **Risks**: What to watch out for

## Testing

- **Backend tests**: `cd backend && pytest`
- **Frontend tests**: `cd frontend && npm test`
- **Integration**: Manual E2E via browser

## Getting Help

- Check existing docs in `.docs/`
- Review recent PRs for patterns
- Search codebase: `grep -r "pattern" --include="*.py"`
