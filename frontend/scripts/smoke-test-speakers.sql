-- Behavioural coverage for the transcript speaker model, run against the local
-- Supabase database:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f frontend/scripts/smoke-test-speakers.sql
--
-- Covers infra/supabase/migrations/20260924000000_speaker_identity_foundations.sql:
-- save_transcript_segments keyed on the diarization index, the composite keys,
-- the closed direct-write paths, and the guarded speaker write functions.
-- Everything runs in one transaction that is rolled back.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(value boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assertion failed: %', message;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_sqlstate(statement text, expected text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'expected SQLSTATE %, got %: %', expected, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'expected SQLSTATE %, statement succeeded: %', expected, statement;
END;
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(boolean, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.assert_sqlstate(text, text) TO anon, authenticated, service_role;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'c0000000-0000-0000-0000-00000000000a',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'speaker-smoke-a@example.test', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'c0000000-0000-0000-0000-00000000000b',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'speaker-smoke-b@example.test', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );

-- A1 and A2 belong to user A; B1 to user B.
INSERT INTO public.transcripts (id, user_id, title, status) VALUES
  ('c1000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-00000000000a', 'A1', 'processing'),
  ('c1000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-00000000000a', 'A2', 'processing'),
  ('c1000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-00000000000b', 'B1', 'processing');

-- ------------------------------------------------- save_transcript_segments ----

SET LOCAL ROLE service_role;

SELECT public.save_transcript_segments(
  'c1000000-0000-0000-0000-0000000000a1',
  '{
    "speakers": [{"num": 0}, {"num": 1}],
    "segments": [
      {"id": "c3000000-0000-0000-0000-000000000001", "speaker_num": 0, "start_ms": 0, "end_ms": 900, "text": "one", "is_filler": false, "algo_version": "smoke", "words": []},
      {"id": "c3000000-0000-0000-0000-000000000002", "speaker_num": 1, "start_ms": 1000, "end_ms": 1900, "text": "two", "is_filler": false, "algo_version": "smoke", "words": []},
      {"id": "c3000000-0000-0000-0000-000000000003", "speaker_num": 0, "start_ms": 2000, "end_ms": 2900, "text": "three", "is_filler": false, "algo_version": "smoke", "words": []},
      {"id": "c3000000-0000-0000-0000-000000000004", "speaker_num": null, "start_ms": 3000, "end_ms": 3900, "text": "four", "is_filler": false, "algo_version": "smoke", "words": []}
    ]
  }'::jsonb
);

SELECT pg_temp.assert_true(
  (SELECT array_agg(ordinal ORDER BY ordinal) = ARRAY[0, 1]
      AND array_agg(diarization_index ORDER BY ordinal) = ARRAY[0, 1]
      AND bool_and(custom_label IS NULL)
      AND bool_and(user_id = 'c0000000-0000-0000-0000-00000000000a')
   FROM public.speakers WHERE transcript_id = 'c1000000-0000-0000-0000-0000000000a1'),
  'new speakers take ordinal = diarization index, no custom label, and the transcript owner'
);

SELECT pg_temp.assert_true(
  (SELECT sg.speaker_id IS NULL FROM public.segments AS sg WHERE sg.id = 'c3000000-0000-0000-0000-000000000004')
  AND (SELECT sp.diarization_index FROM public.segments AS sg JOIN public.speakers AS sp ON sp.id = sg.speaker_id
       WHERE sg.id = 'c3000000-0000-0000-0000-000000000003') = 0,
  'segments join to speakers on the diarization index; a null speaker_num stays unassigned'
);

-- A re-run (never on a completed transcript) replaces segments but reuses speakers.
SELECT public.save_transcript_segments(
  'c1000000-0000-0000-0000-0000000000a1',
  '{
    "speakers": [{"num": 1}, {"num": 0}],
    "segments": [
      {"id": "c3000000-0000-0000-0000-000000000011", "speaker_num": 0, "start_ms": 0, "end_ms": 900, "text": "one", "is_filler": false, "algo_version": "smoke", "words": []},
      {"id": "c3000000-0000-0000-0000-000000000012", "speaker_num": 1, "start_ms": 1000, "end_ms": 1900, "text": "two", "is_filler": false, "algo_version": "smoke", "words": []},
      {"id": "c3000000-0000-0000-0000-000000000013", "speaker_num": 0, "start_ms": 2000, "end_ms": 2900, "text": "three", "is_filler": false, "algo_version": "smoke", "words": []},
      {"id": "c3000000-0000-0000-0000-000000000014", "speaker_num": null, "start_ms": 3000, "end_ms": 3900, "text": "four", "is_filler": false, "algo_version": "smoke", "words": []}
    ]
  }'::jsonb
);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.speakers WHERE transcript_id = 'c1000000-0000-0000-0000-0000000000a1') = 2
  AND (SELECT count(*) FROM public.segments WHERE transcript_id = 'c1000000-0000-0000-0000-0000000000a1') = 4,
  'a re-run reuses speakers by diarization index and creates no duplicates'
);

