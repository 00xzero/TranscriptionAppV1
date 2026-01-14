-- ============================================================================
-- Phase 1: Initial Schema Migration
-- Transcription App - Supabase Foundation
-- ============================================================================

-- ============================================================================
-- Table: projects
-- ============================================================================
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

-- ============================================================================
-- Table: speakers
-- ============================================================================
CREATE TABLE speakers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT 'Speaker',
    color TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_speakers_project_id ON speakers(project_id);

-- ============================================================================
-- Table: segments
-- ============================================================================
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

-- ============================================================================
-- Table: words
-- ============================================================================
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

-- ============================================================================
-- Table: chunks
-- ============================================================================
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

-- ============================================================================
-- Table: chunk_words (junction table)
-- ============================================================================
CREATE TABLE chunk_words (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    word_id UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chunk_words_chunk_id ON chunk_words(chunk_id);
CREATE INDEX idx_chunk_words_word_id ON chunk_words(word_id);

-- ============================================================================
-- Table: watchlist (key terms)
-- ============================================================================
CREATE TABLE watchlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    canonical TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_watchlist_project_id ON watchlist(project_id);

-- ============================================================================
-- Table: jobs
-- ============================================================================
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

-- ============================================================================
-- Trigger: Auto-update updated_at
-- ============================================================================
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

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_speakers_updated_at
    BEFORE UPDATE ON speakers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_segments_updated_at
    BEFORE UPDATE ON segments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_words_updated_at
    BEFORE UPDATE ON words
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chunks_updated_at
    BEFORE UPDATE ON chunks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_watchlist_updated_at
    BEFORE UPDATE ON watchlist
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_jobs_updated_at
    BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS: Enable Row Level Security
-- ============================================================================

-- Projects (direct ownership)
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

-- Speakers (project-scoped)
ALTER TABLE speakers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own project speakers"
    ON speakers FOR ALL
    USING (
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid()
        )
    );

-- Segments (project-scoped)
ALTER TABLE segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own project segments"
    ON segments FOR ALL
    USING (
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid()
        )
    );

-- Words (nested via segment)
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

-- Chunks (project-scoped)
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own project chunks"
    ON chunks FOR ALL
    USING (
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid()
        )
    );

-- Chunk Words (nested via chunk)
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

-- Watchlist (project-scoped)
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own project watchlist"
    ON watchlist FOR ALL
    USING (
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid()
        )
    );

-- Jobs (project-scoped)
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own project jobs"
    ON jobs FOR ALL
    USING (
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid()
        )
    );

-- ============================================================================
-- Storage: Media bucket
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'media', 
    'media', 
    false,
    1610612736,  -- 1.5GB in bytes
    ARRAY['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/m4a', 'audio/aac',
          'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo']
);

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

CREATE POLICY "Users can update own files"
    ON storage.objects FOR UPDATE
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
