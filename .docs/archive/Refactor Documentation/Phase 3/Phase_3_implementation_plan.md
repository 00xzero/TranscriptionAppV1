# Phase 3: Storage and Upload Flow

Migrate from legacy S3/MinIO presigned URL uploads to Supabase Storage with signed URLs for secure media handling.

---

## Background

The current stack uses:
- **Backend**: FastAPI endpoint `/projects` POST creates project + returns presigned PUT URL
- **Storage**: MinIO (S3-compatible) with presigned URLs
- **Editor**: Fetches media via `/projects/{id}/media-url` → presigned GET URL

The target stack uses:
- **Storage**: Supabase Storage with RLS-protected bucket
- **Upload**: Client-side upload using Supabase Storage SDK
- **Playback**: Server-generated signed download URLs

### Storage Path Convention (from Phase 1)
```
{user_id}/{project_id}/{filename}
```

---

## Proposed Changes

### Supabase Storage Helpers

#### [NEW] [storage.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/lib/supabase/storage.ts)

Client-side storage utilities:

```typescript
// uploadProjectMedia(supabase, file, userId, projectId) → { path, error }
// getMediaPath(userId, projectId, filename) → string
// getSignedMediaUrl(supabase, path, expiresIn) → { url, error }
// deleteProjectMedia(supabase, path) → { error }
```

---

### Server API Routes

#### [NEW] [route.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/app/api/projects/route.ts)

New API route for project creation:

**POST /api/projects**
1. Get authenticated user from Supabase session
2. Insert new project into `projects` table with `user_id`
3. Insert key terms into `watchlist` table (if provided)
4. Return project ID and storage path for client-side upload

```typescript
// Request: { title, filename, key_terms?: string[] }
// Response: { project: { id, status }, storagePath: string }
```

---

#### [NEW] [route.ts](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/app/api/projects/%5Bid%5D/media-url/route.ts)

New API route for signed media URL generation:

**GET /api/projects/[id]/media-url**
1. Get authenticated user from Supabase session
2. Fetch project, verify ownership via RLS
3. Generate signed download URL for `source_object_key`
4. Return URL with 1-hour expiry

```typescript
// Response: { url: string }
```

---

### Upload Page Migration

#### [MODIFY] [page.tsx](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/app/upload/page.tsx)

Replace legacy upload flow:

**Current Flow:**
1. POST to FastAPI `/projects` → receives presigned PUT URL
2. PUT file directly to MinIO
3. Redirect to projects page

**New Flow:**
1. POST to Next.js `/api/projects` → receives project ID + storage path
2. Upload file directly to Supabase Storage using client SDK
3. Update project with `source_object_key`
4. Redirect to projects page

Changes:
- Import Supabase client from `@/lib/supabase/client`
- Replace `fetch(${api}/projects)` with `fetch('/api/projects')`
- Replace MinIO PUT with `supabase.storage.from('media').upload()`
- Add upload progress indicator
- Update project record with storage path after upload succeeds

---

### Editor Media Loading

#### [MODIFY] [page.tsx](file:///Users/hamzaabikar/Documents/Miscellaneous/Code%20folder/CascadeProjects/TranscriptionAppV1/frontend/app/editor/%5Bid%5D/page.tsx)

Update media URL fetch:

**Current:** `fetch(${base}/projects/${id}/media-url)` → FastAPI
**New:** `fetch(/api/projects/${id}/media-url)` → Next.js API route

Minimal change - just update the URL, the response format remains `{ url: string }`.

---

## File Summary

| File | Action | Purpose |
|:---|:---|:---|
| `lib/supabase/storage.ts` | NEW | Storage helper functions |
| `app/api/projects/route.ts` | NEW | Create project API |
| `app/api/projects/[id]/media-url/route.ts` | NEW | Signed URL API |
| `app/upload/page.tsx` | MODIFY | Use Supabase Storage |
| `app/editor/[id]/page.tsx` | MODIFY | Use new media URL endpoint |

---

## Verification Plan

### Automated Tests

1. **Build Check**
   ```bash
   cd frontend && npm run build
   ```
   Expect: No type errors, successful build

### Manual Browser Testing

1. **Upload Flow**
   - Navigate to `/upload`
   - Select audio/video file
   - Add optional key terms
   - Click Upload
   - Verify: Project created, file uploaded, redirects to `/projects`

2. **Media Playback**
   - Navigate to `/editor/{project_id}`
   - Verify: Waveform loads and audio plays

3. **RLS Protection**
   - Log out, attempt to access media URL directly
   - Verify: 401/403 error

4. **Cross-User Protection**
   - Create project with User A
   - Log in as User B
   - Attempt to access User A's project editor
   - Verify: Access denied or empty result

---

## Dependencies

- Phase 2 auth must be working (Supabase session available)
- Storage bucket `media` created with policies (done in Phase 1)
- Environment variables set: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Risks & Mitigations

| Risk | Mitigation |
|:---|:---|
| CORS issues with Supabase Storage | Supabase handles CORS; test in browser |
| Large file upload timeouts | Supabase Storage supports chunked uploads; add progress UI |
| Signed URL expiry during playback | 1-hour expiry should be sufficient; can refresh on seek |

---

## Post-Phase Handoff

For **Phase 4 (Inngest Setup)**:
- Storage path stored in `projects.source_object_key`
- Use `getSignedMediaUrl()` to generate Deepgram-accessible URL
- Signed URLs can be passed to Inngest functions for transcription