RESET ROLE;

-- A legacy-style row already holds ordinal 0 in A2, with no diarization index.
INSERT INTO public.speakers (id, transcript_id, user_id, ordinal, custom_label)
VALUES ('c2000000-0000-0000-0000-0000000000a2', 'c1000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-00000000000a', 0, null);

SET LOCAL ROLE service_role;

SELECT public.save_transcript_segments(
  'c1000000-0000-0000-0000-0000000000a2',
  '{
    "speakers": [{"num": 0}],
    "segments": [
      {"id": "c3000000-0000-0000-0000-000000000021", "speaker_num": 0, "start_ms": 0, "end_ms": 900, "text": "a2 one", "is_filler": false, "algo_version": "smoke", "words": []},
      {"id": "c3000000-0000-0000-0000-000000000022", "speaker_num": null, "start_ms": 1000, "end_ms": 1900, "text": "a2 two", "is_filler": false, "algo_version": "smoke", "words": []}
    ]
  }'::jsonb
);

SELECT pg_temp.assert_true(
  (SELECT ordinal FROM public.speakers
   WHERE transcript_id = 'c1000000-0000-0000-0000-0000000000a2' AND diarization_index = 0) = 1,
  'a diarized speaker whose ordinal is taken gets the next free ordinal'
);

SELECT pg_temp.assert_sqlstate(
  $sql$SELECT public.save_transcript_segments('c1000000-0000-0000-0000-00000000ffff', '{"speakers": [], "segments": []}'::jsonb)$sql$,
  'SP001'
);

RESET ROLE;

-- Fixed ids for the rest of the script.
CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.speakers WHERE transcript_id = 'c1000000-0000-0000-0000-0000000000a1' AND ordinal = 0) AS a1_s0,
  (SELECT id FROM public.speakers WHERE transcript_id = 'c1000000-0000-0000-0000-0000000000a1' AND ordinal = 1) AS a1_s1;
GRANT SELECT ON ids TO anon, authenticated, service_role;

INSERT INTO public.speakers (id, transcript_id, user_id, ordinal, custom_label)
VALUES ('c2000000-0000-0000-0000-0000000000b1', 'c1000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-00000000000b', 0, 'Other user');
INSERT INTO public.segments (id, transcript_id, speaker_id, start_ms, end_ms, text)
VALUES ('c3000000-0000-0000-0000-0000000000b1', 'c1000000-0000-0000-0000-0000000000b1', 'c2000000-0000-0000-0000-0000000000b1', 0, 900, 'b one');

-- -------------------------------------------------------------- constraints ----

SELECT pg_temp.assert_sqlstate(
  $sql$INSERT INTO public.speakers (transcript_id, user_id, ordinal) VALUES ('c1000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-00000000000a', 0)$sql$,
  '23505'
);

SELECT pg_temp.assert_sqlstate(
  $sql$INSERT INTO public.speakers (transcript_id, user_id, ordinal) VALUES ('c1000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-00000000000b', 7)$sql$,
  '23503'
);

SELECT pg_temp.assert_sqlstate(
  $sql$INSERT INTO public.segments (transcript_id, speaker_id, start_ms, end_ms, text) SELECT 'c1000000-0000-0000-0000-0000000000a2', a1_s0, 0, 1, 'x' FROM ids$sql$,
  '23503'
);

SELECT pg_temp.assert_sqlstate(
  $sql$INSERT INTO public.speakers (transcript_id, user_id, ordinal, custom_label) VALUES ('c1000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-00000000000a', 8, E' \t ')$sql$,
  '23514'
);

SELECT pg_temp.assert_sqlstate(
  $sql$INSERT INTO public.speakers (transcript_id, user_id, ordinal) VALUES ('c1000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-00000000000a', -1)$sql$,
  '23514'
);

