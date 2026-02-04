-- =========================================================================
-- Add idempotency key support and failed_events dead letter table
-- =========================================================================

-- Jobs: idempotency key to de-dupe start requests
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_project_id_idempotency_key
    ON jobs(project_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Indexes to support timeout scans
CREATE INDEX IF NOT EXISTS idx_jobs_type_status_started_at
    ON jobs(type, status, started_at);

CREATE INDEX IF NOT EXISTS idx_jobs_type_status_created_at
    ON jobs(type, status, created_at);

-- Failed events table for dead letter queue (DLQ)
CREATE TABLE IF NOT EXISTS failed_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name TEXT NOT NULL,
    event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT NOT NULL,
    error_stack TEXT,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_failed_events_project_id ON failed_events(project_id);
CREATE INDEX IF NOT EXISTS idx_failed_events_job_id ON failed_events(job_id);
CREATE INDEX IF NOT EXISTS idx_failed_events_created_at ON failed_events(created_at);
CREATE INDEX IF NOT EXISTS idx_failed_events_resolved_at ON failed_events(resolved_at);

-- RLS is intentionally enabled with NO policies. This table is designed to be
-- accessed ONLY via the Supabase service role (admin client) for DLQ management
-- and admin investigation. Application users should never directly query this table.
-- If application-level access is needed in the future, add explicit policies here.
ALTER TABLE failed_events ENABLE ROW LEVEL SECURITY;

