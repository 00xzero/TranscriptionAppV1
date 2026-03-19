-- =========================================================================
-- Reconcile failed_events + supporting indexes across local and remote
-- =========================================================================

-- Adopt the canonical failed_events timestamp name used on remote.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'failed_events'
      AND column_name = 'created_at'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'failed_events'
      AND column_name = 'failed_at'
  ) THEN
    ALTER TABLE public.failed_events
      RENAME COLUMN created_at TO failed_at;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'failed_events'
      AND column_name = 'failed_at'
  ) THEN
    ALTER TABLE public.failed_events
      ALTER COLUMN failed_at SET DEFAULT now();
  END IF;
END $$;

ALTER TABLE public.failed_events
  ALTER COLUMN event_data DROP DEFAULT;

DROP INDEX IF EXISTS public.idx_failed_events_project_id;
DROP INDEX IF EXISTS public.idx_failed_events_job_id;
DROP INDEX IF EXISTS public.idx_failed_events_created_at;
DROP INDEX IF EXISTS public.idx_failed_events_resolved_at;

CREATE INDEX IF NOT EXISTS idx_failed_events_project
  ON public.failed_events USING btree (project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_failed_events_job
  ON public.failed_events USING btree (job_id)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_failed_events_unresolved
  ON public.failed_events USING btree (failed_at DESC)
  WHERE resolved_at IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_jobs_project_id_idempotency_key'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'idx_jobs_idempotency_key'
    ) THEN
      DROP INDEX public.idx_jobs_project_id_idempotency_key;
    ELSE
      ALTER INDEX public.idx_jobs_project_id_idempotency_key
        RENAME TO idx_jobs_idempotency_key;
    END IF;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency_key
  ON public.jobs USING btree (project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Keep timeout scan indexes present in every environment.
CREATE INDEX IF NOT EXISTS idx_jobs_type_status_started_at
  ON public.jobs(type, status, started_at);

CREATE INDEX IF NOT EXISTS idx_jobs_type_status_created_at
  ON public.jobs(type, status, created_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'failed_events'
      AND policyname = 'Service role has full access to failed_events'
  ) THEN
    CREATE POLICY "Service role has full access to failed_events"
      ON public.failed_events
      AS PERMISSIVE
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
