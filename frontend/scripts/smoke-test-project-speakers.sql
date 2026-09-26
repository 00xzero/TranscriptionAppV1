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

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'speakers-smoke-a@example.test', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'speakers-smoke-b@example.test', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );

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

-- updated_at descending across T1, T2, T3 fixes the preview order.
INSERT INTO public.transcripts (id, user_id, project_id, title, status, updated_at) VALUES
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'T1', 'completed', '2026-09-03T00:00:00Z'),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'T2', 'completed', '2026-09-02T00:00:00Z'),
  ('70000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003', 'T3', 'completed', '2026-09-01T00:00:00Z'),
  ('70000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000004', 'T4', 'completed', '2026-09-04T00:00:00Z'),
  ('70000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000005', 'T5', 'completed', '2026-09-05T00:00:00Z'),
  ('70000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000020', 'T6', 'completed', '2026-09-06T00:00:00Z');

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

-- T7, in a root of its own, holds a linked person and an unlinked voice. The
-- linked speaker has no label and a later ordinal, as naming someone leaves it.
INSERT INTO public.projects (id, user_id, parent_id, name) VALUES
  ('60000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', null, 'People');
INSERT INTO public.transcripts (id, user_id, project_id, title, status, updated_at) VALUES
  ('70000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000008', 'T7', 'completed', '2026-09-07T00:00:00Z');
INSERT INTO public.people (id, user_id, name, preferred_color) VALUES
  ('90000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Ada Lovelace', '#0D9488');
INSERT INTO public.speakers (id, transcript_id, user_id, ordinal, custom_label, person_id, created_at) VALUES
  ('80000000-0000-0000-0000-000000000060', '70000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 1, null, null,                                   '2026-01-07T00:00:00Z'),
  ('80000000-0000-0000-0000-000000000061', '70000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 3, null, '90000000-0000-0000-0000-000000000001', '2026-01-07T00:00:01Z');
INSERT INTO public.segments (transcript_id, speaker_id, start_ms, end_ms, text) VALUES
  ('70000000-0000-0000-0000-000000000007', '80000000-0000-0000-0000-000000000060', 0,    1000, 'voice'),
  ('70000000-0000-0000-0000-000000000007', '80000000-0000-0000-0000-000000000061', 1000, 2000, 'ada');

-- deleting_at is server-managed, so it is set before dropping to authenticated.
UPDATE public.projects SET deleting_at = now()
WHERE id IN ('60000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000007');

SET LOCAL request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
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
    WHERE p ->> 'customLabel' IN ('Hidden', 'AlsoHidden')
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
    WHERE p ->> 'customLabel' = 'Unused'
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

-- The preview carries the fields the client's label resolver needs, and no
-- longer the dropped label and color columns.
SELECT pg_temp.assert_true(
  (SELECT p ->> 'ordinal' = '2' AND p ->> 'customLabel' = 'John Smith'
          AND NOT p ? 'label' AND NOT p ? 'color'
   FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], false) AS s,
     LATERAL jsonb_array_elements(s.preview) AS p
   WHERE p ->> 'customLabel' = 'John Smith'),
  'a preview entry carries ordinal and customLabel, not label or color'
);

SELECT pg_temp.assert_true(
  (SELECT p -> 'customLabel' = 'null'::jsonb AND (p ->> 'ordinal')::int = 3
   FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000003']::uuid[], false) AS s,
     LATERAL jsonb_array_elements(s.preview) AS p),
  'a generic speaker has a null customLabel and its ordinal'
);

-- A linked speaker carries its person's name and colour, so the avatar reads as
-- the person and not as its own unlabelled row. An unlinked voice has neither,
-- and the positional palette index is gone.
SELECT pg_temp.assert_true(
  (SELECT p ->> 'personName' = 'Ada Lovelace' AND p ->> 'personColor' = '#0D9488'
   FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000008']::uuid[], false) AS s,
     LATERAL jsonb_array_elements(s.preview) AS p
   WHERE p ->> 'id' = '80000000-0000-0000-0000-000000000061'),
  'a linked speaker carries its person''s name and preferred colour'
);

SELECT pg_temp.assert_true(
  (SELECT p -> 'personName' = 'null'::jsonb AND p -> 'personColor' = 'null'::jsonb
   FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000008']::uuid[], false) AS s,
     LATERAL jsonb_array_elements(s.preview) AS p
   WHERE p ->> 'id' = '80000000-0000-0000-0000-000000000060'),
  'an unlinked voice carries no person name or colour'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM public.project_speaker_summaries(
      ARRAY['60000000-0000-0000-0000-000000000001',
            '60000000-0000-0000-0000-000000000008']::uuid[], true) AS s,
      LATERAL jsonb_array_elements(s.preview) AS p
    WHERE p ? 'paletteIndex'
  ),
  'a preview entry no longer carries a palette index'
);

-- -------------------------------------------------------------- preview ----

-- Transcript updated_at descending, then speaker created_at: T1 before T2
-- before T3, Kate before John Smith.
SELECT pg_temp.assert_true(
  (SELECT array_agg(p ->> 'customLabel' ORDER BY ord)
   FROM public.project_speaker_summaries(
     ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], true) AS s,
     LATERAL jsonb_array_elements(s.preview) WITH ORDINALITY AS t(p, ord))
  = ARRAY['Kate', 'John Smith', 'Sarah', 'Zed'],
  'the preview is ordered by transcript recency then speaker creation'
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
