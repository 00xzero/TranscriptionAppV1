# Database Schema Mapping

> **Purpose**: Document current SQLAlchemy schema and plan Supabase Postgres migration with RLS.

---

## Current Tables Overview

| Table | Row Count Type | Ownership | Notes |
|:---|:---|:---|:---|
| `projects` | Low | Direct (user_id) | Add `user_id` column |
| `speakers` | Medium | Via project | FK to projects |
| `segments` | High | Via project | Raw Deepgram output |
| `words` | Very High | Via segment | Word-level timing |
| `chunks` | Medium | Via project | Consolidated display data |
| `chunk_words` | Very High | Via chunk | Junction table |
| `watchlist` | Low | Via project | Key terms |
| `jobs` | Low | Via project | Background job records |

---

## Schema Changes for Supabase

### 1. Add `user_id` to `projects`

```sql
ALTER TABLE projects 
ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX idx_projects_user_id ON projects(user_id);
```

### 2. All Other Tables

No schema changes needed - they inherit ownership through `project_id` foreign key.

---

## RLS Policies

### projects

```sql
-- Enable RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Users can only see their own projects
CREATE POLICY "Users view own projects" ON projects
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users create own projects" ON projects
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own projects" ON projects
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users delete own projects" ON projects
  FOR DELETE USING (user_id = auth.uid());
```

### speakers, segments, chunks, jobs, watchlist

```sql
-- Enable RLS
ALTER TABLE speakers ENABLE ROW LEVEL SECURITY;

-- Policy pattern for project-scoped tables
CREATE POLICY "Users access own project speakers" ON speakers
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

-- Repeat for: segments, chunks, jobs, watchlist
```

### words

```sql
ALTER TABLE words ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own project words" ON words
  FOR ALL USING (
    segment_id IN (
      SELECT id FROM segments WHERE project_id IN (
        SELECT id FROM projects WHERE user_id = auth.uid()
      )
    )
  );
```

### chunk_words

```sql
ALTER TABLE chunk_words ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own chunk_words" ON chunk_words
  FOR ALL USING (
    chunk_id IN (
      SELECT id FROM chunks WHERE project_id IN (
        SELECT id FROM projects WHERE user_id = auth.uid()
      )
    )
  );
```

---

## Column Mappings

### projects

| SQLAlchemy | Postgres | Notes |
|:---|:---|:---|
| `id` VARCHAR(36) | `id` UUID | Use native UUID |
| `title` VARCHAR(256) | `title` TEXT | |
| `status` VARCHAR(32) | `status` TEXT | Consider ENUM |
| `source_object_key` VARCHAR(512) | `source_object_key` TEXT | |
| `duration_seconds` INTEGER | `duration_seconds` INTEGER | |
| `created_at` DATETIME | `created_at` TIMESTAMPTZ | |
| `updated_at` DATETIME | `updated_at` TIMESTAMPTZ | |
| - | `user_id` UUID | **NEW** FK to auth.users |

### chunks

| SQLAlchemy | Postgres | Notes |
|:---|:---|:---|
| `source_segment_ids` JSON | `source_segment_ids` UUID[] | Use native array |
| `is_edited` BOOLEAN | `is_edited` BOOLEAN | |
| `is_filler` BOOLEAN | `is_filler` BOOLEAN | |
| `algo_version` VARCHAR(16) | `algo_version` TEXT | |

### jobs

| SQLAlchemy | Postgres | Notes |
|:---|:---|:---|
| `celery_task_id` VARCHAR(64) | `inngest_event_id` TEXT | Rename for new stack |
| `payload` JSON | `payload` JSONB | Use JSONB |

---

## Indexes

```sql
-- Primary indexes (already exist)
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_user_id ON projects(user_id);

-- Foreign key indexes
CREATE INDEX idx_speakers_project_id ON speakers(project_id);
CREATE INDEX idx_segments_project_id ON segments(project_id);
CREATE INDEX idx_segments_speaker_id ON segments(speaker_id);
CREATE INDEX idx_words_segment_id ON words(segment_id);
CREATE INDEX idx_chunks_project_id ON chunks(project_id);
CREATE INDEX idx_chunks_speaker_id ON chunks(speaker_id);
CREATE INDEX idx_chunk_words_chunk_id ON chunk_words(chunk_id);
CREATE INDEX idx_chunk_words_word_id ON chunk_words(word_id);
CREATE INDEX idx_jobs_project_id ON jobs(project_id);
CREATE INDEX idx_watchlist_project_id ON watchlist(project_id);
```

---

## Migration Strategy

1. **Phase 1**: Create schema in Supabase using SQL migrations
2. **No data migration**: Greenfield approach (per REFACTOR_PLAN.md)
3. **Service role**: Use for Inngest functions that need to bypass RLS

---

## Post-Refactor Location

> After refactor completion, move this file to:  
> `docs/architecture/SCHEMA_MAPPING.md` (frontend codebase root)
