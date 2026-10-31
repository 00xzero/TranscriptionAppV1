-- Behavioural coverage for public.project_speaker_summaries, run against the
-- local Supabase database:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f frontend/scripts/smoke-test-project-speakers.sql
--
-- Separate from smoke-test-projects.sql on purpose: that script deletes its own
-- project fixtures as part of the deletion protocol it exercises, so assertions
-- appended after it would run against a half-deleted tree.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(value boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assertion failed: %', message;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(boolean, text) TO authenticated, service_role;

-- A voice entry's own row among its transcript's peers: its ordinal and label.
CREATE OR REPLACE FUNCTION pg_temp.own(entry jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT q FROM jsonb_array_elements(entry -> 'peers') AS q WHERE q ->> 'id' = entry ->> 'id'
$$;

GRANT EXECUTE ON FUNCTION pg_temp.own(jsonb) TO authenticated;

INSERT INTO public.app_users (id, workos_user_id) VALUES
  ('10000000-0000-0000-0000-000000000001', 'user_10000000000000000000000000000001'),
  ('10000000-0000-0000-0000-000000000002', 'user_10000000000000000000000000000002');

-- Tree for user A:
--   Root ── Child ── Grand
--    ├───── Deleting ── DeletingChild      (pruned as a whole subtree)
--   Empty                                   (no transcripts at all)
--   DeletingRoot                            (requested directly; must vanish)
INSERT INTO public.projects (id, user_id, parent_id, name) VALUES
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, 'Root'),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'Child'),
  ('60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'Grand'),
  ('60000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'Deleting'),
  ('60000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000004', 'DeletingChild'),
  ('60000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', null, 'Empty'),
  ('60000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', null, 'DeletingRoot'),
  ('60000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000002', null, 'Other user');

-- created_at descending across T1, T2, T3 fixes the preview order: a voice
-- follows the recency of its transcript.
INSERT INTO public.transcripts (id, user_id, project_id, title, status, created_at, updated_at) VALUES
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'T1', 'completed', '2026-08-03T00:00:00Z', '2026-09-03T00:00:00Z'),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'T2', 'completed', '2026-08-02T00:00:00Z', '2026-09-02T00:00:00Z'),
  ('70000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003', 'T3', 'completed', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('70000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000004', 'T4', 'completed', '2026-08-04T00:00:00Z', '2026-09-04T00:00:00Z'),
  ('70000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000005', 'T5', 'completed', '2026-08-05T00:00:00Z', '2026-09-05T00:00:00Z'),
  ('70000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000020', 'T6', 'completed', '2026-08-06T00:00:00Z', '2026-09-06T00:00:00Z');

-- T1's 'Unused' has no segments, so it must not be counted.
-- T2 carries the tie case: Sarah and Zed share a created_at, so only id breaks it.
-- T3's speaker is generic: no custom label, so it displays as Speaker 3.
INSERT INTO public.speakers (id, transcript_id, user_id, ordinal, custom_label, created_at) VALUES
  ('80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 0, 'Kate',       '2026-01-01T00:00:00Z'),
  ('80000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, 'Unused',     '2026-01-01T00:00:01Z'),
  ('80000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 2, 'John Smith', '2026-01-01T00:00:02Z'),
  ('80000000-0000-0000-0000-000000000010', '70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 0, 'Sarah',      '2026-01-02T00:00:00Z'),
  ('80000000-0000-0000-0000-000000000011', '70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 1, 'Zed',        '2026-01-02T00:00:00Z'),
  ('80000000-0000-0000-0000-000000000020', '70000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 3, null,         '2026-01-03T00:00:00Z'),
  ('80000000-0000-0000-0000-000000000030', '70000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 0, 'Hidden',     '2026-01-04T00:00:00Z'),
  ('80000000-0000-0000-0000-000000000040', '70000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 0, 'AlsoHidden', '2026-01-05T00:00:00Z'),
  ('80000000-0000-0000-0000-000000000050', '70000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', 0, 'Foreign',    '2026-01-06T00:00:00Z');

-- Kate gets two segments (must still count once); one T1 segment is unassigned.
INSERT INTO public.segments (transcript_id, speaker_id, start_ms, end_ms, text) VALUES
  ('70000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 0,    1000, 'one'),
  ('70000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 1000, 2000, 'two'),
  ('70000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000003', 2000, 3000, 'three'),
  ('70000000-0000-0000-0000-000000000001', null,                                   3000, 4000, 'unassigned'),
  ('70000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000010', 0,    1000, 'sarah'),
  ('70000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000011', 1000, 2000, 'zed'),
  ('70000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000020', 0,    1000, 'mark'),
  ('70000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-000000000030', 0,    1000, 'hidden'),
  ('70000000-0000-0000-0000-000000000005', '80000000-0000-0000-0000-000000000040', 0,    1000, 'also hidden'),
  ('70000000-0000-0000-0000-000000000006', '80000000-0000-0000-0000-000000000050', 0,    1000, 'foreign');

-- The People root holds T7 and T8. T7 has an unlinked voice, Ada, and Bea,
-- who is hidden; T8 is newer by created_at (though older by updated_at) and
-- has Ada on two voices. Linked speakers have no label and a later ordinal, as
-- naming someone leaves them.
INSERT INTO public.projects (id, user_id, parent_id, name) VALUES
  ('60000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', null, 'People');
INSERT INTO public.transcripts (id, user_id, project_id, title, status, created_at, updated_at) VALUES
  ('70000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000008', 'T7', 'completed', '2026-09-07T00:00:00Z', '2026-09-07T00:00:00Z'),
  ('70000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000008', 'T8', 'completed', '2026-09-08T00:00:00Z', '2026-09-01T00:00:00Z');
INSERT INTO public.organisations (id, user_id, name) VALUES
  ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Example Org');
INSERT INTO public.people (id, user_id, name, preferred_color, organisation_id, hidden) VALUES
  ('90000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Ada Lovelace', '#0D9488', 'a0000000-0000-0000-0000-000000000001', false),
  ('90000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Bea', '#C73E1D', null, true);
INSERT INTO public.speakers (id, transcript_id, user_id, ordinal, custom_label, person_id, created_at) VALUES
  ('80000000-0000-0000-0000-000000000060', '70000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 1, null, null,                                   '2026-01-07T00:00:00Z'),
  ('80000000-0000-0000-0000-000000000061', '70000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 3, null, '90000000-0000-0000-0000-000000000001', '2026-01-07T00:00:01Z'),
  ('80000000-0000-0000-0000-000000000062', '70000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 4, null, '90000000-0000-0000-0000-000000000002', '2026-01-07T00:00:02Z'),
  ('80000000-0000-0000-0000-000000000070', '70000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 3, null, '90000000-0000-0000-0000-000000000001', '2026-01-08T00:00:00Z'),
  ('80000000-0000-0000-0000-000000000071', '70000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 4, null, '90000000-0000-0000-0000-000000000001', '2026-01-08T00:00:01Z');
INSERT INTO public.segments (transcript_id, speaker_id, start_ms, end_ms, text) VALUES
  ('70000000-0000-0000-0000-000000000007', '80000000-0000-0000-0000-000000000060', 0,    1000, 'voice'),
  ('70000000-0000-0000-0000-000000000007', '80000000-0000-0000-0000-000000000061', 1000, 2000, 'ada'),
  ('70000000-0000-0000-0000-000000000007', '80000000-0000-0000-0000-000000000062', 2000, 3000, 'bea'),
  ('70000000-0000-0000-0000-000000000008', '80000000-0000-0000-0000-000000000070', 0,    1000, 'ada again'),
  ('70000000-0000-0000-0000-000000000008', '80000000-0000-0000-0000-000000000071', 1000, 2000, 'ada, second voice');

-- Parent and Kid, to request together: Cy appears in both, and Kid has a voice.
INSERT INTO public.projects (id, user_id, parent_id, name) VALUES
  ('60000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', null, 'Parent'),
  ('60000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000009', 'Kid');
INSERT INTO public.transcripts (id, user_id, project_id, title, status, created_at) VALUES
  ('70000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000009', 'T9', 'completed', '2026-09-09T00:00:00Z'),
  ('70000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-00000000000a', 'T10', 'completed', '2026-09-10T00:00:00Z');
INSERT INTO public.people (id, user_id, name, preferred_color) VALUES
  ('90000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Cy', '#CA8A04');
INSERT INTO public.speakers (id, transcript_id, user_id, ordinal, custom_label, person_id) VALUES
  ('80000000-0000-0000-0000-000000000090', '70000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 3, null, '90000000-0000-0000-0000-000000000003'),
  ('80000000-0000-0000-0000-0000000000a0', '70000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 1, null, null),
  ('80000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 3, null, '90000000-0000-0000-0000-000000000003');
INSERT INTO public.segments (transcript_id, speaker_id, start_ms, end_ms, text) VALUES
  ('70000000-0000-0000-0000-000000000009', '80000000-0000-0000-0000-000000000090', 0,    1000, 'cy in parent'),
  ('70000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-0000000000a1', 0,    1000, 'cy in kid'),
  ('70000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-0000000000a0', 1000, 2000, 'voice in kid');

-- deleting_at is server-managed, so it is set before dropping to authenticated.
UPDATE public.projects SET deleting_at = now()
WHERE id IN ('60000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000007');

SET LOCAL request.jwt.claims = '{"sub":"user_10000000000000000000000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------- scope ----

SELECT pg_temp.assert_true(
  (SELECT speaker_count FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], false)) = 2,
  'direct scope counts only the project''s own transcripts'
);

SELECT pg_temp.assert_true(
  (SELECT speaker_count FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], true)) = 5,
  'branch scope counts descendants but not the deleting subtree'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM public.project_speaker_summaries(
      ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], true) AS s,
      LATERAL jsonb_array_elements(s.preview) AS p
    WHERE pg_temp.own(p) ->> 'customLabel' IN ('Hidden', 'AlsoHidden')
  ),
  'a deleting project takes its whole subtree out of the branch'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.project_speaker_summaries(
      ARRAY['60000000-0000-0000-0000-000000000007']::uuid[], true)
  ),
  'a requested root that is itself deleting is excluded entirely'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.project_speaker_summaries(
      ARRAY['60000000-0000-0000-0000-000000000020']::uuid[], true)
  ),
  'another user''s project is not returned'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000001',
           '60000000-0000-0000-0000-000000000020']::uuid[], true)) = 1,
  'a mixed request returns only the owned projects'
);

-- ------------------------------------------------------------- counting ----

SELECT pg_temp.assert_true(
  (SELECT speaker_count FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000006']::uuid[], true)) = 0,
  'an owned project with no transcripts reports zero speakers'
);

SELECT pg_temp.assert_true(
  (SELECT preview FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000006']::uuid[], true)) = '[]'::jsonb,
  'an empty project returns an empty array, never null'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM public.project_speaker_summaries(
      ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], false) AS s,
      LATERAL jsonb_array_elements(s.preview) AS p
    WHERE pg_temp.own(p) ->> 'customLabel' = 'Unused'
  ),
  'a speaker row with no segments is not counted'
);

-- Kate has two segments and John Smith one, and the unassigned segment adds
-- nobody: two speakers, not three or four.
SELECT pg_temp.assert_true(
  (SELECT jsonb_array_length(preview) FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], false)) = 2,
  'repeated segments from one speaker count once and unassigned segments count for nobody'
);

-- ---------------------------------------------------------- label data ----

-- A voice carries its transcript's identities with segments, itself included,
-- so the client labels it as the editor does; never the dropped label or color.
SELECT pg_temp.assert_true(
  (SELECT p ->> 'kind' = 'voice' AND p ->> 'transcriptTitle' = 'T1'
          AND (pg_temp.own(p) ->> 'ordinal')::int = 2 AND pg_temp.own(p) ->> 'customLabel' = 'John Smith'
          AND NOT p ? 'label' AND NOT p ? 'color'
   FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], false) AS s,
     LATERAL jsonb_array_elements(s.preview) AS p
   WHERE pg_temp.own(p) ->> 'customLabel' = 'John Smith'),
  'a voice entry carries its transcript title and its own ordinal and label among its peers'
);

SELECT pg_temp.assert_true(
  (SELECT pg_temp.own(p) -> 'customLabel' = 'null'::jsonb AND (pg_temp.own(p) ->> 'ordinal')::int = 3
   FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000003']::uuid[], false) AS s,
     LATERAL jsonb_array_elements(s.preview) AS p),
  'a generic voice has a null customLabel and its ordinal'
);

-- Peers list the transcript's speakers with segments in order of first
-- appearance, linked ones with their person's name and organisation.
SELECT pg_temp.assert_true(
  (SELECT array_agg(q ->> 'id' ORDER BY ord) = ARRAY[
      '80000000-0000-0000-0000-000000000060', '80000000-0000-0000-0000-000000000061',
      '80000000-0000-0000-0000-000000000062']
     AND (p -> 'peers' -> 1 ->> 'personName') = 'Ada Lovelace'
     AND (p -> 'peers' -> 1 ->> 'organisationName') = 'Example Org'
   FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000008']::uuid[], false) AS s,
     LATERAL jsonb_array_elements(s.preview) AS p,
     LATERAL jsonb_array_elements(p -> 'peers') WITH ORDINALITY AS t(q, ord)
   WHERE p ->> 'kind' = 'voice'
   GROUP BY p),
  'a voice''s peers are its transcript''s identities in order of first appearance'
);

-- A linked person is the entry, named and coloured as themselves, with their
-- organisation; the voice carrying them is not listed on its own.
SELECT pg_temp.assert_true(
  (SELECT p ->> 'kind' = 'person' AND p ->> 'name' = 'Ada Lovelace' AND p ->> 'color' = '#0D9488'
          AND p ->> 'organisationName' = 'Example Org'
   FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000008']::uuid[], false) AS s,
     LATERAL jsonb_array_elements(s.preview) AS p
   WHERE p ->> 'id' = '90000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (
    SELECT 1
    FROM public.project_speaker_summaries(
      ARRAY['60000000-0000-0000-0000-000000000008']::uuid[], false) AS s,
      LATERAL jsonb_array_elements(s.preview) AS p
    WHERE p ->> 'id' IN ('80000000-0000-0000-0000-000000000061', '80000000-0000-0000-0000-000000000070')),
  'a linked person is previewed as the person, with name, colour and organisation'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM public.project_speaker_summaries(
      ARRAY['60000000-0000-0000-0000-000000000001',
            '60000000-0000-0000-0000-000000000008']::uuid[], true) AS s,
      LATERAL jsonb_array_elements(s.preview) AS p
    WHERE p ? 'paletteIndex' OR (p ->> 'kind' = 'voice' AND p ? 'color')
  ),
  'no entry carries a palette index, and a voice carries no colour'
);

-- ------------------------------------------------------- counting people ----

-- Ada is in T7 and T8, on two voices in T8: she counts once. Bea is hidden and
-- still counts. With T7's unlinked voice, that is three.
SELECT pg_temp.assert_true(
  (SELECT speaker_count FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000008']::uuid[], false)) = 3,
  'a person counts once however many transcripts and voices carry them; hidden people count'
);

-- People first, by most recent appearance: Ada was last in T8, newer by
-- created_at than T7 though older by updated_at, so she leads Bea.
SELECT pg_temp.assert_true(
  (SELECT array_agg(coalesce(p ->> 'name', p ->> 'kind') ORDER BY ord)
   FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000008']::uuid[], false) AS s,
     LATERAL jsonb_array_elements(s.preview) WITH ORDINALITY AS t(p, ord))
  = ARRAY['Ada Lovelace', 'Bea', 'voice'],
  'people come first, by most recent appearance, then voices'
);

-- Requested together, Parent (with its branch) and Kid each report their own
-- scope: Cy once in each row, and Kid's voice in both.
SELECT pg_temp.assert_true(
  (SELECT array_agg(s.project_id::text || ':' || s.speaker_count || ':' ||
     (SELECT string_agg(coalesce(p ->> 'name', p ->> 'id'), ',' ORDER BY ord)
      FROM jsonb_array_elements(s.preview) WITH ORDINALITY AS t(p, ord)) ORDER BY s.project_id)
   FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000009', '60000000-0000-0000-0000-00000000000a']::uuid[], true) AS s)
  = ARRAY[
    '60000000-0000-0000-0000-000000000009:2:Cy,80000000-0000-0000-0000-0000000000a0',
    '60000000-0000-0000-0000-00000000000a:2:Cy,80000000-0000-0000-0000-0000000000a0'],
  'a parent and child requested together each count their own scope'
);

-- -------------------------------------------------------------- preview ----

-- Voices by transcript created_at descending, then first appearance: T1
-- before T2 before T3, Kate before John Smith.
SELECT pg_temp.assert_true(
  (SELECT array_agg(pg_temp.own(p) ->> 'customLabel' ORDER BY ord)
   FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], true) AS s,
     LATERAL jsonb_array_elements(s.preview) WITH ORDINALITY AS t(p, ord))
  = ARRAY['Kate', 'John Smith', 'Sarah', 'Zed'],
  'voices are ordered by transcript recency then first appearance'
);

SELECT pg_temp.assert_true(
  (SELECT jsonb_array_length(preview) = 2 AND speaker_count = 5
   FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], true, 2)),
  'the preview truncates while the count stays whole'
);

SELECT pg_temp.assert_true(
  (SELECT preview = '[]'::jsonb AND speaker_count = 5
   FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], true, 0)),
  'a zero preview limit yields an empty array, not null'
);

SELECT pg_temp.assert_true(
  (SELECT jsonb_array_length(preview) FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], true, 99)) = 4,
  'an oversized preview limit is clamped to four'
);

-- ---------------------------------------------------------------- input ----

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000001',
           '60000000-0000-0000-0000-000000000001']::uuid[], true)) = 1,
  'a duplicated project id yields one row'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.project_speaker_summaries(null, true)),
  'a null project array returns no rows'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.project_speaker_summaries(ARRAY[]::uuid[], true)),
  'an empty project array returns no rows'
);

-- ----------------------------------------------------------- privileges ----

RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM 1 FROM public.project_speaker_summaries(
    ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], true);
  RAISE EXCEPTION 'service_role must not be able to execute the summary function';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END;
$$;

RESET ROLE;

ROLLBACK;
SELECT 'project speaker summaries smoke test passed' AS result;
