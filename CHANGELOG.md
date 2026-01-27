# Changelog

All notable changes to this project will be documented in this file.

## [2026-01-27] - Webhook Robustness & Documentation

### Fixed
- **Large Payload Handling**: Updated client-side job fetching to exclude the potentially large `payload` column (Deepgram JSON). This prevents multi-MB payloads from being sent to browsers during job polling or realtime updates.
- **Error Display**: Implemented dedicated `fetchJobError` function to retrieve error details only when needed (for failed jobs), preserving error visibility without performance penalty.
- **Type Safety**: Introduced `JobSummary` type to enforce payload exclusion in frontend components.

### Documentation
- **Webhook Limitations**: Documented Vercel's 4.5 MB request body limit for the Deepgram webhook. Long recordings (3+ hours) may exceed this limit and require external hosting (e.g., AWS Lambda).
- **Code Comments**: Added detailed warnings in webhook handler and Supabase queries about payload size implications.

---

## [2026-01-23] - Major Stack Refactor Completion

### Added
- **Modern Tech Stack**: Migration to Next.js 14 (App Router), Supabase, and Inngest.
- **Supabase Integration**: Unified Database (Postgres), Authentication, Storage, and Realtime updates.
- **Inngest Background Jobs**: Event-driven architecture for transcription and consolidation pipelines.
- **Deepgram Async Pipeline**: Robust transcription handling with callback webhooks and automatic consolidation.
- **TypeScript Consolidation**: Ported the core consolidation algorithm from Python to TypeScript for a unified stack.
- **Local Dev Experience**: Integrated Supabase CLI and Docker Compose for a one-command local setup with ngrok support.
- **DOCX/VTT Exports**: Native Node.js implementation for transcript exports directly from the frontend.

### Changed
- **Architecture**: Moved from a fragmented FastAPI/Celery/Redis/MinIO stack to a streamlined serverless-ready architecture.
- **Realtime**: Replaced SWR polling with Supabase Realtime subscriptions and 5s polling fallback.
- **Auth**: Switched from token-based headers to cookie-based Supabase Auth (SSR compatible).
- **Legacy Components**: Marked `backend/` and `worker/` as legacy and archived.

### Benefits
- **Simplified Operations**: Reduced infrastructure complexity with managed services.
- **Improved DX**: Single language (TypeScript) across the entire stack.
- **Better Reliability**: Idempotent job handling and robust error classification.
- **Modern UI/UX**: Faster response times with Optimistic UI updates.

---

## [2026-01-12] - Transcript Export Feature

### Added
- **Export button in editor toolbar**: Blue "Export" button positioned on the right side of the search/replace controls
- **Export modal component**: Modal dialog for selecting export format (PDF, DOCX, VTT)
- **PDF export support**: New export format generating print-friendly PDF documents
- **Enhanced DOCX export**: Updated to include "Date of Transcription" and "Duration" metadata
- **Enhanced VTT export**: Updated with proper cue identifiers and speaker voice tags
- **Proper filename generation**: All exports use format `{title}_{FORMAT}_{YYYY-MM-DD}.ext`

### Changed
- **Export data source**: Switched from raw segments to consolidated chunks for all exports
- **DOCX structure**: Now matches PRD requirements with centered title, metadata block, and speaker turns
- **VTT format**: Now includes project-based cue IDs and proper speaker voice tags (`<v Speaker Name>`)
- **Export endpoints**: Updated to pass transcription date and duration metadata

### Technical
- **Backend**: Added `reportlab` dependency for PDF generation
- **Backend**: New `generate_pdf()` function in `services/exports.py`
- **Backend**: Updated `generate_docx()` and `generate_vtt()` with new parameters
- **Backend**: Added `format_duration()` helper for human-readable duration formatting
- **Backend**: New `/projects/{id}/export/pdf` endpoint
- **Frontend**: New `ExportModal.tsx` component with loading/success/error states
- **Frontend**: Export integration in editor with modal state management
- **Tests**: Comprehensive unit tests for all export functions (format_duration, DOCX, VTT, PDF)

### Benefits
- Users can now export transcripts in three formats (PDF, DOCX, VTT)
- All exports include proper metadata (Date of Transcription, Duration when available)
- Filenames are consistent and include dates for easy organization
- PDF format provides print-friendly option for sharing
- Export UI provides clear feedback during processing

---

## [2026-01-12] - Sync to Audio Feature

### Added
- **Floating "Sync to audio" button**: Replaces aggressive auto-follow checkbox with user-controlled sync
- **Directional arrows**: Button shows ↑ or ↓ arrow indicating scroll direction to active segment
- **Auto-follow mode**: After clicking sync, transcript automatically follows audio playback
- **Smart scroll detection**: Distinguishes user scroll (wheel/touch) from programmatic scroll
- **Edit mode awareness**: Button hidden while editing transcript cards
- **Speaker popover awareness**: Button hidden when speaker popover is open

