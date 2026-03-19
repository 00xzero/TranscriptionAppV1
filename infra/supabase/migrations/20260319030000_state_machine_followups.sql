-- =========================================================================
-- Follow-up fixes after state-machine rollout
-- =========================================================================

-- Bring forward any rows created after the original rollout but before the
-- canonical job type default was corrected.
UPDATE public.jobs
SET type = 'transcription'
WHERE type = 'transcribe';

ALTER TABLE public.jobs
  ALTER COLUMN type SET DEFAULT 'transcription';

-- If an environment previously missed the duplicate cleanup, reconcile it
-- before re-asserting the active transcription uniqueness invariant.
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_one_active_per_project
  ON public.jobs(project_id)
  WHERE type = 'transcription' AND status IN ('queued', 'processing');
