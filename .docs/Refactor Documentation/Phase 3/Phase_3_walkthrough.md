# Phase 3: Storage and Upload Flow - Walkthrough

> **Status**: ✅ Complete    
> **Date**: 2026-01-15

---

## Overview

Phase 3 migrated the upload and media playback flow from the legacy S3/MinIO presigned URL system to Supabase Storage with signed URLs.

---

## What We Did

### 1. Created Supabase Storage Helpers

| File | Purpose |
|:---|:---|
| `lib/supabase/storage.ts` | Storage utility functions |

**Functions implemented:**
- `validateMediaFile()` - Client-side validation (50MB default, configurable via `NEXT_PUBLIC_MAX_FILE_SIZE_MB`)
- `getMediaPath()` - Build storage path: `{user_id}/{project_id}/{filename}`
- `uploadProjectMedia()` - Upload file to Supabase Storage bucket
- `getSignedMediaUrl()` - Generate signed download URL (1-hour expiry)
- `deleteProjectMedia()` - Delete media file from storage

### 2. Created Next.js API Routes

| File | Endpoint | Purpose |
|:---|:---|:---|
| `app/api/projects/route.ts` | POST /api/projects | Create project + return storage path |
| `app/api/projects/[id]/media-url/route.ts` | GET /api/projects/[id]/media-url | Generate signed download URL |

**POST /api/projects flow:**
1. Authenticate user via Supabase session
2. Insert project into `projects` table with `user_id`
3. Insert key terms into `watchlist` table (if provided)
4. Return project ID and storage path for client-side upload

**GET /api/projects/[id]/media-url flow:**
1. Authenticate user via Supabase session
2. Fetch project (RLS ensures ownership)
3. Generate 1-hour signed URL from Supabase Storage
4. Return `{ url: string }`

### 3. Updated Upload Page

**File:** `app/upload/page.tsx`

**Changes:**
- Replaced legacy FastAPI call with Next.js API route
- Added client-side file validation before upload
- Three-step upload process:
  1. Create project via `/api/projects`
  2. Upload file to Supabase Storage
  3. Update project with `source_object_key`
- Added progress bar for upload status
- File size limit displayed to user (configurable via env var)
- Supported formats listed in UI

### 4. Updated Editor Media Loading

**File:** `app/editor/[id]/page.tsx`

**Changes:**
- Media URL fetch changed from legacy API to new Next.js route
- Before: `fetch(${base}/projects/${id}/media-url, { headers: getAuthHeaders() })`
- After: `fetch(/api/projects/${id}/media-url)`

Note: Other editor operations (chunks, speakers, edits) still use legacy API until migrated in later phases.

---

## Files Created/Modified

| File | Action | Purpose |
|:---|:---|:---|
| `lib/supabase/storage.ts` | NEW | Storage helper functions |
| `app/api/projects/route.ts` | NEW | Create project API |
| `app/api/projects/[id]/media-url/route.ts` | NEW | Signed URL API |
| `app/upload/page.tsx` | MODIFIED | Supabase Storage upload |
| `app/editor/[id]/page.tsx` | MODIFIED | New media URL endpoint |

---

## Verification

### ✅ Build Passes

```
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Generating static pages (10/10)
```

### ✅ Manual Testing - Upload Page UI

**Test Date:** 2026-01-15

#### Login Flow
- ✅ Authentication successful with Supabase
- ✅ Redirect to `/projects` after login

#### Upload Page UI Verified
- ✅ File input for audio/video files displayed
- ✅ File size limit message visible (configurable via `NEXT_PUBLIC_MAX_FILE_SIZE_MB`)
- ✅ Key terms input with placeholder text and instructions
- ✅ Upload button present (disabled when no file selected)
- ✅ Status indicator showing "Idle"

#### Pending End-to-End Tests

The following require an actual audio/video file to complete:

1. **Upload Flow**
   - Select audio/video file
   - Verify file validation errors for oversized files
   - Click Upload, verify progress bar
   - Confirm redirect to `/projects`

2. **Media Playback**
   - Navigate to `/editor/{project_id}`
   - Verify waveform loads and audio plays

3. **RLS Protection**
   - Verify unauthenticated users cannot access media

---

## Architecture Decision

**Legacy API Coexistence:**
- Upload and media-url endpoints are now **fully replaced** by Next.js routes
- Other endpoints (chunks, speakers, segments, exports) still use legacy FastAPI
- This allows incremental migration without breaking existing functionality

---

## What's Next (Phase 4)

Phase 4 will set up Inngest for background job processing:

1. Configure Inngest project (dev + prod)
2. Create event model for transcription lifecycle
3. Build webhook handler skeleton for Deepgram callbacks
4. Add idempotency and concurrency controls

**Handoff Notes for Phase 4:**
- Storage path stored in `projects.source_object_key`
- Use `getSignedMediaUrl()` or server-side `createSignedUrl()` to generate Deepgram-accessible URL
- Signed URLs can be passed to Inngest functions for transcription
