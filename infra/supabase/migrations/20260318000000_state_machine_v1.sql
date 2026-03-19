-- =========================================================================
-- State Machine V1: Backfill + constraints + RPC + triggers + audit
-- =========================================================================

-- =========================================================================
-- Part A: Backfill legacy values
-- =========================================================================

-- Normalize job types
UPDATE jobs SET type = 'transcription' WHERE type = 'transcribe';
ALTER TABLE public.jobs ALTER COLUMN type SET DEFAULT 'transcription';

-- Normalize status values
UPDATE jobs SET status = 'error' WHERE status = 'failed';
UPDATE projects SET status = 'completed' WHERE status = 'complete';
UPDATE projects SET status = 'error' WHERE status = 'failed';

-- =========================================================================
-- Part B: CHECK constraints (rollout-safe: NOT VALID then VALIDATE)
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_jobs_status'
      AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT chk_jobs_status
      CHECK (status IN ('queued', 'processing', 'completed', 'error')) NOT VALID;
  END IF;

  ALTER TABLE public.jobs VALIDATE CONSTRAINT chk_jobs_status;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_projects_status'
      AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT chk_projects_status
      CHECK (status IN ('created', 'queued', 'processing', 'completed', 'error')) NOT VALID;
  END IF;

  ALTER TABLE public.projects VALIDATE CONSTRAINT chk_projects_status;
END $$;

-- =========================================================================
-- Part C: Partial unique index — one active transcription job per project
-- =========================================================================

-- Clean up any existing duplicate active transcription jobs before creating
-- the unique index. For each project with duplicates, prefer keeping an
-- in-flight processing job; otherwise keep the newest queued job.
WITH ranked AS (
  SELECT id, project_id,
    ROW_NUMBER() OVER (
      PARTITION BY project_id
      ORDER BY
        CASE status
          WHEN 'processing' THEN 0
          ELSE 1
        END,
        created_at DESC,
        id DESC
    ) AS rn
  FROM jobs
  WHERE type = 'transcription' AND status IN ('queued', 'processing')
)
UPDATE jobs SET
  status = 'error',
  finished_at = now(),
  payload = '{"error": "Duplicate active job resolved during migration", "error_type": "migration_cleanup"}'::jsonb
FROM ranked
WHERE jobs.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_one_active_per_project
  ON jobs(project_id)
  WHERE type = 'transcription' AND status IN ('queued', 'processing');

-- =========================================================================
-- Part D: job_events audit table
-- =========================================================================

CREATE TABLE IF NOT EXISTS job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id);
CREATE INDEX IF NOT EXISTS idx_job_events_created_at ON job_events(created_at);

ALTER TABLE job_events ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- Part E: transition_job_status RPC — atomic update + audit
-- =========================================================================

CREATE OR REPLACE FUNCTION transition_job_status(
  p_job_id UUID,
  p_to_status TEXT,
  p_extra_fields JSONB DEFAULT '{}',
  p_metadata JSONB DEFAULT '{}',
  p_context TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status TEXT;
  v_project_id UUID;
  v_valid_targets TEXT[];
  v_rows_updated INT;
  v_caller_uid UUID;
BEGIN
  -- Read current status with row lock
  SELECT status, project_id INTO v_current_status, v_project_id
  FROM jobs WHERE id = p_job_id FOR UPDATE;

  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid', 'error', 'Job not found');
  END IF;

  -- Ownership check: if called by an authenticated user (not service_role),
  -- verify the caller owns the project associated with this job.
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM projects WHERE id = v_project_id AND user_id = v_caller_uid
    ) THEN
      RETURN jsonb_build_object('outcome', 'invalid', 'error', 'Not authorized');
    END IF;
  END IF;

  -- Idempotent: already at target
  IF v_current_status = p_to_status THEN
    RETURN jsonb_build_object('outcome', 'noop', 'previous_status', v_current_status);
  END IF;

  -- Validate transition
  v_valid_targets := CASE v_current_status
    WHEN 'queued' THEN ARRAY['processing', 'error']
    WHEN 'processing' THEN ARRAY['completed', 'error']
    ELSE ARRAY[]::TEXT[]
  END;

  IF NOT (p_to_status = ANY(v_valid_targets)) THEN
    RETURN jsonb_build_object(
      'outcome', 'invalid',
      'error', format('Invalid transition: %s -> %s', v_current_status, p_to_status),
      'previous_status', v_current_status
    );
  END IF;

  -- Perform update with optimistic lock
  UPDATE jobs SET
    status = p_to_status,
    finished_at = COALESCE((p_extra_fields->>'finished_at')::timestamptz, finished_at),
    started_at = COALESCE((p_extra_fields->>'started_at')::timestamptz, started_at),
    inngest_event_id = COALESCE(p_extra_fields->>'inngest_event_id', inngest_event_id),
    payload = CASE
      WHEN p_extra_fields ? 'payload' THEN (p_extra_fields->'payload')
      ELSE payload
    END,
    updated_at = now()
  WHERE id = p_job_id AND status = v_current_status;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'previous_status', v_current_status);
  END IF;

  -- Write audit event
  INSERT INTO job_events (job_id, from_status, to_status, metadata)
  VALUES (p_job_id, v_current_status, p_to_status,
    p_metadata || jsonb_build_object('context', COALESCE(p_context, 'unknown'))
  );

  RETURN jsonb_build_object('outcome', 'applied', 'previous_status', v_current_status);