SAVEPOINT shared_label;
INSERT INTO public.speakers (transcript_id, user_id, ordinal, custom_label) VALUES
  ('c1000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-00000000000a', 20, 'Interviewer'),
  ('c1000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-00000000000a', 21, 'Interviewer');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.speakers WHERE custom_label = 'Interviewer') = 2,
  'two speakers of one transcript may share a custom label'
);
ROLLBACK TO SAVEPOINT shared_label;

-- -------------------------------------------------------------- privileges ----

SET LOCAL request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-00000000000a","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT pg_temp.assert_sqlstate(
  $sql$INSERT INTO public.speakers (transcript_id, user_id, ordinal) VALUES ('c1000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-00000000000a', 9)$sql$,
  '42501'
);
SELECT pg_temp.assert_sqlstate(
  $sql$UPDATE public.speakers SET custom_label = 'Direct' WHERE transcript_id = 'c1000000-0000-0000-0000-0000000000a1'$sql$,
  '42501'
);
SELECT pg_temp.assert_sqlstate(
  $sql$DELETE FROM public.speakers WHERE transcript_id = 'c1000000-0000-0000-0000-0000000000a1'$sql$,
  '42501'
);
SELECT pg_temp.assert_sqlstate(
  $sql$UPDATE public.segments SET speaker_id = NULL WHERE id = 'c3000000-0000-0000-0000-000000000011'$sql$,
  '42501'
);

UPDATE public.segments SET text = 'one, edited', is_edited = true WHERE id = 'c3000000-0000-0000-0000-000000000011';
SELECT pg_temp.assert_true(
  (SELECT text FROM public.segments WHERE id = 'c3000000-0000-0000-0000-000000000011') = 'one, edited',
  'segment text stays directly editable'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.speakers WHERE transcript_id = 'c1000000-0000-0000-0000-0000000000a1') = 2
  AND (SELECT count(*) FROM public.speakers WHERE transcript_id = 'c1000000-0000-0000-0000-0000000000b1') = 0,
  'users read their own speakers and no one else''s'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT public.set_speaker_custom_label('c2000000-0000-0000-0000-0000000000b1', 'Other user', 'x')$sql$,
  '42501'
);
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT * FROM public.reassign_segments('c1000000-0000-0000-0000-0000000000a1', '[]'::jsonb)$sql$,
  '42501'
);
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT public.create_transcript_speaker('c1000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-00000000000a', 'x')$sql$,
  '42501'
);
RESET ROLE;

-- ------------------------------------------------ set_speaker_custom_label ----

SET LOCAL request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-00000000000a","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT pg_temp.assert_true(
  (SELECT custom_label FROM public.set_speaker_custom_label((SELECT a1_s0 FROM ids), null, '  Interviewer  ')) = 'Interviewer',
  'a local label is set, trimmed'
);

SELECT pg_temp.assert_sqlstate(
  $sql$SELECT public.set_speaker_custom_label((SELECT a1_s0 FROM ids), null, 'Stale')$sql$,
  'SP002'
);
SELECT pg_temp.assert_true(
  (SELECT custom_label FROM public.speakers WHERE id = (SELECT a1_s0 FROM ids)) = 'Interviewer',
  'a stale label write changes nothing'
);

SELECT pg_temp.assert_sqlstate(
  format($sql$SELECT public.set_speaker_custom_label((SELECT a1_s0 FROM ids), 'Interviewer', %L)$sql$, repeat('x', 51)),
  'SP003'
);
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT public.set_speaker_custom_label('c2000000-0000-0000-0000-0000000000b1', 'Other user', 'Mine now')$sql$,
  'SP001'
);

SELECT pg_temp.assert_true(
  (SELECT custom_label IS NULL AND ordinal = 0
   FROM public.set_speaker_custom_label((SELECT a1_s0 FROM ids), 'Interviewer', E' \t ')),
  'a blank label clears it back to Speaker {ordinal}'
);

SET LOCAL request.jwt.claims = '{"role":"authenticated"}';
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT public.set_speaker_custom_label((SELECT a1_s0 FROM ids), null, 'x')$sql$,
  '42501'
);
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT * FROM public.reassign_segments('c1000000-0000-0000-0000-0000000000a1', '[]'::jsonb)$sql$,
  '42501'
);
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT public.assign_segments_to_new_speaker('c1000000-0000-0000-0000-0000000000a1', 'x', '[]'::jsonb)$sql$,
  '42501'
);
SET LOCAL request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ---------------------------------------------------------- reassign_segments ----

