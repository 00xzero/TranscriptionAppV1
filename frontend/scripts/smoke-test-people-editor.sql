-- Local-only behavioural coverage for speaker identity slice 2.
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

SELECT pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.people', 'SELECT')
  AND has_table_privilege('authenticated', 'public.organisations', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.people', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.organisations', 'UPDATE')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.people'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.organisations'::regclass),
  'directory tables use read grants and RLS'
);
SELECT pg_temp.assert_true(
  to_regprocedure('public.assign_segments_to_new_speaker(uuid,text,jsonb)') IS NULL
  AND to_regprocedure('public.link_transcript_speaker(uuid,uuid,uuid)') IS NULL
  AND to_regprocedure('public.create_person_and_link_speaker(uuid,uuid,text)') IS NULL
  AND has_function_privilege('authenticated', 'public.correct_segments_to_person(uuid,jsonb,uuid,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.create_local_speaker(uuid,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.editor_create_person(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.speaker_palette()', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.person_appearances', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.segments', 'diarization_index', 'UPDATE'),
  'only guarded editor functions are callable; naming never writes a speaker in place'
);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('d0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'people-smoke-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('d0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'people-smoke-b@example.test', '', now(), '{}', '{}', now(), now());
INSERT INTO public.transcripts (id, user_id, title, status) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Alpha', 'completed'),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'Beta', 'completed'),
  ('d1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'Gamma', 'completed');
-- Alpha: Deepgram's speakers 0 and 1 (shown as Speaker 1 and Speaker 2), and
-- Host, a local name for the first voice. Gamma and Beta each have one
-- detected speaker.
INSERT INTO public.speakers (id, transcript_id, user_id, ordinal, diarization_index, custom_label) VALUES
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 1, 0, NULL),
  ('d2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 2, 1, NULL),
  ('d2000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 3, NULL, 'Host'),
  ('d2000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 1, 0, NULL),
  ('d2000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 1, 0, NULL);
INSERT INTO public.segments (id, transcript_id, speaker_id, diarization_index, start_ms, end_ms, text) VALUES
  ('d3000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000005', 0, 0, 1000, 'one'),
  ('d3000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000005', 0, 1000, 2000, 'two'),
  ('d3000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002', 1, 2000, 3000, 'three'),
  ('d3000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000004', 0, 0, 1000, 'gamma');
INSERT INTO public.segments (id, transcript_id, speaker_id, diarization_index, start_ms, end_ms, text) VALUES
  ('d3000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000003', NULL, NULL, 1000, 2000, 'unknown');

-- Remove relies on this: every segment with a Deepgram number has a detected
-- speaker for that number in its transcript. Holds for all data, not only the
-- fixtures, because the migration backfilled one for every number.
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.segments AS sg
    WHERE sg.diarization_index IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.speakers AS d
      WHERE d.transcript_id = sg.transcript_id AND d.diarization_index = sg.diarization_index)),
  'every Deepgram number has a detected speaker to go back to'
);

-- Alex's appearances outside Alpha, as the Alpha picker reports them.
CREATE FUNCTION pg_temp.alex_elsewhere() RETURNS jsonb LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(
    public.editor_people_context('d1000000-0000-4000-8000-000000000001')->'people') AS e
  WHERE e->>'name' = 'Alex'
$$;
GRANT EXECUTE ON FUNCTION pg_temp.alex_elsewhere() TO authenticated;

CREATE TEMP TABLE action_result (name text PRIMARY KEY, data jsonb) ON COMMIT DROP;
GRANT SELECT, INSERT, UPDATE ON action_result TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- Identifying Speaker 1 moves all its segments to a new speaker linked to the
-- new person; Deepgram's speaker keeps no name.
INSERT INTO action_result VALUES ('first', public.correct_segments_to_person(
  'd1000000-0000-4000-8000-000000000001',
  '[{"segment_id":"d3000000-0000-4000-8000-000000000003","expected_speaker_id":"d2000000-0000-4000-8000-000000000002"}]',
  NULL, ' Alex '));
SELECT pg_temp.assert_true(
  (SELECT data->'speaker'->>'person_id' = data->'person'->>'id'
    AND data->'speaker'->>'diarization_index' IS NULL
    AND data->'person'->>'name' = 'Alex' AND data->'person'->>'organisation_id' IS NULL
    AND data->'person'->>'preferred_color' = '#4F638C' FROM action_result WHERE name = 'first')
  AND (SELECT speaker_id = (SELECT (data->'speaker'->>'id')::uuid FROM action_result WHERE name = 'first')
    FROM public.segments WHERE id = 'd3000000-0000-4000-8000-000000000003')
  AND (SELECT person_id IS NULL AND custom_label IS NULL FROM public.speakers
    WHERE id = 'd2000000-0000-4000-8000-000000000002'),
  'identifying moves the segments to a named speaker with the first palette colour'
);

SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_speaker_custom_label(
  'd2000000-0000-4000-8000-000000000001', NULL, 'Named')$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_speaker_custom_label(
  'd2000000-0000-4000-8000-000000000005', 'Stale', 'Wrong')$sql$, 'SP002');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_speaker_custom_label(
  'd2000000-0000-4000-8000-000000000005', 'Host', ' ')$sql$, 'SP003');
SELECT pg_temp.assert_true(
  (SELECT custom_label = 'Guest' FROM public.set_speaker_custom_label(
    'd2000000-0000-4000-8000-000000000005', 'Host', ' Guest ')),
  'a local label is renamed, never cleared, and a detected speaker takes none'
);

SELECT pg_temp.assert_true(
  (SELECT jsonb_array_length(public.editor_people_context('d1000000-0000-4000-8000-000000000001')->'people') = 1)
  AND (SELECT NOT (public.editor_people_context('d1000000-0000-4000-8000-000000000001') ? 'organisations'))
  AND (SELECT count(*) = 1 FROM public.people)
  AND (SELECT (e->>'other_transcript_count')::int = 0 AND e->>'last_other_title' IS NULL
    FROM pg_temp.alex_elsewhere() AS e),
  'picker sees owned person; the open transcript is not counted as elsewhere'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.editor_people_context('d1000000-0000-4000-8000-000000000002')$sql$, 'SP001');
SET LOCAL request.jwt.claims = '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.people)
  AND (SELECT count(*) = 0 FROM public.organisations), 'RLS hides the other account directory');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.editor_people_context(
  'd1000000-0000-4000-8000-000000000001')$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.create_local_speaker('d1000000-0000-4000-8000-000000000001', 'Mine',
  '[{"segment_id":"d3000000-0000-4000-8000-000000000001","expected_speaker_id":"d2000000-0000-4000-8000-000000000005"}]')$sql$, 'SP001');
