# Changelog

All notable changes to this project are documented in this file.

## [Unreleased] - 2026-01-05

### Major Architectural Improvements

This release includes significant architectural refactoring to improve code quality, scalability, security, and maintainability.

---

## 🔧 1. Unified Database Access Layer

**Problem:** Worker used raw `psycopg2` SQL queries while backend used SQLAlchemy ORM, creating two sources of truth and risk of schema drift.

**Solution:** Worker now imports and uses the same SQLAlchemy models as the backend.

### Changes
- **New:** `worker/Dockerfile.unified` - Builds worker with backend code included
- **Modified:** `worker/app/worker.py` - Refactored to use SQLAlchemy ORM instead of raw SQL
- **Modified:** `worker/requirements.txt` - Added `SQLAlchemy==2.0.30`
- **Modified:** `infra/docker-compose.yml` - Updated worker build context

### Benefits
- Single source of truth for database schema
- Automatic timestamp handling via ORM
- Migration-safe (Alembic changes apply to both services)
- Proper relationship and cascade support
- Eliminated SQL injection risks

---

## 📊 2. Job Lifecycle Tracking & Observability

**Problem:** Jobs table only populated on errors, no tracking for successful transcriptions, no timing metrics.

**Solution:** Full job lifecycle tracking with status transitions and timing information.

### Changes
- **Modified:** `backend/app/models.py` - Added `celery_task_id`, `started_at`, `finished_at` to Job model
- **Modified:** `backend/app/schemas.py` - Extended `JobRead` with new fields
- **Modified:** `backend/app/routers/projects.py` - Creates Job record when `/start` is called
- **Modified:** `backend/app/services/tasks.py` - Pass `job_id` to worker task
- **Modified:** `worker/app/worker.py` - Track job status: `queued` → `processing` → `completed`/`error`
- **New:** `GET /projects/{id}/jobs` endpoint for querying job history

### Benefits
- Complete audit trail for all transcription attempts
- Timing metrics (`started_at`, `finished_at`) for performance monitoring
- Link between Celery task_id and database Job record
- Detailed error information in `payload` field
- Support for retry tracking (multiple jobs per project)

---

## 🔒 3. Authentication Enforcement

**Problem:** `SINGLE_USER_TOKEN` existed in config but was never enforced on API routes.

**Solution:** Token-based authentication via Bearer token or X-API-Key header.

### Changes
- **New:** `backend/app/core/auth.py` - Authentication dependency with token validation
- **Modified:** `backend/app/routers/projects.py` - Applied `require_auth` to all routes

### Benefits
- All `/projects/*` endpoints now require authentication
- Supports both `Authorization: Bearer <token>` and `X-API-Key: <token>` headers
- `/health` endpoint remains open for load balancer checks
- Returns proper 401 Unauthorized responses

### Usage
```bash
# Bearer token (standard)
curl -H "Authorization: Bearer devtoken" http://localhost:8000/projects

# X-API-Key header (simpler for scripts)
curl -H "X-API-Key: devtoken" http://localhost:8000/projects
```

---

## 🗄️ 4. Database Migrations with Alembic

**Problem:** Using `Base.metadata.create_all()` is fragile and can't handle schema evolution.

**Solution:** Proper migration management with Alembic.

### Changes
- **New:** `backend/alembic.ini` - Alembic configuration
- **New:** `backend/alembic/env.py` - Alembic environment with SQLAlchemy integration
- **New:** `backend/alembic/script.py.mako` - Migration template
- **New:** `backend/alembic/versions/20260105_000000_initial_schema.py` - Initial migration
- **Modified:** `backend/app/main.py` - Added `run_migrations()` function, runs on startup
- **Modified:** `backend/Dockerfile` - Copy alembic files into container

### Benefits
- Schema evolution support (add/remove columns, indexes, constraints)
- Version tracking via `alembic_version` table
- Rollback support for reverting schema changes
- Team collaboration with version-controlled migrations
- Production-safe, reviewable schema changes

### Migration Commands
```bash
# Check current revision
docker compose exec api alembic current

# Generate new migration
docker compose exec api alembic revision --autogenerate -m "Add new column"

# Apply migrations
docker compose exec api alembic upgrade head

# Rollback one migration
docker compose exec api alembic downgrade -1
```

---

## 💾 5. Memory-Efficient Media Handling

**Problem:** Worker downloaded entire media files into RAM before uploading to Deepgram (500MB file = 500MB RAM spike).

**Solution:** Deepgram URL fetch - Deepgram downloads directly from S3.

### Changes
- **Modified:** `worker/app/worker.py` - Added `_presign_get_url()`, `_can_use_url_fetch()` functions
- **Modified:** `worker/app/worker.py` - `transcribe_project()` uses URL fetch when S3 is publicly accessible

