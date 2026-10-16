-- Drop jobs.payload once every stored Deepgram response has moved to the
-- transcription-results bucket (20261016000000_job_results_storage.sql).
--
-- Refuses while a response is still only in the column, so pushing this before
-- scripts/move-job-payloads-to-storage.ts has run cannot lose one.

DO $$
DECLARE
  v_unmoved bigint;
BEGIN
  SELECT count(*) INTO v_unmoved
  FROM public.jobs
  WHERE payload ? 'deepgram' AND result_object_key IS NULL;

  IF v_unmoved > 0 THEN
    RAISE EXCEPTION '% job(s) still hold a Deepgram response in jobs.payload; run scripts/move-job-payloads-to-storage.ts first', v_unmoved;
  END IF;
END;
$$;

ALTER TABLE public.jobs DROP COLUMN payload;
