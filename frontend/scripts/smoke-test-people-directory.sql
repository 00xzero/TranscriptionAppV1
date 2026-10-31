-- Local-only behavioural coverage for speaker identity slice 3: the People
-- directory functions. Run with psql -v ON_ERROR_STOP=1; all fixtures are
-- rolled back.
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

-- ------------------------------------------------------------ privileges ----
SELECT pg_temp.assert_true(
  (SELECT bool_and(has_function_privilege('authenticated', f, 'EXECUTE')
      AND NOT has_function_privilege('anon', f, 'EXECUTE')
      AND NOT has_function_privilege('service_role', f, 'EXECUTE'))
   FROM unnest(ARRAY[
     'public.people_directory()', 'public.list_person_appearances(uuid)',
     'public.merge_people_preview(uuid,uuid[])', 'public.create_person(text)',
     'public.set_person_organisation(uuid,uuid,uuid,text)', 'public.set_person_color(uuid,text,text)',
     'public.set_person_hidden(uuid,boolean)', 'public.delete_person(uuid)',
     'public.remove_person_from_transcript(uuid,uuid)', 'public.merge_people(uuid,uuid[],jsonb)',
     'public.rename_organisation(uuid,text,text)', 'public.delete_organisation(uuid)'
   ]) AS f)
  AND NOT has_function_privilege('authenticated', 'public.check_merge_request(uuid,uuid,uuid[])', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.people', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.people', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.people', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.organisations', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.organisations', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.organisations', 'DELETE'),
  'directory functions are for signed-in users only, and the tables stay read-only'
);

SELECT pg_temp.assert_true(
  to_regprocedure('public.merge_people(uuid,uuid[])') IS NULL
  AND NOT has_function_privilege('authenticated', 'public.require_completed_transcript(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.lock_speaker_identity_writes(uuid)', 'EXECUTE'),
  'the unguarded merge signature is gone and write-lock helpers stay private'
);

-- -------------------------------------------------------------- fixtures ----
-- Account A. Kickoff, Review and Retro sit in one project, oldest first.
--   Alex:  Kickoff (two segments, one of them Deepgram gave no number) and Review
--   Blair: Retro, on a voice still carrying its old label "Blair typo"; ACME
--   Casey: only a linked speaker without segments in Kickoff
--   Dana:  Retro, plus a linked speaker without segments in Review; Globex
-- Account B has one person, one organisation and one transcript.
INSERT INTO public.app_users (id, workos_user_id) VALUES
  ('e0000000-0000-4000-8000-00000000000a', 'user_e000000000004000800000000000000a'),
  ('e0000000-0000-4000-8000-00000000000b', 'user_e000000000004000800000000000000b');
INSERT INTO public.projects (id, user_id, parent_id, name) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-00000000000a', NULL, 'Client work');
INSERT INTO public.transcripts (id, user_id, project_id, title, status, created_at) VALUES
  ('e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-00000000000a', 'e1000000-0000-4000-8000-000000000001', 'Kickoff', 'completed', '2026-09-01T00:00:00Z'),
  ('e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-00000000000a', 'e1000000-0000-4000-8000-000000000001', 'Review', 'completed', '2026-09-10T00:00:00Z'),
  ('e2000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-00000000000a', 'e1000000-0000-4000-8000-000000000001', 'Retro', 'completed', '2026-09-20T00:00:00Z'),
  ('e2000000-0000-4000-8000-00000000000b', 'e0000000-0000-4000-8000-00000000000b', NULL, 'Other account', 'completed', '2026-09-05T00:00:00Z');
INSERT INTO public.organisations (id, user_id, name) VALUES
  ('e4000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-00000000000a', 'ACME'),
  ('e4000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-00000000000a', 'Globex'),
  ('e4000000-0000-4000-8000-00000000000b', 'e0000000-0000-4000-8000-00000000000b', 'Other Org');