SET LOCAL request.jwt.claims = '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}';

INSERT INTO action_result VALUES ('correction', public.correct_segments_to_person(
  'd1000000-0000-4000-8000-000000000001',
  '[{"segment_id":"d3000000-0000-4000-8000-000000000001","expected_speaker_id":"d2000000-0000-4000-8000-000000000005"}]',
  (SELECT (data->'person'->>'id')::uuid FROM action_result WHERE name = 'first')));
SELECT pg_temp.assert_true(
  (SELECT c.data->'speaker'->>'id' = f.data->'speaker'->>'id'
    FROM action_result AS c, action_result AS f WHERE c.name = 'correction' AND f.name = 'first'),
  'correction reuses the person''s speaker in this transcript'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.correct_segments_to_person(
  'd1000000-0000-4000-8000-000000000001',
  '[{"segment_id":"d3000000-0000-4000-8000-000000000001","expected_speaker_id":null}]',
  (SELECT (data->'person'->>'id')::uuid FROM action_result WHERE name = 'first'))$sql$, 'SP002');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.people), 'stale correction creates nothing');

INSERT INTO action_result VALUES ('new', public.correct_segments_to_person(
  'd1000000-0000-4000-8000-000000000001',
  '[{"segment_id":"d3000000-0000-4000-8000-000000000002","expected_speaker_id":"d2000000-0000-4000-8000-000000000005"}]',
  NULL, 'Blair'));
