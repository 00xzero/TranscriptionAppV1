-- =========================================================================
-- Reconcile state-machine schema objects across already-migrated environments
-- =========================================================================

-- Ensure rollout-safe state-machine constraints exist and are validated.
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

-- Re-assert the canonical job type default for any environment that still
-- has the legacy 'transcribe' default from the initial schema.
ALTER TABLE public.jobs
  ALTER COLUMN type SET DEFAULT 'transcription';

-- Resolve duplicate active transcription jobs before enforcing the unique
-- index. Prefer an in-flight processing job, otherwise keep the newest queued.
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
  FROM public.jobs
  WHERE type = 'transcription' AND status IN ('queued', 'processing')
)
UPDATE public.jobs
SET status = 'error',
    finished_at = now(),
    payload = '{"error": "Duplicate active job resolved during migration", "error_type": "migration_cleanup"}'::jsonb
FROM ranked
WHERE public.jobs.id = ranked.id
  AND ranked.rn > 1;

-- Ensure the active transcription uniqueness invariant exists everywhere.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_one_active_per_project
  ON public.jobs(project_id)
  WHERE type = 'transcription' AND status IN ('queued', 'processing');

-- Ensure audit table and indexes exist.
CREATE TABLE IF NOT EXISTS public.job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON public.job_events(job_id);
CREATE INDEX IF NOT EXISTS idx_job_events_created_at ON public.job_events(created_at);

ALTER TABLE public.job_events ENABLE ROW LEVEL SECURITY;

-- Re-assert the canonical transition RPC definition and permissions.
CREATE OR REPLACE FUNCTION public.transition_job_status(
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
  SELECT status, project_id INTO v_current_status, v_project_id
  FROM public.jobs WHERE id = p_job_id FOR UPDATE;

  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid', 'error', 'Job not found');
  END IF;

  v_caller_uid := auth.uid();
  IF v_caller_uid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.projects WHERE id = v_project_id AND user_id = v_caller_uid
    ) THEN
      RETURN jsonb_build_object('outcome', 'invalid', 'error', 'Not authorized');
    END IF;
  END IF;

  IF v_current_status = p_to_status THEN
    RETURN jsonb_build_object('outcome', 'noop', 'previous_status', v_current_status);
  END IF;

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

  UPDATE public.jobs SET
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

  INSERT INTO public.job_events (job_id, from_status, to_status, metadata)
  VALUES (p_job_id, v_current_status, p_to_status,
    p_metadata || jsonb_build_object('context', COALESCE(p_context, 'unknown'))
  );

  RETURN jsonb_build_object('outcome', 'applied', 'previous_status', v_current_status);
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) TO service_role;

-- Re-assert trigger functions and triggers.
CREATE OR REPLACE FUNCTION public.derive_project_status()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project_id UUID;
  v_new_status TEXT;
BEGIN
  v_project_id := COALESCE(NEW.project_id, OLD.project_id);

  SELECT
    CASE
      WHEN bool_or(status = 'processing') THEN 'processing'
      WHEN bool_or(status = 'queued') THEN 'queued'
      ELSE (
        SELECT status FROM public.jobs
        WHERE project_id = v_project_id AND type = 'transcription'
        ORDER BY created_at DESC LIMIT 1
      )
    END
  INTO v_new_status
  FROM public.jobs
  WHERE project_id = v_project_id AND type = 'transcription';

  IF v_new_status IS NULL THEN
    UPDATE public.projects SET status = 'created'
    WHERE id = v_project_id AND status IS DISTINCT FROM 'created';
  ELSE
    UPDATE public.projects SET status = v_new_status
    WHERE id = v_project_id AND status IS DISTINCT FROM v_new_status;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_derive_project_status ON public.jobs;
CREATE TRIGGER trg_derive_project_status
  AFTER INSERT OR DELETE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.derive_project_status();

DROP TRIGGER IF EXISTS trg_derive_project_status_update ON public.jobs;
CREATE TRIGGER trg_derive_project_status_update
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.derive_project_status();

CREATE OR REPLACE FUNCTION public.log_job_insert()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.job_events (job_id, from_status, to_status, metadata)
  VALUES (NEW.id, NULL, NEW.status, '{}');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_job_insert ON public.jobs;
CREATE TRIGGER trg_log_job_insert
  AFTER INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.log_job_insert();