-- Four distinct colours, so the least used one for a new person is the fifth.
INSERT INTO public.people (id, user_id, name, preferred_color, organisation_id) VALUES
  ('e3000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-00000000000a', 'Alex', '#4F638C', NULL),
  ('e3000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-00000000000a', 'Blair', '#C73E1D', 'e4000000-0000-4000-8000-000000000001'),
  ('e3000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-00000000000a', 'Casey', '#CA8A04', NULL),
  ('e3000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-00000000000a', 'Dana', '#0D9488', 'e4000000-0000-4000-8000-000000000002'),
  ('e3000000-0000-4000-8000-00000000000b', 'e0000000-0000-4000-8000-00000000000b', 'Bee', '#4F638C', NULL);
INSERT INTO public.speakers (id, transcript_id, user_id, ordinal, diarization_index, custom_label, person_id) VALUES
  -- Kickoff: Deepgram's speakers 0 and 1, Alex, and Casey's silent link.
  ('e5000000-0000-4000-8000-000000000010', 'e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-00000000000a', 1, 0, NULL, NULL),
  ('e5000000-0000-4000-8000-000000000011', 'e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-00000000000a', 2, 1, NULL, NULL),
  ('e5000000-0000-4000-8000-000000000012', 'e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-00000000000a', 3, NULL, NULL, 'e3000000-0000-4000-8000-000000000001'),
  ('e5000000-0000-4000-8000-000000000013', 'e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-00000000000a', 4, NULL, NULL, 'e3000000-0000-4000-8000-000000000003'),
  -- Review: Deepgram's speaker 0, Alex, and Dana's silent link.
  ('e5000000-0000-4000-8000-000000000020', 'e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-00000000000a', 1, 0, NULL, NULL),
  ('e5000000-0000-4000-8000-000000000021', 'e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-00000000000a', 2, NULL, NULL, 'e3000000-0000-4000-8000-000000000001'),
  ('e5000000-0000-4000-8000-000000000022', 'e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-00000000000a', 3, NULL, NULL, 'e3000000-0000-4000-8000-000000000004'),
  -- Retro: Deepgram's speakers 0 and 1, Blair (with an old label) and Dana.
  ('e5000000-0000-4000-8000-000000000030', 'e2000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-00000000000a', 1, 0, NULL, NULL),
  ('e5000000-0000-4000-8000-000000000031', 'e2000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-00000000000a', 2, 1, NULL, NULL),
  ('e5000000-0000-4000-8000-000000000032', 'e2000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-00000000000a', 3, NULL, 'Blair typo', 'e3000000-0000-4000-8000-000000000002'),
  ('e5000000-0000-4000-8000-000000000033', 'e2000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-00000000000a', 4, NULL, NULL, 'e3000000-0000-4000-8000-000000000004'),
  -- Account B.
  ('e5000000-0000-4000-8000-0000000000b0', 'e2000000-0000-4000-8000-00000000000b', 'e0000000-0000-4000-8000-00000000000b', 1, 0, NULL, NULL),
  ('e5000000-0000-4000-8000-0000000000b1', 'e2000000-0000-4000-8000-00000000000b', 'e0000000-0000-4000-8000-00000000000b', 2, NULL, NULL, 'e3000000-0000-4000-8000-00000000000b');
INSERT INTO public.segments (id, transcript_id, speaker_id, diarization_index, start_ms, end_ms, text) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000012', 0,    0, 1000, 'alex one'),
  ('e6000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000011', 1, 1000, 2000, 'speaker two'),
  ('e6000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000012', NULL, 2000, 3500, 'alex, unnumbered'),
  ('e6000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000010', 0, 3500, 4000, 'speaker one'),
  ('e6000000-0000-4000-8000-000000000005', 'e2000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000021', 0,    0, 1000, 'alex in review'),
  ('e6000000-0000-4000-8000-000000000006', 'e2000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000032', 0,    0, 1000, 'blair'),
  ('e6000000-0000-4000-8000-000000000007', 'e2000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000033', 1, 1000, 2000, 'dana'),
  ('e6000000-0000-4000-8000-00000000000b', 'e2000000-0000-4000-8000-00000000000b', 'e5000000-0000-4000-8000-0000000000b1', 0,    0, 1000, 'bee');

