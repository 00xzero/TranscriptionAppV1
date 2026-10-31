-- Local-only behavioural coverage for 20261016000000_job_results_storage.sql
-- and 20261016010000_drop_job_payload.sql: the server-only results bucket, the
-- job result and error columns, transition_job_status, and folder deletion.
-- Run with psql -v ON_ERROR_STOP=1; all fixtures are rolled back.
BEGIN;

CREATE FUNCTION pg_temp.assert_true(value boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %', message; END IF; END;
$$;
CREATE FUNCTION pg_temp.assert_sqlstate(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected THEN RETURN; END IF;
    RAISE EXCEPTION 'expected %, got %: %', expected, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'expected %, statement succeeded: %', expected, statement;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.assert_sqlstate(text, text) TO authenticated;

-- ------------------------------------------------------------- fixtures ----
-- User A owns T1 (with job J1 and a stored response) and T2 (inside project P,
-- with job J2 and a stored response).

INSERT INTO public.app_users (id, workos_user_id) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'user_e1000000000040008000000000000001');

INSERT INTO public.projects (id, user_id, name) VALUES
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'P');

INSERT INTO public.transcripts (id, user_id, project_id, title) VALUES
  ('e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', NULL, 'T1'),
  ('e3000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001',
   'e2000000-0000-4000-8000-000000000001', 'T2');

INSERT INTO public.jobs (id, transcript_id, type, status) VALUES
  ('e4000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'transcription', 'processing'),
  ('e4000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000002', 'transcription', 'completed');

INSERT INTO storage.objects (bucket_id, name) VALUES
  ('transcription-results', 'e1000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000001/e4000000-0000-4000-8000-000000000001.json.gz'),
  ('transcription-results', 'e1000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000002/e4000000-0000-4000-8000-000000000002.json.gz');

-- ---------------------------------------------------------------- schema ----

SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'payload')
  AND (SELECT count(*) = 4 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'jobs'
         AND column_name IN ('result_object_key', 'error_message', 'error_type', 'error_detail')),
  'jobs.payload is gone and the result and error columns exist'
);
SELECT pg_temp.assert_true(
  (SELECT NOT public AND allowed_mime_types = ARRAY['application/gzip'] AND file_size_limit = 10485760
   FROM storage.buckets WHERE id = 'transcription-results'),
  'the results bucket is private and takes only gzip'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%transcription-results%'
  ),
  'no storage policy opens the results bucket to users'
);

-- -------------------------------------------------------- column checks ----

UPDATE public.jobs
  SET result_object_key = 'e1000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000001/e4000000-0000-4000-8000-000000000001.json.gz'
  WHERE id = 'e4000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_sqlstate($sql$UPDATE public.jobs
  SET result_object_key = 'e1000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000001/e4000000-0000-4000-8000-000000000002.json.gz'
  WHERE id = 'e4000000-0000-4000-8000-000000000001'$sql$, '23514');
SELECT pg_temp.assert_sqlstate($sql$UPDATE public.jobs
  SET result_object_key = 'e1000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000002/e4000000-0000-4000-8000-000000000001.json.gz'
  WHERE id = 'e4000000-0000-4000-8000-000000000001'$sql$, '23514');
SELECT pg_temp.assert_sqlstate($sql$UPDATE public.jobs
  SET result_object_key = 'not-a-user/e3000000-0000-4000-8000-000000000001/e4000000-0000-4000-8000-000000000001.json.gz'
  WHERE id = 'e4000000-0000-4000-8000-000000000001'$sql$, '23514');
SELECT pg_temp.assert_sqlstate($sql$UPDATE public.jobs SET error_detail = repeat('x', 501)
  WHERE id = 'e4000000-0000-4000-8000-000000000001'$sql$, '23514');

-- ------------------------------------------------- transition_job_status ----

