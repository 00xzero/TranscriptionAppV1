# Phase 1: Supabase Foundation - Walkthrough

> **Completed**: 2026-01-14  
> **Duration**: ~1 hour

---

## Overview

Phase 1 established the Supabase backend infrastructure for the Transcription App refactor. This included creating the cloud project, defining the database schema with 8 tables, implementing row-level security (RLS) policies, and setting up storage for media files.

---

## What We Did

### 1. Created Supabase Project

Used the Supabase MCP server to create a new project:

```
Project Name: transcription-app
Project ID:   svzeffnmlqbdnjzhcgyx
Region:       eu-west-1 (Ireland)
URL:          https://svzeffnmlqbdnjzhcgyx.supabase.co
```

### 2. Created Database Schema (8 Tables)

Applied 8 migrations to create the core tables:

| Migration | Table | Key Features |
|:---|:---|:---|
| `create_projects_table` | `projects` | Added `user_id` FK to `auth.users`, status tracking |
| `create_speakers_table` | `speakers` | Label, color, FK to projects |
| `create_segments_table` | `segments` | Raw Deepgram output with timestamps |
| `create_words_table` | `words` | Word-level timing, confidence scores |
| `create_chunks_table` | `chunks` | Consolidated display data, `is_edited`, `is_filler` |
| `create_chunk_words_table` | `chunk_words` | Junction table for word-level highlighting |
| `create_watchlist_table` | `watchlist` | Key terms for transcription |
| `create_jobs_table` | `jobs` | `inngest_event_id` (replaced `celery_task_id`) |

**Key Schema Changes from Legacy:**
- `projects.user_id` added for multi-tenant support
- `jobs.celery_task_id` → `jobs.inngest_event_id`
- `chunks.source_segment_ids` uses native `UUID[]` array type
- `jobs.payload` uses `JSONB` instead of `JSON`

### 3. Created Auto-Update Trigger

Added a trigger function to automatically update `updated_at` timestamps:

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';
```

Applied to all 7 tables with `updated_at` columns.

### 4. Enabled Row-Level Security (RLS)

Applied RLS policies to all 8 tables:

**Direct Ownership (projects):**
```sql
-- Users can only access their own projects
USING (user_id = auth.uid())
```

**Project-Scoped (speakers, segments, chunks, jobs, watchlist):**
```sql
-- Access via project ownership
USING (
    project_id IN (
        SELECT id FROM projects WHERE user_id = auth.uid()
    )
)
```

**Deeply Nested (words, chunk_words):**
```sql
-- Access via segment → project chain
USING (
    segment_id IN (
        SELECT id FROM segments WHERE project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid()
        )
    )
)
```

### 5. Created Storage Bucket

Created a private `media` bucket for audio/video files:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'media', 
    'media', 
    false,
    1610612736,  -- 1.5GB
    ARRAY['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 
          'audio/m4a', 'audio/aac', 'video/mp4', 'video/webm', 
          'video/quicktime', 'video/x-msvideo']
);
```

**Storage Path Convention:** `{user_id}/{project_id}/{filename}`

**Policies:**
- Upload: Owner can upload to their folder
- Read: Owner can read from their folder
- Update: Owner can update their files
- Delete: Owner can delete their files

### 6. Fixed Security Advisory

Supabase security advisor flagged the trigger function for mutable search_path. Fixed by adding:

```sql
SECURITY DEFINER
SET search_path = public
```

### 7. Created Local Migration Files

Generated consolidated migration file for local development:

- `infra/supabase/migrations/20260114000000_initial_schema.sql` - Complete schema with all tables, indexes, triggers, RLS, and storage

### 8. Created Seed Data

Created seed file for local development testing:

- `infra/supabase/seed.sql` - Sample projects, speakers, segments, and chunks

---

## Files Created

| File | Purpose |
|:---|:---|
| `Phase_1_implementation_plan.md` | Detailed SQL schema and implementation guide |
| `Phase_1_task.md` | Task checklist (all items checked) |
| `infra/supabase/migrations/20260114000000_initial_schema.sql` | Full migration for local Supabase |
| `infra/supabase/seed.sql` | Development seed data |

---

## Supabase Dashboard Verification

To verify the setup, you can check:

1. **Tables**: Supabase Dashboard → Table Editor → 8 tables should be listed
2. **RLS**: Each table should show "RLS enabled" badge
3. **Storage**: Storage → Buckets → `media` bucket should exist
4. **Policies**: Authentication → Policies → All policies should be visible

---

## Connection Details

```env
NEXT_PUBLIC_SUPABASE_URL=https://svzeffnmlqbdnjzhcgyx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2emVmZm5tbHFiZG5qemhjZ3l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzNDI4ODAsImV4cCI6MjA4MzkxODg4MH0.bW_kkfhxlZFwjxkbcQXBF_kVdnKCEM-5Oo1VZpxop1g
```

> **Note**: Service role key (for Inngest) should be retrieved from Supabase Dashboard → Settings → API → service_role key. Do not commit to repo.

---

## Migrations Applied (19 total)

```
20260114005503_create_projects_table
20260114005509_create_speakers_table
20260114005512_create_segments_table
20260114005514_create_words_table
20260114005521_create_chunks_table
20260114005523_create_chunk_words_table
20260114005526_create_watchlist_table
20260114005529_create_jobs_table
20260114005538_create_updated_at_trigger
20260114005544_enable_rls_projects
20260114005546_enable_rls_speakers
20260114005548_enable_rls_segments
20260114005551_enable_rls_words
20260114005555_enable_rls_chunks
20260114005558_enable_rls_chunk_words
20260114005559_enable_rls_watchlist
20260114005601_enable_rls_jobs
20260114005616_create_storage_bucket
20260114XXXXXX_fix_function_search_path
```

---

## What's Next (Phase 2)

Phase 2 will wire up authentication:

1. Set up Supabase client in Next.js (browser + server)
2. Add auth UI (sign in, sign up, magic link)
3. Replace legacy `X-API-Key` header with Supabase JWT auth
4. Add route protection in Next.js app router
5. Create middleware for session refresh

---

## Lessons Learned

1. **MCP Server**: The Supabase MCP server made it easy to create projects and run migrations without leaving the IDE
2. **Security Advisors**: Always run `get_advisors` after migrations - caught the search_path issue immediately
3. **Atomic Migrations**: Breaking migrations into small pieces (table, then RLS) made debugging easier
4. **Storage Policies**: Using `storage.foldername()` for path-based access control is cleaner than regex patterns