CREATE TEMP TABLE action_result (name text PRIMARY KEY, data jsonb) ON COMMIT DROP;
GRANT SELECT, INSERT, UPDATE ON action_result TO authenticated;

-- Account A's directory entry for a person, as the list page reads it.
CREATE FUNCTION pg_temp.listed(p_id uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(public.people_directory()->'people') AS e WHERE (e->>'id')::uuid = p_id
$$;
GRANT EXECUTE ON FUNCTION pg_temp.listed(uuid) TO authenticated;

SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------- unauthenticated --
SET LOCAL request.jwt.claims = '{"role":"authenticated"}';
SELECT pg_temp.assert_sqlstate($sql$SELECT public.people_directory()$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.create_person('Nobody')$sql$, '42501');

SET LOCAL request.jwt.claims = '{"sub":"user_e000000000004000800000000000000a","role":"authenticated"}';

-- ----------------------------------------------------------------- reads ----
SELECT pg_temp.assert_true(
  (SELECT jsonb_array_length(public.people_directory()->'people') = 4)
  AND (SELECT (e->>'transcript_count')::int = 2
        AND (e->>'last_seen_at')::timestamptz = '2026-09-10T00:00:00Z'
        AND e->>'organisation_name' IS NULL
       FROM pg_temp.listed('e3000000-0000-4000-8000-000000000001') AS e)
  AND (SELECT (e->>'transcript_count')::int = 0 AND e->>'last_seen_at' IS NULL
       FROM pg_temp.listed('e3000000-0000-4000-8000-000000000003') AS e)
  AND (SELECT e->>'organisation_name' = 'ACME' FROM pg_temp.listed('e3000000-0000-4000-8000-000000000002') AS e),
  'the directory counts appearances, last seen is the newest transcript, and a silent link is no appearance'
);
SELECT pg_temp.assert_true(
  (SELECT array_agg(e->>'name' || ':' || (e->>'person_count') ORDER BY ord)
   FROM jsonb_array_elements(public.people_directory()->'organisations') WITH ORDINALITY AS t(e, ord))
  = ARRAY['ACME:1', 'Globex:1'],
  'organisations are listed with their number of people'
);
SELECT pg_temp.assert_true(
  (SELECT array_agg(e->>'title' || ':' || (e->>'talk_ms') || '/' || (e->>'transcript_talk_ms') ORDER BY ord)
   FROM jsonb_array_elements(public.list_person_appearances('e3000000-0000-4000-8000-000000000001'))
     WITH ORDINALITY AS t(e, ord))
  -- Alex speaks 1000 + 1500 ms of Kickoff's 4000, and all of Review.
  = ARRAY['Review:1000/1000', 'Kickoff:2500/4000']
  AND public.list_person_appearances('e3000000-0000-4000-8000-000000000003') = '[]'::jsonb
  AND public.list_person_appearances('e3000000-0000-4000-8000-00000000000b') = '[]'::jsonb,
  'appearances are newest first with the person''s and everyone''s speaking time; another account''s person has none'
);

-- ---------------------------------------------------------------- create ----
INSERT INTO action_result VALUES ('fay', to_jsonb(public.create_person(' Fay ')));
INSERT INTO action_result VALUES ('alex2', to_jsonb(public.create_person('Alex')));
SELECT pg_temp.assert_true(
  (SELECT data->>'name' = 'Fay' AND data->>'preferred_color' = '#7C3AED' AND data->>'organisation_id' IS NULL
     AND data->>'user_id' = 'e0000000-0000-4000-8000-00000000000a' FROM action_result WHERE name = 'fay')
  AND (SELECT data->>'preferred_color' = '#64748B' FROM action_result WHERE name = 'alex2')
  AND (SELECT count(*) = 2 FROM public.people WHERE name = 'Alex'),
  'a person is created trimmed, with the least used colour; a namesake is allowed'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.create_person('   ')$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate(format('SELECT public.create_person(%L)', repeat('x', 51)), 'SP003');

-- ---------------------------------------------------------- organisation ----
SELECT pg_temp.assert_true(
  (SELECT r->'person'->>'organisation_id' = 'e4000000-0000-4000-8000-000000000001'
     AND r->'organisation'->>'name' = 'ACME'
   FROM public.set_person_organisation('e3000000-0000-4000-8000-000000000001', NULL, NULL, ' acme ') AS r)
  AND (SELECT count(*) = 2 FROM public.organisations),
  'a new name matching an organisation, ignoring case, reuses it'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_person_organisation(
  'e3000000-0000-4000-8000-000000000001', NULL, 'e4000000-0000-4000-8000-000000000002')$sql$, 'SP002');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_person_organisation(
  'e3000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-00000000000b')$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_person_organisation(
  'e3000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000002', 'Both')$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate(format($sql$SELECT public.set_person_organisation(
  'e3000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', NULL, %L)$sql$,
  repeat('o', 51)), 'SP003');
SELECT pg_temp.assert_true(
  (SELECT r->'organisation' = 'null'::jsonb AND r->'person'->>'organisation_id' IS NULL
   FROM public.set_person_organisation('e3000000-0000-4000-8000-000000000001',
     'e4000000-0000-4000-8000-000000000001', NULL, NULL) AS r),
  'both null clears the organisation'
);
INSERT INTO action_result VALUES ('initech', (SELECT public.set_person_organisation(
  (SELECT (data->>'id')::uuid FROM action_result WHERE name = 'fay'), NULL, NULL, 'Initech')));
SELECT pg_temp.assert_true(
  (SELECT data->'organisation'->>'name' = 'Initech' FROM action_result WHERE name = 'initech')
  AND (SELECT count(*) = 3 FROM public.organisations),
  'a new name that matches nothing creates the organisation'
);

-- ---------------------------------------------------------- colour, hide ----
SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_person_color(
  'e3000000-0000-4000-8000-000000000003', '#CA8A04', '#000000')$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_person_color(
  'e3000000-0000-4000-8000-000000000003', '#4F638C', '#DB2777')$sql$, 'SP002');
SELECT pg_temp.assert_true(
  (SELECT preferred_color = '#DB2777' FROM public.set_person_color(
    'e3000000-0000-4000-8000-000000000003', '#CA8A04', '#DB2777')),
  'a palette colour replaces the one last read'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_person_hidden('e3000000-0000-4000-8000-000000000003', NULL)$sql$, 'SP003');
SELECT pg_temp.assert_true(
  (SELECT hidden FROM public.set_person_hidden('e3000000-0000-4000-8000-000000000003', true))
  AND (SELECT (e->>'hidden')::boolean FROM pg_temp.listed('e3000000-0000-4000-8000-000000000003') AS e)
  AND NOT (SELECT hidden FROM public.set_person_hidden('e3000000-0000-4000-8000-000000000003', false)),
  'hide and unhide'
);

-- ---------------------------------------------------------------- delete ----
SELECT pg_temp.assert_sqlstate($sql$SELECT public.delete_person('e3000000-0000-4000-8000-000000000001')$sql$, 'SP002');
SELECT public.delete_person('e3000000-0000-4000-8000-000000000003');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.people WHERE id = 'e3000000-0000-4000-8000-000000000003')
  AND (SELECT person_id IS NULL FROM public.speakers WHERE id = 'e5000000-0000-4000-8000-000000000013')
  AND (SELECT count(*) = 4 FROM public.segments WHERE transcript_id = 'e2000000-0000-4000-8000-000000000001'),
  'a person in no transcript is deleted; their silent link is unlinked and no segment is touched'
);