-- One call, a different target per segment (the shape an Undo needs).
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.reassign_segments(
     'c1000000-0000-0000-0000-0000000000a1',
     (SELECT jsonb_build_array(
        jsonb_build_object('segment_id', 'c3000000-0000-0000-0000-000000000011', 'expected_speaker_id', a1_s0, 'speaker_id', a1_s1),
        jsonb_build_object('segment_id', 'c3000000-0000-0000-0000-000000000014', 'expected_speaker_id', null, 'speaker_id', a1_s0))
      FROM ids))) = 2,
  'reassign_segments returns every changed segment'
);
SELECT pg_temp.assert_true(
  (SELECT speaker_id FROM public.segments WHERE id = 'c3000000-0000-0000-0000-000000000011') = (SELECT a1_s1 FROM ids)
  AND (SELECT speaker_id FROM public.segments WHERE id = 'c3000000-0000-0000-0000-000000000014') = (SELECT a1_s0 FROM ids)
  AND (SELECT speaker_id FROM public.segments WHERE id = 'c3000000-0000-0000-0000-000000000013') = (SELECT a1_s0 FROM ids),
  'each segment gets its own target and no other segment moves'
);

-- One stale expectation refuses the whole call.
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT * FROM public.reassign_segments('c1000000-0000-0000-0000-0000000000a1',
    (SELECT jsonb_build_array(
       jsonb_build_object('segment_id', 'c3000000-0000-0000-0000-000000000012', 'expected_speaker_id', a1_s1, 'speaker_id', null),
       jsonb_build_object('segment_id', 'c3000000-0000-0000-0000-000000000013', 'expected_speaker_id', a1_s1, 'speaker_id', null))
     FROM ids))$sql$,
  'SP002'
);
SELECT pg_temp.assert_true(
  (SELECT speaker_id FROM public.segments WHERE id = 'c3000000-0000-0000-0000-000000000012') = (SELECT a1_s1 FROM ids)
  AND (SELECT speaker_id FROM public.segments WHERE id = 'c3000000-0000-0000-0000-000000000013') = (SELECT a1_s0 FROM ids),
  'a refused reassignment changes no segment'
);

SELECT pg_temp.assert_true(
  (SELECT speaker_id IS NULL FROM public.reassign_segments('c1000000-0000-0000-0000-0000000000a1',
     (SELECT jsonb_build_array(jsonb_build_object('segment_id', 'c3000000-0000-0000-0000-000000000012', 'expected_speaker_id', a1_s1, 'speaker_id', null)) FROM ids))),
  'a null target makes the segment Unknown'
);

SELECT pg_temp.assert_sqlstate(
  $sql$SELECT * FROM public.reassign_segments('c1000000-0000-0000-0000-0000000000a1',
    '[{"segment_id": "c3000000-0000-0000-0000-000000000012", "expected_speaker_id": null, "speaker_id": "c2000000-0000-0000-0000-0000000000a2"}]'::jsonb)$sql$,
  'SP001'
);
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT * FROM public.reassign_segments('c1000000-0000-0000-0000-0000000000a1',
    '[{"segment_id": "c3000000-0000-0000-0000-000000000021", "expected_speaker_id": null, "speaker_id": null}]'::jsonb)$sql$,
  'SP001'
);
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT * FROM public.reassign_segments('c1000000-0000-0000-0000-0000000000b1',
    '[{"segment_id": "c3000000-0000-0000-0000-0000000000b1", "expected_speaker_id": "c2000000-0000-0000-0000-0000000000b1", "speaker_id": null}]'::jsonb)$sql$,
  'SP001'
);
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT * FROM public.reassign_segments('c1000000-0000-0000-0000-0000000000a1',
    '[{"segment_id": "c3000000-0000-0000-0000-000000000012", "expected_speaker_id": null, "speaker_id": null},
      {"segment_id": "c3000000-0000-0000-0000-000000000012", "expected_speaker_id": null, "speaker_id": null}]'::jsonb)$sql$,
  'SP003'
);
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT * FROM public.reassign_segments('c1000000-0000-0000-0000-0000000000a1', '[]'::jsonb)$sql$,
  'SP003'
);
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT * FROM public.reassign_segments('c1000000-0000-0000-0000-0000000000a1',
    '[{"segment_id": "c3000000-0000-0000-0000-000000000012", "speaker_id": null}]'::jsonb)$sql$,
  'SP003'
);
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT * FROM public.reassign_segments('c1000000-0000-0000-0000-0000000000a1',
    '[{"segment_id": "not-a-uuid", "expected_speaker_id": null, "speaker_id": null}]'::jsonb)$sql$,
  'SP003'
);