### Changed
- **Removed "Follow playback" checkbox**: Replaced with more intuitive sync button UX
- **Transcript container restructured**: Outer container now has `relative` positioning for proper button placement

### UI/UX
- Button positioned at bottom center of transcript panel (not viewport)
- Purple pill-style button with white text and SVG arrow icons
- Smooth scroll animation when syncing to active segment
- Button appears immediately when user scrolls, regardless of active segment visibility

### Technical
- New state: `isFollowMode`, `isUserScrollingRef` for tracking follow behavior
- Event listeners for `wheel`, `touchstart` plus debounced `scroll` fallback to detect user-initiated scrolling reliably across browsers
- Auto-scroll effect triggered when `activeIds.segId` changes while in follow mode
- Removed unused `isOutOfSync` state (button visibility is controlled by `isFollowMode`)

---

## [2026-01-10] - Speaker Assignment Feature

### Added
- **SpeakerPopover component**: New `frontend/components/SpeakerPopover.tsx` for speaker management
- **Clickable speaker avatars**: Avatars in transcript segments are now interactive buttons
- **Global speaker rename**: Click current speaker → inline edit → Enter to rename across all segments
- **Create & reassign speaker**: Type new name → Tag to create speaker and reassign single segment
- **Reassign to existing speaker**: Click different speaker to move segment to that speaker
- **Untag/reset speaker**: "Reset to generic name" reverts custom names back to "Speaker X" format
- **Search/filter speakers**: Typing in the input filters the suggested speakers list
- **Keyboard support**: Escape closes popover, Enter submits rename/tag

### UI/UX
- Popover positioned below clicked avatar with fixed positioning
- Current speaker highlighted with "Click to rename" hint
- Optimistic UI updates with error rollback
- Hover ring effect on speaker avatar buttons

---

## [2025-01-05] - Project Cleanup

### Removed
- **Redundant files**: `create.json`, `projects.json`, `url.txt`, `pid.txt` (test output files)
- **Root `package-lock.json`**: Empty duplicate (actual lockfile is in `/frontend`)
- **`scripts/` directory**: Windows PowerShell test scripts (unused on macOS)
- **`worker/Dockerfile`**: Obsolete Dockerfile (replaced by `Dockerfile.unified`)

### Notes
- Removed 9 redundant files totaling ~15KB
- No functional changes - only cleanup of unused/obsolete files
- Empty `__init__.py` files preserved (required Python package markers)

## [Unreleased] - 2026-01-05

### Major Architectural Improvements

This release includes significant architectural refactoring to improve code quality, scalability, security, and maintainability.

### Frontend UX Improvements (UAT)

- **Upload:** Prevent repeated submissions by locking the upload action while in-flight, disabling inputs during upload, and redirecting to **Projects** after a successful upload.
- **Projects:** Renamed **Start** to **Transcribe** with clearer button states:
  - `Transcribe` (clickable)
  - `Transcribing...` (disabled while `queued`/`processing`)
  - `Transcribed` (disabled, blue) when `completed`
- **Tests:** Improved editor test `fetch` mocking to be robust to `Request` inputs and missing `method` (defaulting to `GET`).

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

---

## 🎯 7. Key Term Prompting & Retry [08-01-2026]

**Problem:** Users couldn't provide context-specific terms (names, acronyms) to improve transcription accuracy. Transcription failures due to invalid terms (e.g., too many) were unrecoverable, requiring re-upload.

**Solution:** Implemented key term support during upload, robust error handling for term limits, and a retry flow for correcting terms post-failure.

### Changes
- **Database:** Reused `Watchlist` table with unique constraint on `(project_id, canonical)`
- **API (New endpoints):**
  - `PATCH /projects/{id}/key-terms` - Update terms for existing project
  - `GET /projects/{id}` - Now returns `key_terms`
  - `POST /projects` - Accepts `key_terms` payload
- **Worker:**
  - Uses `keyterm` parameter for Deepgram (replacing legacy `keywords`)
  - Classifies errors (`keyterm_error` vs `transcription_error`)
  - Returns user-friendly error messages (e.g., "Too many key terms")
- **Frontend:**
  - `KeyTermsInput` component with scrollable chips and pasting support (normalizes newlines/tabs)
  - `EditKeyTermsModal` for fixing and retrying failed projects
  - Error banner on projects page with direct "Edit Key Terms" action

### Benefits
- **Higher Accuracy:** Domain-specific terms are correctly transcribed.
- **Recoverability:** Users can fix term-limit errors without re-uploading large files.
- **Better UX:**
  - Immediate visual feedback on term count/length
  - Easy pasting of lists from spreadsheets/docs
  - Clear explanations for failures