-- -------------------------------------------------- remove from transcript --
INSERT INTO action_result VALUES ('removed', public.remove_person_from_transcript(
  'e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001'));
SELECT pg_temp.assert_true(
  (SELECT jsonb_array_length(data) = 2 FROM action_result WHERE name = 'removed')
  AND (SELECT speaker_id = 'e5000000-0000-4000-8000-000000000010' FROM public.segments
       WHERE id = 'e6000000-0000-4000-8000-000000000001')
  AND (SELECT speaker_id IS NULL FROM public.segments WHERE id = 'e6000000-0000-4000-8000-000000000003')
  AND (SELECT speaker_id = 'e5000000-0000-4000-8000-000000000021' FROM public.segments
       WHERE id = 'e6000000-0000-4000-8000-000000000005')
  AND (SELECT (e->>'transcript_count')::int = 1 FROM pg_temp.listed('e3000000-0000-4000-8000-000000000001') AS e),
  'remove sends each segment to its detected speaker, or Unknown, and leaves other transcripts alone'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.remove_person_from_transcript(
  'e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001')$sql$, 'SP002');
-- Undo: the returned changes, each expectation and target swapped, at the
-- revision the removal reported.
SELECT pg_temp.assert_true(
  (SELECT bool_and(c->>'expected_revision' = '0')
   FROM action_result, jsonb_array_elements(data) AS c WHERE name = 'removed'),
  'remove reports the revision each change was made at'
);
SELECT public.reassign_segments('e2000000-0000-4000-8000-000000000001',
  (SELECT jsonb_agg(jsonb_build_object('segment_id', c->'segment_id', 'expected_revision', c->'expected_revision',
     'expected_speaker_id', c->'speaker_id', 'speaker_id', c->'expected_speaker_id'))
   FROM action_result, jsonb_array_elements(data) AS c WHERE name = 'removed'));
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 FROM public.segments
   WHERE speaker_id = 'e5000000-0000-4000-8000-000000000012')
  AND (SELECT (e->>'transcript_count')::int = 2 FROM pg_temp.listed('e3000000-0000-4000-8000-000000000001') AS e),
  'undoing a removal through reassign_segments puts every segment back'
);

