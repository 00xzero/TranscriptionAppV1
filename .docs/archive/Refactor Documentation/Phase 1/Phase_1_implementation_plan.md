# Phase 1: Supabase Foundation - Implementation Plan

## Goal

Set up the Supabase project with complete database schema, RLS policies, and storage configuration. This creates the foundation for all subsequent phases.

---

## Prerequisites

- [x] Phase 0 completed (consolidation spike, API mapping, schema mapping)
- [ ] Supabase account access
- [ ] Supabase MCP server connected

---

## Deliverables

1. **Supabase project created** (shared for dev/prod via migrations)
2. **SQL schema** for all 8 tables
3. **RLS policies** for multi-tenant data isolation
4. **Storage bucket** (`media`) with owner-only policies
5. **Seed data** for local development
6. **Local Supabase config** in `infra/supabase/`

---

## Database Schema

### Table: `projects`

```sql
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'created',
    source_object_key TEXT,
    duration_seconds INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_status ON projects(status);
```

### Table: `speakers`

```sql
CREATE TABLE speakers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT 'Speaker',
    color TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_speakers_project_id ON speakers(project_id);
```

### Table: `segments`

```sql
CREATE TABLE segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    speaker_id UUID REFERENCES speakers(id) ON DELETE SET NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_segments_project_id ON segments(project_id);
CREATE INDEX idx_segments_speaker_id ON segments(speaker_id);
```

### Table: `words`

```sql
CREATE TABLE words (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL,
    confidence REAL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_words_segment_id ON words(segment_id);
```

### Table: `chunks`

```sql
CREATE TABLE chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    speaker_id UUID REFERENCES speakers(id) ON DELETE SET NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    source_segment_ids UUID[] DEFAULT '{}',
    is_edited BOOLEAN NOT NULL DEFAULT false,
    is_filler BOOLEAN NOT NULL DEFAULT false,
    algo_version TEXT NOT NULL DEFAULT 'v1.0',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chunks_project_id ON chunks(project_id);
CREATE INDEX idx_chunks_speaker_id ON chunks(speaker_id);
```

### Table: `chunk_words`

```sql
CREATE TABLE chunk_words (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    word_id UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chunk_words_chunk_id ON chunk_words(chunk_id);
CREATE INDEX idx_chunk_words_word_id ON chunk_words(word_id);
```

### Table: `watchlist`

```sql
CREATE TABLE watchlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    canonical TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_watchlist_project_id ON watchlist(project_id);
```

### Table: `jobs`

```sql
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    inngest_event_id TEXT,
    type TEXT NOT NULL DEFAULT 'transcribe',
    status TEXT NOT NULL DEFAULT 'queued',
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_project_id ON jobs(project_id);
CREATE INDEX idx_jobs_inngest_event_id ON jobs(inngest_event_id);
```

---

## RLS Policies

### Projects (Direct ownership)

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own projects"
    ON projects FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can create own projects"
    ON projects FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own projects"
    ON projects FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "Users can delete own projects"
    ON projects FOR DELETE
    USING (user_id = auth.uid());
```

### Project-scoped tables (speakers, segments, chunks, jobs, watchlist)

```sql
-- Pattern for all project-scoped tables
ALTER TABLE speakers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own project speakers"
    ON speakers FOR ALL
    USING (
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid()
        )
    );

-- Repeat for: segments, chunks, jobs, watchlist
```

### Deeply nested tables (words, chunk_words)

```sql
ALTER TABLE words ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own project words"
    ON words FOR ALL
    USING (
        segment_id IN (
            SELECT id FROM segments WHERE project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid()
            )
        )
    );

ALTER TABLE chunk_words ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own chunk_words"
    ON chunk_words FOR ALL
    USING (
        chunk_id IN (
            SELECT id FROM chunks WHERE project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid()
            )
        )
    );
```

---

## Storage Configuration

### Bucket: `media`

```sql
-- Create bucket (via Supabase dashboard or API)
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', false);

-- Storage policies
CREATE POLICY "Users can upload to own folder"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'media' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can read own files"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'media' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can delete own files"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'media' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );
```

**Storage path convention**: `{user_id}/{project_id}/{filename}`

---

## Updated_at Trigger

```sql
-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to all tables with updated_at
CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Repeat for: speakers, segments, words, chunks, watchlist, jobs
```

---

## Seed Data

```sql
-- Test user will be created via Supabase Auth
-- After user creation, insert sample data:

-- Sample project
INSERT INTO projects (id, user_id, title, status, duration_seconds)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '{{TEST_USER_ID}}',
    'Sample Transcription',
    'completed',
    120
);

-- Sample speakers
INSERT INTO speakers (id, project_id, label, color) VALUES
    ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Speaker 1', '#3B82F6'),
    ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Speaker 2', '#10B981');

-- Sample chunks
INSERT INTO chunks (id, project_id, speaker_id, start_ms, end_ms, text) VALUES
    ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 0, 5000, 'Hello, this is a sample transcription.'),
    ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 5500, 10000, 'Yes, this is for testing the editor.');
```

---

## Local Development Setup

### Directory Structure

```
infra/
└── supabase/
    ├── config.toml           # Supabase local config
    ├── migrations/
    │   └── 20260114000000_initial_schema.sql
    └── seed.sql              # Development seed data
```

### Docker Compose Addition

The local dev setup will use `supabase start` via CLI or a custom docker-compose service. This will be finalized in Phase 9 (Local Dev Docker).

---

## Implementation Order

1. **Create Supabase project** via MCP
2. **Run schema migration** (tables + indexes)
3. **Apply RLS policies**
4. **Create updated_at triggers**
5. **Create storage bucket + policies**
6. **Verify with test queries**
7. **Create local migration files** in `infra/supabase/migrations/`
8. **Create seed data file**

---

## Verification Plan

| Test | Method | Expected |
|:---|:---|:---|
| Tables exist | `SELECT * FROM information_schema.tables` | 8 tables |
| RLS enabled | Check policies via Supabase dashboard | All tables protected |
| Storage bucket | Upload test file | Success with signed URL |
| Seed data | Query projects | Returns sample data |

---

## References

- [SCHEMA_MAPPING.md](../SCHEMA_MAPPING.md) - Column mappings from SQLAlchemy
- [REFACTOR_PLAN.md](../REFACTOR_PLAN.md) - Phase 1 requirements
- [backend/app/models.py](../../../backend/app/models.py) - Current SQLAlchemy models