SELECT pg_temp.assert_true(
  (SELECT (data->'speaker'->>'ordinal')::int = 5
    AND data->'person'->>'preferred_color' = '#C73E1D' FROM action_result WHERE name = 'new')
  AND (SELECT count(*) = 2 FROM public.people),
  'new correction allocates next free ordinal and least-used colour'
);
SELECT public.undo_created_person_action(
  'd1000000-0000-4000-8000-000000000001',
  (SELECT (data->'person'->>'id')::uuid FROM action_result WHERE name = 'new'),
  (SELECT (data->'person'->>'updated_at')::timestamptz FROM action_result WHERE name = 'new'),
  (SELECT (data->'speaker'->>'id')::uuid FROM action_result WHERE name = 'new'),
  (SELECT jsonb_build_array(jsonb_build_object('segment_id', 'd3000000-0000-4000-8000-000000000002',
    'expected_speaker_id', (data->'speaker'->>'id')::uuid,
    'speaker_id', 'd2000000-0000-4000-8000-000000000005')) FROM action_result WHERE name = 'new'));
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.people)
  AND (SELECT speaker_id = 'd2000000-0000-4000-8000-000000000005'::uuid FROM public.segments WHERE id = 'd3000000-0000-4000-8000-000000000002'),
  'Undo removes unchanged, unreferenced person and restores assignment'
);

-- A correction in Gamma is an appearance there; once undone, the speaker it
-- created stays linked but silent and is no longer an appearance.
INSERT INTO action_result VALUES ('gamma', public.correct_segments_to_person(
  'd1000000-0000-4000-8000-000000000003',
  '[{"segment_id":"d3000000-0000-4000-8000-000000000004","expected_speaker_id":"d2000000-0000-4000-8000-000000000004"}]',
  (SELECT (data->'person'->>'id')::uuid FROM action_result WHERE name = 'first')));
SELECT pg_temp.assert_true(
  (SELECT (e->>'other_transcript_count')::int = 1 AND e->>'last_other_title' = 'Gamma'
    FROM pg_temp.alex_elsewhere() AS e),
  'another transcript with segments counts as an appearance elsewhere'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.undo_created_person_action(
  'd1000000-0000-4000-8000-000000000001',
  (SELECT (data->'person'->>'id')::uuid FROM action_result WHERE name = 'first'),
  (SELECT (data->'person'->>'updated_at')::timestamptz FROM action_result WHERE name = 'first'),
  (SELECT (data->'speaker'->>'id')::uuid FROM action_result WHERE name = 'first'),
  '[{"segment_id":"d3000000-0000-4000-8000-000000000003","expected_speaker_id":null,"speaker_id":null}]')$sql$, 'SP002');
-- Remove: the segment goes back to the detected speaker Deepgram gave it.
SELECT public.reassign_segments('d1000000-0000-4000-8000-000000000003',
  (SELECT jsonb_build_array(jsonb_build_object('segment_id', 'd3000000-0000-4000-8000-000000000004',
    'expected_speaker_id', (data->'speaker'->>'id')::uuid,
    'speaker_id', 'd2000000-0000-4000-8000-000000000004')) FROM action_result WHERE name = 'gamma'));
SELECT pg_temp.assert_true(
  (SELECT (e->>'other_transcript_count')::int = 0 AND e->>'last_other_title' IS NULL
    FROM pg_temp.alex_elsewhere() AS e)
  AND (SELECT person_id IS NOT NULL FROM public.speakers
    WHERE id = (SELECT (data->'speaker'->>'id')::uuid FROM action_result WHERE name = 'gamma')),
  'a linked speaker with no segments is not an appearance'
);