-- ----------------------------------------------------------------- merge ----
SELECT pg_temp.assert_sqlstate($sql$SELECT public.merge_people_preview('e3000000-0000-4000-8000-000000000001',
  ARRAY['e3000000-0000-4000-8000-000000000001']::uuid[])$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.merge_people_preview('e3000000-0000-4000-8000-000000000001',
  ARRAY['e3000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000002']::uuid[])$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.merge_people_preview('e3000000-0000-4000-8000-000000000001',
  ARRAY[]::uuid[])$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.merge_people_preview('e3000000-0000-4000-8000-000000000001',
  ARRAY['e3000000-0000-4000-8000-000000000002', NULL]::uuid[])$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.merge_people_preview('e3000000-0000-4000-8000-000000000001',
  ARRAY['e3000000-0000-4000-8000-00000000000b']::uuid[])$sql$, 'SP001');

-- Speaker mutations are available only after completion, including Undo and
-- directory removal. A refused write must not create a person or local voice.
-- Jobs and transcript status are pipeline-owned, so the server role drives them.
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_sqlstate($sql$INSERT INTO public.jobs (transcript_id, type, status)
  VALUES ('e2000000-0000-4000-8000-000000000001', 'transcription', 'queued')$sql$, 'SP004');
SELECT pg_temp.assert_true((SELECT status = 'completed' FROM public.transcripts
  WHERE id = 'e2000000-0000-4000-8000-000000000001'), 'refusing a restart preserves completed status');
SAVEPOINT retry_unfinished;
UPDATE public.transcripts SET status = 'error' WHERE id = 'e2000000-0000-4000-8000-000000000001';
INSERT INTO public.jobs (transcript_id, type, status)
  VALUES ('e2000000-0000-4000-8000-000000000001', 'transcription', 'queued');
SELECT pg_temp.assert_true((SELECT status = 'queued' FROM public.transcripts
  WHERE id = 'e2000000-0000-4000-8000-000000000001'), 'unfinished transcripts remain retriable');