SELECT pg_temp.assert_true(
  public.transition_job_status('e4000000-0000-4000-8000-000000000001', 'error',
    '{"payload": {"error": "old shape"}}'::jsonb) ->> 'outcome' = 'invalid'
  AND (SELECT status = 'processing' FROM public.jobs WHERE id = 'e4000000-0000-4000-8000-000000000001'),
  'a field the function does not know is refused, not ignored'
);
-- Each call is its own statement: a statement reads the rows as they were
-- when it began, so it would not see the function's own update.
SELECT pg_temp.assert_true(
  public.transition_job_status('e4000000-0000-4000-8000-000000000001', 'error',
    jsonb_build_object('error_message', 'Timed out', 'error_type', 'transcription_error',
                       'error_detail', repeat('d', 600))) ->> 'outcome' = 'applied',
  'the error transition applies'
);
SELECT pg_temp.assert_true(
  (SELECT error_message = 'Timed out' AND error_type = 'transcription_error'
          AND char_length(error_detail) = 500
   FROM public.jobs WHERE id = 'e4000000-0000-4000-8000-000000000001'),
  'error fields land in their columns, detail capped at 500'
);
SELECT pg_temp.assert_true(
  public.transition_job_status('e4000000-0000-4000-8000-000000000001', 'completed') ->> 'outcome' = 'applied',
  'error to completed applies'
);
SELECT pg_temp.assert_true(
  (SELECT error_message IS NULL AND error_type IS NULL AND error_detail IS NULL
          AND result_object_key IS NOT NULL
   FROM public.jobs WHERE id = 'e4000000-0000-4000-8000-000000000001'),
  'a job recovered from error to completed carries no error and keeps its result'
);

-- ------------------------------------------------------------- browser ----

SET LOCAL request.jwt.claims = '{"sub":"user_e1000000000040008000000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'transcription-results'),
  'the owner cannot see their stored responses'
);
SELECT pg_temp.assert_sqlstate($sql$INSERT INTO storage.objects (bucket_id, name) VALUES
  ('transcription-results', 'e1000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000001/forged.json.gz')$sql$, '42501');
SELECT pg_temp.assert_true(
  (SELECT result_object_key IS NOT NULL FROM public.jobs WHERE id = 'e4000000-0000-4000-8000-000000000001'),
  'the owner can read which file a job links'
);

-- ------------------------------------------------------------ deletion ----

SELECT pg_temp.assert_true(
  (SELECT result_keys = ARRAY['e1000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000001/e4000000-0000-4000-8000-000000000001.json.gz']
      AND cardinality(media_keys) = 0 AND cardinality(waveform_keys) = 0
   FROM public.transcript_delete_inventory(ARRAY['e3000000-0000-4000-8000-000000000001']::uuid[])),
  'the inventory lists the stored response'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.delete_transcript('e3000000-0000-4000-8000-000000000001')$sql$, 'TR002');

-- What the delete route's trusted client does.
SET LOCAL storage.allow_delete_query = 'true';
RESET ROLE;
DELETE FROM storage.objects WHERE bucket_id = 'transcription-results'
  AND name LIKE 'e1000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000001/%';
SET LOCAL ROLE authenticated;
SELECT public.delete_transcript('e3000000-0000-4000-8000-000000000001');

DO $$
DECLARE inventory record;
BEGIN
  SELECT * INTO inventory FROM public.begin_project_delete('e2000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.assert_true(
    inventory.result_keys = ARRAY['e1000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000002/e4000000-0000-4000-8000-000000000002.json.gz'],
    'begin_project_delete lists the branch''s stored responses'
  );
END;
$$;
SELECT pg_temp.assert_sqlstate($sql$SELECT * FROM public.finish_project_delete('e2000000-0000-4000-8000-000000000001',
  ARRAY['e3000000-0000-4000-8000-000000000002']::uuid[])$sql$, 'PJ005');

RESET ROLE;
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = 'e4000000-0000-4000-8000-000000000001'),
  'the job went with its transcript'
);
SELECT pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.begin_project_delete(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.transcript_delete_inventory(uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.begin_project_delete(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.transcript_delete_inventory(uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.project_branch_inventory(uuid,uuid[])', 'EXECUTE'),
  'recreated delete functions keep their grants'
);

ROLLBACK;
SELECT 'job results smoke test passed' AS result;
