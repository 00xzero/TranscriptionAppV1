-- =========================================================================
-- Re-derive project status after job type normalization follow-up
-- =========================================================================

-- Some environments applied the job type backfill after the project-status
-- derivation trigger was introduced. Updating jobs.type does not fire that
-- trigger, so re-compute project.status from the current transcription jobs.
WITH derived AS (
  SELECT
    p.id AS project_id,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.jobs j
        WHERE j.project_id = p.id
          AND j.type = 'transcription'
          AND j.status = 'processing'
      ) THEN 'processing'
      WHEN EXISTS (
        SELECT 1
        FROM public.jobs j
        WHERE j.project_id = p.id
          AND j.type = 'transcription'
          AND j.status = 'queued'
      ) THEN 'queued'
      ELSE (
        SELECT j.status
        FROM public.jobs j
        WHERE j.project_id = p.id
          AND j.type = 'transcription'
        ORDER BY j.created_at DESC, j.id DESC
        LIMIT 1
      )
    END AS new_status
  FROM public.projects p
)
UPDATE public.projects p
SET status = COALESCE(derived.new_status, 'created')
FROM derived
WHERE p.id = derived.project_id
  AND p.status IS DISTINCT FROM COALESCE(derived.new_status, 'created');