ROLLBACK TO retry_unfinished;
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_status text;
BEGIN
  FOREACH v_status IN ARRAY ARRAY['created', 'queued', 'processing', 'error'] LOOP
    SET LOCAL ROLE service_role;
    UPDATE public.transcripts SET status = v_status WHERE id = 'e2000000-0000-4000-8000-000000000001';
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.assert_sqlstate($sql$SELECT public.reassign_segments('e2000000-0000-4000-8000-000000000001',
      '[{"segment_id":"e6000000-0000-4000-8000-000000000001","expected_revision":0,"expected_speaker_id":"e5000000-0000-4000-8000-000000000012","speaker_id":null}]')$sql$, 'SP004');
    PERFORM pg_temp.assert_sqlstate($sql$SELECT public.correct_segments_to_person('e2000000-0000-4000-8000-000000000001',
      '[{"segment_id":"e6000000-0000-4000-8000-000000000001","expected_revision":0,"expected_speaker_id":"e5000000-0000-4000-8000-000000000012"}]', NULL, 'Must not be created',
      'e3000000-0000-4000-8000-0000000000f1')$sql$, 'SP004');
    PERFORM pg_temp.assert_sqlstate($sql$SELECT public.create_local_speaker('e2000000-0000-4000-8000-000000000001', 'Must not be created',
      '[{"segment_id":"e6000000-0000-4000-8000-000000000001","expected_revision":0,"expected_speaker_id":"e5000000-0000-4000-8000-000000000012"}]',
      'e5000000-0000-4000-8000-0000000000f1')$sql$, 'SP004');
    PERFORM pg_temp.assert_sqlstate($sql$SELECT public.set_speaker_custom_label('e5000000-0000-4000-8000-000000000012', NULL, 'Must not change')$sql$, 'SP004');
    PERFORM pg_temp.assert_sqlstate($sql$SELECT public.undo_created_person_action('e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001', 'Alex', '#4F638C', 'e5000000-0000-4000-8000-000000000012',
      '[{"segment_id":"e6000000-0000-4000-8000-000000000001","expected_revision":0,"expected_speaker_id":"e5000000-0000-4000-8000-000000000012","speaker_id":null}]')$sql$, 'SP004');
    PERFORM pg_temp.assert_sqlstate($sql$SELECT public.remove_person_from_transcript('e3000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000001')$sql$, 'SP004');
  END LOOP;
  SET LOCAL ROLE service_role;
  UPDATE public.transcripts SET status = 'completed' WHERE id = 'e2000000-0000-4000-8000-000000000001';
  SET LOCAL ROLE authenticated;
END;
$$;
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.people WHERE name = 'Must not be created')
  AND NOT EXISTS (SELECT 1 FROM public.speakers WHERE custom_label = 'Must not be created')
  AND NOT EXISTS (SELECT 1 FROM public.people WHERE id = 'e3000000-0000-4000-8000-0000000000f1')
  AND NOT EXISTS (SELECT 1 FROM public.speakers WHERE id = 'e5000000-0000-4000-8000-0000000000f1')
  AND (SELECT speaker_id = 'e5000000-0000-4000-8000-000000000012' FROM public.segments
    WHERE id = 'e6000000-0000-4000-8000-000000000001'),
  'unfinished transcript writes leave identities and assignments unchanged'
);

-- Dana first, although Blair's id sorts before hers.
INSERT INTO action_result VALUES ('preview', public.merge_people_preview('e3000000-0000-4000-8000-000000000001',
  ARRAY['e3000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000002']::uuid[]));
SELECT pg_temp.assert_true(
  (SELECT data->'survivor_transcript_ids' = '["e2000000-0000-4000-8000-000000000001", "e2000000-0000-4000-8000-000000000002"]'::jsonb
   FROM action_result WHERE name = 'preview')
  AND (SELECT array_agg(p->>'person_id' ORDER BY ord) = ARRAY[
         'e3000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000002']
       FROM action_result, jsonb_array_elements(data->'people') WITH ORDINALITY AS t(p, ord) WHERE name = 'preview')
  -- Dana's silent link in Review moves too, but shows nowhere, so is not listed.
  AND (SELECT data->'people'->0->'transcripts' @> '[{"title": "Retro", "voices": [
         {"speaker_id": "e5000000-0000-4000-8000-000000000033", "custom_label": null,
          "talk_ms": 1000, "detected_ordinals": [2]}]}]'::jsonb
         AND jsonb_array_length(data->'people'->0->'transcripts') = 1
       FROM action_result WHERE name = 'preview')
  AND (SELECT data->'people'->1->'transcripts'->0->'voices'->0 @> '{"custom_label": "Blair typo",
         "talk_ms": 1000, "detected_ordinals": [1]}'::jsonb
       FROM action_result WHERE name = 'preview'),
  'the preview lists each transcript and local voice that would move, in the order given'
);