-- --------------------------------------------- assign_segments_to_new_speaker ----

SELECT pg_temp.assert_true(
  (SELECT ordinal = 2 AND custom_label = 'Guest' AND diarization_index IS NULL
          AND user_id = 'c0000000-0000-0000-0000-00000000000a'
   FROM public.assign_segments_to_new_speaker(
     'c1000000-0000-0000-0000-0000000000a1', ' Guest ',
     (SELECT jsonb_build_array(jsonb_build_object('segment_id', 'c3000000-0000-0000-0000-000000000013', 'expected_speaker_id', a1_s0)) FROM ids))),
  'a new speaker takes the next free ordinal and the trimmed label'
);
SELECT pg_temp.assert_true(
  (SELECT sp.custom_label FROM public.segments AS sg JOIN public.speakers AS sp ON sp.id = sg.speaker_id
   WHERE sg.id = 'c3000000-0000-0000-0000-000000000013') = 'Guest',
  'the segment moves to the new speaker'
);

SELECT pg_temp.assert_sqlstate(
  $sql$SELECT public.assign_segments_to_new_speaker('c1000000-0000-0000-0000-0000000000a1', 'Late',
    (SELECT jsonb_build_array(jsonb_build_object('segment_id', 'c3000000-0000-0000-0000-000000000011', 'expected_speaker_id', a1_s0)) FROM ids))$sql$,
  'SP002'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.speakers WHERE custom_label = 'Late')
  AND (SELECT count(*) FROM public.speakers WHERE transcript_id = 'c1000000-0000-0000-0000-0000000000a1') = 3,
  'a refused move leaves no new speaker behind'
);

SELECT pg_temp.assert_sqlstate(
  $sql$SELECT public.assign_segments_to_new_speaker('c1000000-0000-0000-0000-0000000000a1', '   ',
    '[{"segment_id": "c3000000-0000-0000-0000-000000000011", "expected_speaker_id": null}]'::jsonb)$sql$,
  'SP003'
);
SELECT pg_temp.assert_sqlstate(
  format($sql$SELECT public.assign_segments_to_new_speaker('c1000000-0000-0000-0000-0000000000a1', %L,
    '[{"segment_id": "c3000000-0000-0000-0000-000000000011", "expected_speaker_id": null}]'::jsonb)$sql$, repeat('y', 51)),
  'SP003'
);
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT public.assign_segments_to_new_speaker('c1000000-0000-0000-0000-0000000000a1', 'Nobody', '[]'::jsonb)$sql$,
  'SP003'
);
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT public.assign_segments_to_new_speaker('c1000000-0000-0000-0000-0000000000b1', 'Intruder',
    '[{"segment_id": "c3000000-0000-0000-0000-0000000000b1", "expected_speaker_id": "c2000000-0000-0000-0000-0000000000b1"}]'::jsonb)$sql$,
  'SP001'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.speakers WHERE transcript_id = 'c1000000-0000-0000-0000-0000000000a1') = 3,
  'refused creations leave the speaker count unchanged'
);

-- ---------------------------------------------------------------- deletion ----

DELETE FROM public.transcripts WHERE id = 'c1000000-0000-0000-0000-0000000000a2';

RESET ROLE;

SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.speakers WHERE transcript_id = 'c1000000-0000-0000-0000-0000000000a2')
  AND NOT EXISTS (SELECT 1 FROM public.segments WHERE transcript_id = 'c1000000-0000-0000-0000-0000000000a2'),
  'deleting a transcript removes its speakers and segments'
);

-- Only server code can delete a speaker now; its segments become Unknown.
DELETE FROM public.speakers WHERE id = (SELECT a1_s1 FROM ids);
SELECT pg_temp.assert_true(
  (SELECT speaker_id IS NULL AND transcript_id = 'c1000000-0000-0000-0000-0000000000a1'
   FROM public.segments WHERE id = 'c3000000-0000-0000-0000-000000000011'),
  'deleting a speaker unassigns its segments and keeps them in their transcript'
);

ROLLBACK;
SELECT 'speakers smoke test passed' AS result;