### Benefits
- **Zero memory pressure** on worker for large files
- **Faster processing** - eliminates double transfer (S3→Worker→Deepgram becomes S3→Deepgram)
- **Automatic fallback** - uses byte upload for local dev (when S3 is on localhost)
- **Production-ready** - controlled via `S3_PUBLIC_BASE_URL` environment variable

### Behavior
- **Local dev** (`S3_PUBLIC_BASE_URL=http://localhost:9000`): Uses byte upload fallback
- **Production** (`S3_PUBLIC_BASE_URL=https://storage.example.com`): Uses URL fetch

---

## ⚡ 6. Smart Data Fetching with SWR

**Problem:** Frontend used manual `fetch()` + unconditional 5-second polling, no caching, no error handling.

**Solution:** SWR (stale-while-revalidate) for intelligent data fetching.

### Changes
- **Modified:** `frontend/package.json` - Added `swr: 2.2.5`
- **New:** `frontend/lib/swr.ts` - SWR configuration, fetchers, and custom hooks
- **Modified:** `frontend/app/projects/page.tsx` - Refactored to use `useProjects()` hook

### Benefits
- **Smart polling** - Only polls when projects are in `processing`/`queued` state
- **Automatic caching** - Deduplicates requests, reduces network traffic
- **Built-in auth** - All requests include authentication headers
- **Error handling** - Automatic retry with exponential backoff
- **Optimistic updates** - Instant UI feedback for mutations
- **Focus revalidation** - Auto-refresh when user returns to tab

### New Hooks
```typescript
// Projects list with smart polling
const { projects, isLoading, mutate } = useProjects()

// Single project
const { project, isLoading } = useProject(projectId)

// Project jobs
const { jobs, isLoading } = useProjectJobs(projectId)

// Mutations
const { startProject, deleteProject } = useProjectActions()
```

### Code Reduction
- **Before:** 70+ lines with `useEffect`, manual polling, no caching
- **After:** ~35 lines with declarative hooks

---

## Database Schema Changes

### New Columns (Jobs Table)
- `celery_task_id` VARCHAR(64) - Links to Celery async task
- `started_at` TIMESTAMP - When job processing began
- `finished_at` TIMESTAMP - When job completed/failed

### Migration
For existing databases, the schema was updated via manual ALTER statements. For new deployments, Alembic migrations handle this automatically.

---

## Configuration Changes

### New Environment Variables
- `NEXT_PUBLIC_API_TOKEN` - Frontend API authentication token (defaults to `devtoken`)

### Updated Variables
- `S3_PUBLIC_BASE_URL` - Now used to determine URL fetch vs byte upload strategy

---

## Breaking Changes

### API Authentication
All `/projects/*` endpoints now require authentication. Clients must include either:
- `Authorization: Bearer <token>` header, or
- `X-API-Key: <token>` header

### Frontend
The frontend now requires `NEXT_PUBLIC_API_TOKEN` to be set (defaults to `devtoken` for local dev).

---

## Upgrade Guide

### For Existing Deployments

1. **Update database schema:**
   ```bash
   docker compose exec postgres psql -U app -d meeting -c "
   ALTER TABLE jobs ADD COLUMN IF NOT EXISTS celery_task_id VARCHAR(64);
   ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;
   ALTER TABLE jobs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP WITH TIME ZONE;
   CREATE INDEX IF NOT EXISTS ix_jobs_celery_task_id ON jobs(celery_task_id);
   "
   ```

2. **Stamp database with initial migration:**
   ```bash
   docker compose exec api alembic stamp 001_initial
   ```

3. **Rebuild containers:**
   ```bash
   docker compose build
   docker compose up -d
   ```

4. **Set authentication token:**
   Add to `.env`:
   ```
   SINGLE_USER_TOKEN=your-secure-token-here
   NEXT_PUBLIC_API_TOKEN=your-secure-token-here
   ```

### For New Deployments

Simply run:
```bash
docker compose up --build
```

Alembic will automatically create the database schema on first startup.

---

## Technical Debt Addressed

- ✅ Worker bypassing backend domain layer → **Fixed with shared ORM**
- ✅ Missing job lifecycle tracking → **Fixed with full job status tracking**
- ✅ No authentication enforcement → **Fixed with token-based auth**
- ✅ Using `create_all` instead of migrations → **Fixed with Alembic**
- ✅ Downloading full media into RAM → **Fixed with URL fetch**
- ✅ Manual fetch + polling in frontend → **Fixed with SWR**

---

## Contributors

- Architectural review and implementation: January 2026