-- The preview also owns the confirmation's person and organisation details.
SELECT pg_temp.assert_true(
  (SELECT data->'survivor'->>'name' = 'Alex'
    AND data->'people'->0->>'organisation_id' = 'e4000000-0000-4000-8000-000000000002'
    AND data->'people'->0->>'organisation_name' = 'Globex' FROM action_result WHERE name = 'preview'),
  'organisation outcome and survivor details are part of the guarded preview'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.merge_people('e3000000-0000-4000-8000-000000000001',
  ARRAY['e3000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000002']::uuid[], NULL)$sql$, 'SP003');

SAVEPOINT changed_organisation;
SELECT public.set_person_organisation('e3000000-0000-4000-8000-000000000004',
  'e4000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-000000000001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.merge_people('e3000000-0000-4000-8000-000000000001',
  ARRAY['e3000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000002']::uuid[],
  (SELECT data FROM action_result WHERE name = 'preview'))$sql$, 'SP002');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.people WHERE id IN
  ('e3000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000002')),
  'a stale organisation preview deletes no person');
ROLLBACK TO changed_organisation;

SAVEPOINT changed_appearance;
SELECT public.correct_segments_to_person('e2000000-0000-4000-8000-000000000001',
  '[{"segment_id":"e6000000-0000-4000-8000-000000000002","expected_revision":0,"expected_speaker_id":"e5000000-0000-4000-8000-000000000011"}]',
  'e3000000-0000-4000-8000-000000000002');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.merge_people('e3000000-0000-4000-8000-000000000001',
  ARRAY['e3000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000002']::uuid[],
  (SELECT data FROM action_result WHERE name = 'preview'))$sql$, 'SP002');
SELECT pg_temp.assert_true((SELECT person_id = 'e3000000-0000-4000-8000-000000000002' FROM public.speakers
  WHERE id = 'e5000000-0000-4000-8000-000000000032'), 'a stale appearance preview moves no link');
ROLLBACK TO changed_appearance;

-- A failed merge changes nothing.
SELECT pg_temp.assert_sqlstate($sql$SELECT public.merge_people('e3000000-0000-4000-8000-000000000001',
  ARRAY['e3000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-00000000000b']::uuid[], '{}'::jsonb)$sql$, 'SP001');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.people WHERE id = 'e3000000-0000-4000-8000-000000000002')
  AND (SELECT person_id = 'e3000000-0000-4000-8000-000000000002' FROM public.speakers
       WHERE id = 'e5000000-0000-4000-8000-000000000032'),
  'a refused merge moves no link and deletes no one'
);

INSERT INTO action_result VALUES ('merged', to_jsonb(public.merge_people('e3000000-0000-4000-8000-000000000001',
  ARRAY['e3000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000002']::uuid[],
  (SELECT data FROM action_result WHERE name = 'preview'))));
SELECT pg_temp.assert_true(
  (SELECT data->>'name' = 'Alex' AND data->>'preferred_color' = '#4F638C'
     AND data->>'organisation_id' = 'e4000000-0000-4000-8000-000000000002'
   FROM action_result WHERE name = 'merged')
  AND (SELECT count(*) = 0 FROM public.people WHERE id IN (
       'e3000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000004'))
  AND (SELECT bool_and(person_id = 'e3000000-0000-4000-8000-000000000001') FROM public.speakers
       WHERE id IN ('e5000000-0000-4000-8000-000000000022', 'e5000000-0000-4000-8000-000000000032',
                    'e5000000-0000-4000-8000-000000000033'))
  AND (SELECT (e->>'transcript_count')::int = 3 FROM pg_temp.listed('e3000000-0000-4000-8000-000000000001') AS e),
  'merge moves every link, deletes the merged people, and the survivor takes the first given organisation'
);
SELECT pg_temp.assert_true(
  (SELECT speaker_count = 3
     AND preview->0->>'kind' = 'person' AND preview->0->>'id' = 'e3000000-0000-4000-8000-000000000001'
     AND (SELECT count(*) = 1 FROM jsonb_array_elements(preview) AS p WHERE p->>'kind' = 'person')
   FROM public.project_speaker_summaries(ARRAY['e1000000-0000-4000-8000-000000000001']::uuid[], false)),
  'the project counts the merged person once, beside its two unlinked voices'
);

