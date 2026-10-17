-- Behavioural coverage for public.project_people, run against the local
-- Supabase database; all fixtures are rolled back:
--   docker exec -i supabase_db_transcription-app-local psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < frontend/scripts/smoke-test-project-people.sql

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
-- A listed person by name.
CREATE FUNCTION pg_temp.person(result jsonb, person_name text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT p FROM jsonb_array_elements(result -> 'people') AS p WHERE p ->> 'name' = person_name
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.assert_sqlstate(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.person(jsonb, text) TO authenticated;

-- ------------------------------------------------------------ privileges ----
SELECT pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.project_people(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.project_people(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.project_people(uuid)', 'EXECUTE'),
  'only signed-in users can call project_people'
);

-- -------------------------------------------------------------- fixtures ----
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('11000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'project-people-smoke-a@example.test', '',
   now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'project-people-smoke-b@example.test', '',
   now(), '{}'::jsonb, '{}'::jsonb, now(), now());

-- Tree for user A:
--   Root ── Child ── Grand
--    └───── Deleting ── DeletingChild   (pruned as a whole subtree)
--   DeletingRoot                         (asked for directly; refused)
-- User B owns Other.
INSERT INTO public.projects (id, user_id, parent_id, name) VALUES
  ('61000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', null, 'Root'),
  ('61000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'Child'),
  ('61000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000002', 'Grand'),
  ('61000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'Deleting'),
  ('61000000-0000-0000-0000-000000000005', '11000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000004', 'DeletingChild'),
  ('61000000-0000-0000-0000-000000000006', '11000000-0000-0000-0000-000000000001', null, 'DeletingRoot'),
  ('61000000-0000-0000-0000-000000000020', '11000000-0000-0000-0000-000000000002', null, 'Other');

INSERT INTO public.transcripts (id, user_id, project_id, title, status, created_at) VALUES
  ('71000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'T1', 'completed', '2026-09-01T00:00:00Z'),
  ('71000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000002', 'T2', 'completed', '2026-09-02T00:00:00Z'),
  ('71000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000003', 'T3', 'completed', '2026-09-03T00:00:00Z'),
  ('71000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000004', 'T4', 'completed', '2026-09-04T00:00:00Z'),
  ('71000000-0000-0000-0000-000000000005', '11000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000005', 'T5', 'completed', '2026-09-05T00:00:00Z'),
  ('71000000-0000-0000-0000-000000000006', '11000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000020', 'T6', 'completed', '2026-09-06T00:00:00Z');

INSERT INTO public.organisations (id, user_id, name) VALUES
  ('a1000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'Example Org');
INSERT INTO public.people (id, user_id, name, preferred_color, organisation_id, hidden) VALUES
  ('91000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'Ada', '#0D9488', 'a1000000-0000-0000-0000-000000000001', false),
  ('91000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', 'Bea', '#C73E1D', null, true),
  ('91000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001', 'Cy',  '#CA8A04', null, false),
  ('91000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000002', 'Foreign', '#4F638C', null, false);

-- T1: Ada, one unlinked voice, a speaker with no segments, and an unassigned segment.
-- T2: Ada on two voices (counts once), and Bea, who is hidden.
-- T3: Cy first, then two unlinked voices in order of first appearance.
-- T4, T5: inside the deleting subtree, so never counted.
INSERT INTO public.speakers (id, transcript_id, user_id, ordinal, person_id) VALUES
  ('81000000-0000-0000-0000-000000000011', '71000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 3, '91000000-0000-0000-0000-000000000001'),
  ('81000000-0000-0000-0000-000000000012', '71000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 1, null),
  ('81000000-0000-0000-0000-000000000013', '71000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 2, null),
  ('81000000-0000-0000-0000-000000000021', '71000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', 3, '91000000-0000-0000-0000-000000000001'),
  ('81000000-0000-0000-0000-000000000022', '71000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', 4, '91000000-0000-0000-0000-000000000001'),
  ('81000000-0000-0000-0000-000000000023', '71000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', 5, '91000000-0000-0000-0000-000000000002'),
  ('81000000-0000-0000-0000-000000000031', '71000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001', 3, '91000000-0000-0000-0000-000000000003'),
  ('81000000-0000-0000-0000-000000000032', '71000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001', 2, null),
  ('81000000-0000-0000-0000-000000000033', '71000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001', 1, null),
  ('81000000-0000-0000-0000-000000000041', '71000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000001', 3, '91000000-0000-0000-0000-000000000003'),
  ('81000000-0000-0000-0000-000000000042', '71000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000001', 1, null),
  ('81000000-0000-0000-0000-000000000051', '71000000-0000-0000-0000-000000000005', '11000000-0000-0000-0000-000000000001', 3, '91000000-0000-0000-0000-000000000001'),
  ('81000000-0000-0000-0000-000000000061', '71000000-0000-0000-0000-000000000006', '11000000-0000-0000-0000-000000000002', 3, '91000000-0000-0000-0000-000000000004');

INSERT INTO public.segments (transcript_id, speaker_id, start_ms, end_ms, text) VALUES
  ('71000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000011', 0,    1000, 'ada one'),
  ('71000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000011', 1000, 3000, 'ada two'),
  ('71000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000012', 3000, 4000, 'voice'),
  ('71000000-0000-0000-0000-000000000001', null,                                   4000, 6000, 'unassigned'),
  ('71000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000021', 0,    500,  'ada first voice'),
  ('71000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000022', 500,  1500, 'ada second voice'),
  ('71000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000023', 1500, 2500, 'bea'),
  ('71000000-0000-0000-0000-000000000003', '81000000-0000-0000-0000-000000000031', 0,    2000, 'cy'),
  ('71000000-0000-0000-0000-000000000003', '81000000-0000-0000-0000-000000000032', 2000, 2500, 'second to speak'),
  ('71000000-0000-0000-0000-000000000003', '81000000-0000-0000-0000-000000000033', 2500, 2600, 'third to speak'),
  ('71000000-0000-0000-0000-000000000004', '81000000-0000-0000-0000-000000000041', 0,    1000, 'cy, deleting'),
  ('71000000-0000-0000-0000-000000000004', '81000000-0000-0000-0000-000000000042', 1000, 2000, 'voice, deleting'),
  ('71000000-0000-0000-0000-000000000005', '81000000-0000-0000-0000-000000000051', 0,    1000, 'ada, deleting child'),
  ('71000000-0000-0000-0000-000000000006', '81000000-0000-0000-0000-000000000061', 0,    1000, 'foreign');

-- deleting_at is server-managed, so it is set before dropping to authenticated.
UPDATE public.projects SET deleting_at = now()
WHERE id IN ('61000000-0000-0000-0000-000000000004', '61000000-0000-0000-0000-000000000006');

-- ------------------------------------------------------------- refusals ----
SET LOCAL request.jwt.claims = '{"role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_sqlstate(
  $$SELECT public.project_people('61000000-0000-0000-0000-000000000001')$$, '42501');

SET LOCAL request.jwt.claims = '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT pg_temp.assert_sqlstate(
  $$SELECT public.project_people('61000000-0000-0000-0000-000000000020')$$, 'SP001');
SELECT pg_temp.assert_sqlstate(
  $$SELECT public.project_people('61000000-0000-0000-0000-000000000006')$$, 'SP001');
SELECT pg_temp.assert_sqlstate(
  $$SELECT public.project_people('61000000-0000-0000-0000-0000000000ff')$$, 'SP001');

-- -------------------------------------------------------------- people ----
CREATE TEMP TABLE root_result ON COMMIT DROP AS
SELECT public.project_people('61000000-0000-0000-0000-000000000001') AS r;

SELECT pg_temp.assert_true(
  (SELECT array_agg(p ->> 'name' ORDER BY ord) FROM root_result,
     jsonb_array_elements(r -> 'people') WITH ORDINALITY AS e(p, ord)) = ARRAY['Ada', 'Cy', 'Bea'],
  'most transcripts first, then most speaking time; nobody from the deleting subtree or another account'
);

SELECT pg_temp.assert_true(
  (SELECT (pg_temp.person(r, 'Ada') ->> 'transcript_count')::int = 2
      AND (pg_temp.person(r, 'Ada') ->> 'talk_ms')::bigint = 4500
      AND (pg_temp.person(r, 'Ada') ->> 'last_seen_at')::timestamptz = '2026-09-02T00:00:00Z'
      AND pg_temp.person(r, 'Ada') ->> 'organisation_name' = 'Example Org'
   FROM root_result),
  'Ada counts once in T2 despite two voices, with her exact speaking time across the branch'
);

SELECT pg_temp.assert_true(
  (SELECT (pg_temp.person(r, 'Bea') ->> 'hidden')::boolean
      AND (pg_temp.person(r, 'Bea') ->> 'talk_ms')::bigint = 1000
      AND (pg_temp.person(r, 'Cy') ->> 'talk_ms')::bigint = 2000
      AND (pg_temp.person(r, 'Cy') ->> 'transcript_count')::int = 1
   FROM root_result),
  'hidden people are listed; the deleting subtree adds nothing to Cy'
);

-- -------------------------------------------------------------- voices ----
SELECT pg_temp.assert_true(
  (SELECT array_agg(v ->> 'title' ORDER BY ord) FROM root_result,
     jsonb_array_elements(r -> 'voices') WITH ORDINALITY AS e(v, ord)) = ARRAY['T3', 'T1'],
  'one entry per transcript with unlinked voices, newest first; the silent speaker and T4 are left out'
);

SELECT pg_temp.assert_true(
  (SELECT (r -> 'voices' -> 0 -> 'voice_ids') = '["81000000-0000-0000-0000-000000000032", "81000000-0000-0000-0000-000000000033"]'::jsonb
      AND (r -> 'voices' -> 0 -> 'peers' -> 0 ->> 'personName') = 'Cy'
      AND jsonb_array_length(r -> 'voices' -> 0 -> 'peers') = 3
      AND (r -> 'voices' -> 1 -> 'voice_ids') = '["81000000-0000-0000-0000-000000000012"]'::jsonb
   FROM root_result),
  'voices and peers follow first appearance, so labels resolve as in the editor'
);

-- --------------------------------------------- parity with the summaries ----
SELECT pg_temp.assert_true(
  (SELECT jsonb_array_length(r -> 'people')
          + (SELECT sum(jsonb_array_length(v -> 'voice_ids')) FROM jsonb_array_elements(r -> 'voices') AS v)
   FROM root_result)
  = (SELECT speaker_count FROM public.project_speaker_summaries(
       ARRAY['61000000-0000-0000-0000-000000000001']::uuid[], true)),
  'people plus voices equals the header''s whole-branch speaker count'
);

SELECT pg_temp.assert_true(
  (SELECT jsonb_array_length(r -> 'people') = 1
      AND jsonb_array_length(r -> 'voices') = 1
      AND pg_temp.person(r, 'Cy') IS NOT NULL
   FROM (SELECT public.project_people('61000000-0000-0000-0000-000000000003') AS r) AS grand),
  'a nested project covers only its own branch'
);

-- ----------------------------------- screen 2 reads appearances unchanged ----
SELECT pg_temp.assert_true(
  (SELECT (a ->> 'talk_ms')::bigint = 3000 AND (a ->> 'transcript_talk_ms')::bigint = 6000
   FROM jsonb_array_elements(public.list_person_appearances('91000000-0000-0000-0000-000000000001')) AS a
   WHERE a ->> 'transcript_id' = '71000000-0000-0000-0000-000000000001'),
  'a transcript''s talking time still includes unassigned segments'
);

ROLLBACK;
