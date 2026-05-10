-- Add precomputed waveform peak fields to projects.
-- Status defaults to 'skipped' so brand-new rows (created before media upload)
-- never appear stuck. The transcription-start path flips 'skipped' → 'pending'
-- when it dispatches waveform/requested.

ALTER TABLE projects ADD COLUMN waveform_object_key TEXT;
ALTER TABLE projects ADD COLUMN waveform_status TEXT NOT NULL DEFAULT 'skipped'
    CHECK (waveform_status IN ('pending', 'processing', 'ready', 'error', 'skipped'));
ALTER TABLE projects ADD COLUMN waveform_points_per_second REAL;
ALTER TABLE projects ADD COLUMN waveform_version SMALLINT;

-- Server-owned columns: reject inserts/updates from authenticated/anon roles.
-- The user-facing API layer separately omits these from its update schemas,
-- but RLS is row-level not column-level, so a browser client could otherwise
-- call supabase.from('projects').insert/update({ waveform_status: 'ready', ... }).
-- Only service_role / postgres / supabase_admin (admin client + migrations)
-- may mutate these fields.

CREATE OR REPLACE FUNCTION protect_project_waveform_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') AND TG_OP = 'INSERT' AND (
        NEW.waveform_object_key IS NOT NULL OR
        NEW.waveform_status IS DISTINCT FROM 'skipped' OR
        NEW.waveform_points_per_second IS NOT NULL OR
        NEW.waveform_version IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Waveform fields are server-managed and cannot be inserted by role %', current_user
            USING ERRCODE = '42501';
    END IF;

    IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') AND TG_OP = 'UPDATE' AND (
        NEW.waveform_object_key IS DISTINCT FROM OLD.waveform_object_key OR
        NEW.waveform_status IS DISTINCT FROM OLD.waveform_status OR
        NEW.waveform_points_per_second IS DISTINCT FROM OLD.waveform_points_per_second OR
        NEW.waveform_version IS DISTINCT FROM OLD.waveform_version
    ) THEN
        RAISE EXCEPTION 'Waveform fields are server-managed and cannot be updated by role %', current_user
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER protect_project_waveform_columns_trigger
    BEFORE INSERT OR UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION protect_project_waveform_columns();
