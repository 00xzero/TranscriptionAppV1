-- Behavioural coverage for the segment save guard
-- (20261103000000_segment_save_guard.sql, audit finding pipeline-3): only the
-- transcript's running job may replace its segments, so a late duplicate run
-- can never wipe what the user edited after completion. Run with
-- psql -v ON_ERROR_STOP=1; all fixtures are rolled back. Races with
-- completion are covered by scripts/concurrency-test-segment-save.sh.
--
--   docker exec -i supabase_db_transcription-app-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < frontend/scripts/smoke-test-segment-save-guard.sql
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
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.assert_sqlstate(text, text) TO authenticated, service_role;

-- A two-segment payload with fresh ids, as buildRpcPayload makes one.
CREATE FUNCTION pg_temp.payload(p_first text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('speakers', '[{"num": 0}]'::jsonb, 'segments', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'speaker_num', 0, 'start_ms', 0, 'end_ms', 900,
      'text', p_first, 'is_filler', false, 'algo_version', 'smoke', 'words', '[]'::jsonb),
    jsonb_build_object('id', gen_random_uuid(), 'speaker_num', 0, 'start_ms', 1000, 'end_ms', 1900,
      'text', 'Second line.', 'is_filler', false, 'algo_version', 'smoke', 'words', '[]'::jsonb)))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.payload(text) TO service_role;

-- ------------------------------------------------------------ privileges ----
SELECT pg_temp.assert_true(
  has_function_privilege('service_role', 'public.save_transcript_segments(uuid,uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.save_transcript_segments(uuid,uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.save_transcript_segments(uuid,uuid,jsonb)', 'EXECUTE')
  AND to_regprocedure('public.save_transcript_segments(uuid,jsonb)') IS NULL,
  'only the service role saves segments, and the save without a job is gone'
);

-- -------------------------------------------------------------- fixtures ----
-- T1 has one job; T2 had a failed attempt (job 1) and runs a new one (job 2).
INSERT INTO public.app_users (id, workos_user_id) VALUES
  ('d9000000-0000-4000-8000-000000000001', 'user_d9000000000040008000000000000001');
INSERT INTO public.transcripts (id, user_id, title, status) VALUES
  ('d9100000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', 'One', 'processing'),
  ('d9100000-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000001', 'Two', 'processing');
INSERT INTO public.jobs (id, transcript_id, type, status) VALUES
  ('d9200000-0000-4000-8000-000000000001', 'd9100000-0000-4000-8000-000000000001', 'transcription', 'processing'),
  ('d9200000-0000-4000-8000-000000000021', 'd9100000-0000-4000-8000-000000000002', 'transcription', 'error');
INSERT INTO public.jobs (id, transcript_id, type, status) VALUES
  ('d9200000-0000-4000-8000-000000000022', 'd9100000-0000-4000-8000-000000000002', 'transcription', 'processing');

CREATE FUNCTION pg_temp.segment_ids(p_transcript uuid) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT array_agg(id ORDER BY start_ms) FROM public.segments WHERE transcript_id = p_transcript
$$;
GRANT EXECUTE ON FUNCTION pg_temp.segment_ids(uuid) TO service_role;

-- ------------------------------------------------------ running attempt ----
SET LOCAL ROLE service_role;
SELECT public.save_transcript_segments('d9100000-0000-4000-8000-000000000001',
  'd9200000-0000-4000-8000-000000000001', pg_temp.payload('Helo wrold.'));
-- The save step's own retry, before completion, replaces what it saved.
SELECT public.save_transcript_segments('d9100000-0000-4000-8000-000000000001',
  'd9200000-0000-4000-8000-000000000001', pg_temp.payload('Helo wrold.'));
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.segments WHERE transcript_id = 'd9100000-0000-4000-8000-000000000001') = 2,
  'the running attempt saves, and saves again while it still processes'
);

-- ------------------------------------------------------ wrong attempts ----
SELECT pg_temp.assert_sqlstate($sql$SELECT public.save_transcript_segments('d9100000-0000-4000-8000-000000000001',
  'd9200000-0000-4000-8000-000000000022', pg_temp.payload('x'))$sql$, 'SP005');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.save_transcript_segments('d9100000-0000-4000-8000-000000000001',
  'd9200000-0000-4000-8000-0000000000ff', pg_temp.payload('x'))$sql$, 'SP005');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.save_transcript_segments('d9100000-0000-4000-8000-000000000002',
  'd9200000-0000-4000-8000-000000000021', pg_temp.payload('x'))$sql$, 'SP005');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.save_transcript_segments('d9100000-0000-4000-8000-0000000000ff',
  'd9200000-0000-4000-8000-000000000001', pg_temp.payload('x'))$sql$, 'SP001');
SELECT public.save_transcript_segments('d9100000-0000-4000-8000-000000000002',
  'd9200000-0000-4000-8000-000000000022', pg_temp.payload('Fresh attempt.'));
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.segments WHERE transcript_id = 'd9100000-0000-4000-8000-000000000002') = 2,
  'another transcript''s job, an unknown job and an old failed attempt are refused; the new attempt saves'
);
RESET ROLE;

-- --------------------------------------------- the reproduction, refused ----
-- Completion, then the user fixes the typo exactly as the editor does.
UPDATE public.jobs SET status = 'completed', finished_at = now() WHERE id = 'd9200000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(
  (SELECT status = 'completed' FROM public.transcripts WHERE id = 'd9100000-0000-4000-8000-000000000001'),
  'completing the job completes the transcript'
);
CREATE TEMP TABLE edited ON COMMIT DROP AS
  SELECT pg_temp.segment_ids('d9100000-0000-4000-8000-000000000001') AS ids;
GRANT SELECT ON edited TO service_role, authenticated;

SET LOCAL request.jwt.claims = '{"sub":"user_d9000000000040008000000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT count(*) FROM public.set_segment_texts_guarded(jsonb_build_array(jsonb_build_object(
  'segment_id', (SELECT ids[1] FROM edited), 'expected_revision', 0,
  'expected_text', 'Helo wrold.', 'text', 'Hello world.')));
RESET ROLE;

-- A late duplicate run, which read the job as processing, reaches its save.
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_sqlstate($sql$SELECT public.save_transcript_segments('d9100000-0000-4000-8000-000000000001',
  'd9200000-0000-4000-8000-000000000001', pg_temp.payload('Helo wrold.'))$sql$, 'SP005');
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT text = 'Hello world.' AND is_edited FROM public.segments WHERE id = (SELECT ids[1] FROM edited))
  AND pg_temp.segment_ids('d9100000-0000-4000-8000-000000000001') = (SELECT ids FROM edited),
  'a late save on a completed transcript is refused: the edit and the segment ids survive'
);

ROLLBACK;