END;
$$ LANGUAGE plpgsql;

-- Security: restrict to service_role only (all callers use admin client).
-- The ownership check inside the function is defense-in-depth in case
-- this grant is ever widened to authenticated.
REVOKE ALL ON FUNCTION transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) FROM anon;
REVOKE ALL ON FUNCTION transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) TO service_role;

-- =========================================================================
-- Part F: Project status derivation trigger
-- =========================================================================

CREATE OR REPLACE FUNCTION derive_project_status()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project_id UUID;
  v_new_status TEXT;
BEGIN
  -- Determine project_id (NEW is null on DELETE)
  v_project_id := COALESCE(NEW.project_id, OLD.project_id);

  -- Only consider transcription jobs
  SELECT
    CASE
      WHEN bool_or(status = 'processing') THEN 'processing'
      WHEN bool_or(status = 'queued') THEN 'queued'
      ELSE (
        SELECT status FROM jobs
        WHERE project_id = v_project_id AND type = 'transcription'
        ORDER BY created_at DESC LIMIT 1
      )
    END
  INTO v_new_status
  FROM jobs
  WHERE project_id = v_project_id AND type = 'transcription';

  -- If no transcription jobs remain, revert to 'created'
  IF v_new_status IS NULL THEN
    UPDATE projects SET status = 'created'
    WHERE id = v_project_id AND status IS DISTINCT FROM 'created';
  ELSE
    UPDATE projects SET status = v_new_status
    WHERE id = v_project_id AND status IS DISTINCT FROM v_new_status;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Fires on INSERT and DELETE
DROP TRIGGER IF EXISTS trg_derive_project_status ON public.jobs;
CREATE TRIGGER trg_derive_project_status
  AFTER INSERT OR DELETE ON jobs
  FOR EACH ROW EXECUTE FUNCTION derive_project_status();

-- Fires on UPDATE of status column only
DROP TRIGGER IF EXISTS trg_derive_project_status_update ON public.jobs;
CREATE TRIGGER trg_derive_project_status_update
  AFTER UPDATE OF status ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION derive_project_status();

-- =========================================================================
-- Part G: Audit trigger for INSERT (initial job creation)
-- =========================================================================

CREATE OR REPLACE FUNCTION log_job_insert()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO job_events (job_id, from_status, to_status, metadata)
  VALUES (NEW.id, NULL, NEW.status, '{}');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_job_insert ON public.jobs;
CREATE TRIGGER trg_log_job_insert
  AFTER INSERT ON jobs
  FOR EACH ROW EXECUTE FUNCTION log_job_insert();

-- =========================================================================
-- Part H: One-time backfill of existing project statuses
-- =========================================================================

UPDATE projects p
SET status = derived.new_status
FROM (
  SELECT
    j.project_id,
    CASE
      WHEN bool_or(j.status = 'processing') THEN 'processing'
      WHEN bool_or(j.status = 'queued') THEN 'queued'
      ELSE (
        SELECT j2.status FROM jobs j2
        WHERE j2.project_id = j.project_id AND j2.type = 'transcription'
        ORDER BY j2.created_at DESC LIMIT 1
      )
    END AS new_status
  FROM jobs j
  WHERE j.type = 'transcription'
  GROUP BY j.project_id
) derived
WHERE p.id = derived.project_id
  AND p.status IS DISTINCT FROM derived.new_status;
