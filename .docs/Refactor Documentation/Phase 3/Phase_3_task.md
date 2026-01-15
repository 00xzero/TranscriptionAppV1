# Phase 3: Storage and Upload Flow

## Overview
Replace legacy S3/MinIO presigned URL upload with Supabase Storage, implementing signed uploads and media retrieval.

---

## Discovery & Planning
- [x] Read main refactor documentation (REFACTOR_PLAN.md, PHASE_STATUS.md)
- [x] Review Phase 2 deliverables and handoff notes
- [x] Analyze current upload page implementation (`frontend/app/upload/page.tsx`)
- [x] Analyze current media URL retrieval in editor (`frontend/app/editor/[id]/page.tsx`)
- [x] Review Supabase client utilities from Phase 2
- [x] Review existing S3/MinIO services (`backend/app/services/s3.py`)
- [x] Review Supabase schema and storage policies
- [ ] Create implementation plan

---

## Implementation

### 1. Supabase Storage Helpers
- [x] Create `frontend/lib/supabase/storage.ts` with:
  - [x] `uploadProjectMedia()` - upload file to Supabase Storage
  - [x] `getSignedMediaUrl()` - get signed download URL for playback
  - [x] `deleteProjectMedia()` - delete media file
  - [x] `validateMediaFile()` - client-side file size/type validation

### 2. Server API Routes
- [x] Create `frontend/app/api/projects/route.ts`:
  - [x] POST handler to create project + initiate upload
- [x] Create `frontend/app/api/projects/[id]/media-url/route.ts`:
  - [x] GET handler to generate signed download URL

### 3. Upload Page Migration
- [x] Update `frontend/app/upload/page.tsx`:
  - [x] Replace legacy API call with Next.js API route
  - [x] Upload directly to Supabase Storage
  - [x] Store object key in projects table
  - [x] Handle progress and error states
  - [x] Added file size validation (50MB default, configurable via `NEXT_PUBLIC_MAX_FILE_SIZE_MB`)

### 4. Editor Media Loading
- [x] Update editor to use new media URL endpoint
- [ ] Ensure signed URLs work with WaveSurfer.js (requires runtime testing)

### 5. Watchlist/Key Terms Integration
- [x] Wire key terms to Supabase watchlist table (in POST /api/projects)

---

## Verification
- [x] Test upload flow end-to-end (manual browser test)
- [x] Test media playback in editor (manual browser test)
- [x] Verify RLS protects storage access (manual browser test)
- [x] Build passes without type errors
- [x] Create walkthrough documentation

---

## Documentation
- [x] Update PHASE_STATUS.md with Phase 3 completion
- [x] Add Phase 3 handoff notes for Phase 4
- [x] Create Phase 3 walkthrough