-- Naming a detected speaker in this transcript moves its segments to a new
-- local speaker; a refused call creates nothing.
SELECT pg_temp.assert_sqlstate($sql$SELECT public.create_local_speaker('d1000000-0000-4000-8000-000000000003', 'Guest',
  '[{"segment_id":"d3000000-0000-4000-8000-000000000004","expected_speaker_id":null}]')$sql$, 'SP002');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.create_local_speaker('d1000000-0000-4000-8000-000000000003', ' ',
  '[{"segment_id":"d3000000-0000-4000-8000-000000000004","expected_speaker_id":"d2000000-0000-4000-8000-000000000004"}]')$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate(format($sql$SELECT public.create_local_speaker('d1000000-0000-4000-8000-000000000003', %L,
  '[{"segment_id":"d3000000-0000-4000-8000-000000000004","expected_speaker_id":"d2000000-0000-4000-8000-000000000004"}]')$sql$,
  repeat('x', 51)), 'SP003');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 FROM public.speakers WHERE transcript_id = 'd1000000-0000-4000-8000-000000000003'),
  'a refused local name creates no speaker'
);
INSERT INTO action_result VALUES ('local', public.create_local_speaker('d1000000-0000-4000-8000-000000000003', ' Guest ',
  '[{"segment_id":"d3000000-0000-4000-8000-000000000004","expected_speaker_id":"d2000000-0000-4000-8000-000000000004"}]'));
SELECT pg_temp.assert_true(
  (SELECT data->'speaker'->>'custom_label' = 'Guest' AND data->'speaker'->>'diarization_index' IS NULL
    AND data->'assignments'->0->>'speaker_id' = data->'speaker'->>'id' FROM action_result WHERE name = 'local')
  AND (SELECT custom_label IS NULL FROM public.speakers WHERE id = 'd2000000-0000-4000-8000-000000000004'),
  'a local name lives on a new speaker, and Deepgram''s speaker keeps none'
);

-- A corrected passage with no Deepgram number can be removed back to Unknown.
INSERT INTO action_result VALUES ('unknown', public.correct_segments_to_person(
  'd1000000-0000-4000-8000-000000000003',
  '[{"segment_id":"d3000000-0000-4000-8000-000000000005","expected_speaker_id":null}]',
  (SELECT (data->'person'->>'id')::uuid FROM action_result WHERE name = 'first')));
SELECT public.reassign_segments('d1000000-0000-4000-8000-000000000003',
  (SELECT jsonb_build_array(jsonb_build_object('segment_id', 'd3000000-0000-4000-8000-000000000005',
    'expected_speaker_id', (data->'speaker'->>'id')::uuid, 'speaker_id', NULL))
   FROM action_result WHERE name = 'unknown'));
SELECT pg_temp.assert_true(
  (SELECT speaker_id IS NULL AND diarization_index IS NULL FROM public.segments
   WHERE id = 'd3000000-0000-4000-8000-000000000005'),
  'Remove returns a corrected segment without a Deepgram number to Unknown'
);

RESET ROLE;
-- A cross-account organisation and person cannot be referenced even by
-- privileged direct writes; the composite owner foreign keys enforce this.
INSERT INTO public.organisations (id, user_id, name) VALUES
  ('d4000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Example Org');
INSERT INTO public.people (id, user_id, name, preferred_color) VALUES
  ('d5000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Alex', '#4F638C');
SELECT pg_temp.assert_sqlstate($sql$INSERT INTO public.people (user_id,name,organisation_id,preferred_color)
  VALUES ('d0000000-0000-4000-8000-000000000002','Cross user',
  'd4000000-0000-4000-8000-000000000001','#4F638C')$sql$, '23503');
SELECT pg_temp.assert_sqlstate($sql$UPDATE public.speakers SET diarization_index = NULL,
  person_id = 'd5000000-0000-4000-8000-000000000001'
  WHERE id = 'd2000000-0000-4000-8000-000000000003'$sql$, '23503');
SELECT pg_temp.assert_sqlstate($sql$INSERT INTO public.people (user_id, name, preferred_color)
  VALUES ('d0000000-0000-4000-8000-000000000001', 'Off palette', '#000000')$sql$, '23514');
SELECT pg_temp.assert_sqlstate($sql$UPDATE public.speakers SET custom_label = 'Named'
  WHERE id = 'd2000000-0000-4000-8000-000000000001'$sql$, '23514');
SELECT pg_temp.assert_sqlstate($sql$UPDATE public.speakers SET person_id = 'd5000000-0000-4000-8000-000000000001'
  WHERE id = 'd2000000-0000-4000-8000-000000000001'$sql$, '23514');
ROLLBACK;
SELECT 'people editor smoke test passed' AS result;