-- ---------------------------------------------------------- organisations --
SELECT pg_temp.assert_sqlstate($sql$SELECT public.rename_organisation(
  'e4000000-0000-4000-8000-000000000001', 'Stale', 'Anything')$sql$, 'SP002');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.rename_organisation(
  'e4000000-0000-4000-8000-000000000001', 'ACME', ' globex ')$sql$, '23505');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.rename_organisation(
  'e4000000-0000-4000-8000-000000000001', 'ACME', '  ')$sql$, 'SP003');
SELECT pg_temp.assert_true(
  (SELECT name = 'ACME Ltd' FROM public.rename_organisation(
    'e4000000-0000-4000-8000-000000000001', 'ACME', ' ACME Ltd ')),
  'an organisation is renamed over the name last read'
);
SELECT public.delete_organisation((SELECT (data->'organisation'->>'id')::uuid FROM action_result WHERE name = 'initech'));
SELECT pg_temp.assert_true(
  (SELECT organisation_id IS NULL FROM public.people
   WHERE id = (SELECT (data->>'id')::uuid FROM action_result WHERE name = 'fay'))
  AND (SELECT count(*) = 2 FROM public.organisations),
  'deleting an organisation clears it from its people and deletes no person'
);

-- ---------------------------------------------------------- other account --
SET LOCAL request.jwt.claims = '{"sub":"user_e000000000004000800000000000000b","role":"authenticated"}';
SELECT pg_temp.assert_true(
  (SELECT array_agg(e->>'name') = ARRAY['Bee'] FROM jsonb_array_elements(public.people_directory()->'people') AS e)
  AND (SELECT array_agg(e->>'name') = ARRAY['Other Org'] FROM jsonb_array_elements(public.people_directory()->'organisations') AS e)
  AND public.list_person_appearances('e3000000-0000-4000-8000-000000000001') = '[]'::jsonb,
  'another account sees only its own directory'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_person_hidden('e3000000-0000-4000-8000-000000000001', true)$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_person_color('e3000000-0000-4000-8000-000000000001', '#4F638C', '#C73E1D')$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_person_organisation('e3000000-0000-4000-8000-000000000001', NULL, NULL, 'Mine')$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_person_organisation('e3000000-0000-4000-8000-00000000000b', NULL, 'e4000000-0000-4000-8000-000000000002')$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.rename_person_guarded('e3000000-0000-4000-8000-000000000001', 'Alex', 'Mine')$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.delete_person('e3000000-0000-4000-8000-000000000001')$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.remove_person_from_transcript('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001')$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.remove_person_from_transcript('e3000000-0000-4000-8000-00000000000b', 'e2000000-0000-4000-8000-000000000001')$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.merge_people_preview('e3000000-0000-4000-8000-00000000000b', ARRAY['e3000000-0000-4000-8000-000000000001']::uuid[])$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.merge_people('e3000000-0000-4000-8000-00000000000b', ARRAY['e3000000-0000-4000-8000-000000000001']::uuid[], '{}'::jsonb)$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.rename_organisation('e4000000-0000-4000-8000-000000000002', 'Globex', 'Mine')$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.delete_organisation('e4000000-0000-4000-8000-000000000002')$sql$, 'SP001');

RESET ROLE;
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.people WHERE id = 'e3000000-0000-4000-8000-000000000001' AND NOT hidden
     AND name = 'Alex' AND preferred_color = '#4F638C')
  AND (SELECT count(*) = 1 FROM public.organisations WHERE id = 'e4000000-0000-4000-8000-000000000002'),
  'nothing the other account tried changed account A'
);

ROLLBACK;
SELECT 'people directory smoke test passed' AS result;
