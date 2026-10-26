-- Local-only behavioural coverage for 20261010120000_server_owned_writes.sql:
-- the writes the browser keeps, link-once media, and folder-based deletion.
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
-- User A owns T1 (completed, linked media plus an unlinked waveform), T2 (no
-- media yet) and T3 (inside project P). User B owns TB.

INSERT INTO public.app_users (id, workos_user_id, email) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'user_f1000000000040008000000000000001', 'owned-writes-a@example.test'),
  ('f1000000-0000-4000-8000-000000000002', 'user_f1000000000040008000000000000002', 'owned-writes-b@example.test');

INSERT INTO public.projects (id, user_id, name) VALUES
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'P');

INSERT INTO public.transcripts (id, user_id, project_id, title, source_object_key) VALUES
  ('f3000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', NULL, 'T1',
   'f1000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000001/audio.webm'),
  ('f3000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', NULL, 'T2', NULL),
  ('f3000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001',
   'f2000000-0000-4000-8000-000000000001', 'T3',
   'f1000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000003/audio.webm'),
  ('f3000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-000000000002', NULL, 'TB',
   'f1000000-0000-4000-8000-000000000002/f3000000-0000-4000-8000-00000000000b/audio.webm');

INSERT INTO public.jobs (transcript_id, type, status) VALUES
  ('f3000000-0000-4000-8000-000000000001', 'transcription', 'completed');
INSERT INTO public.segments (id, transcript_id, start_ms, end_ms, text) VALUES
  ('f6000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 0, 1000, 'hello');
INSERT INTO public.watchlist (transcript_id, term, canonical) VALUES
  ('f3000000-0000-4000-8000-000000000001', 'Acme', 'acme');

INSERT INTO storage.objects (bucket_id, name) VALUES
  ('media', 'f1000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000001/audio.webm'),
  ('waveforms', 'f1000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000001/waveform.json'),
  ('media', 'f1000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000003/audio.webm'),
  ('media', 'f1000000-0000-4000-8000-000000000002/f3000000-0000-4000-8000-00000000000b/audio.webm');

-- ----------------------------------------------------------- privileges ----

SELECT pg_temp.assert_true(
  (SELECT bool_and(has_function_privilege('authenticated', f, 'EXECUTE')
      AND NOT has_function_privilege('anon', f, 'EXECUTE')
      AND NOT has_function_privilege('service_role', f, 'EXECUTE'))
   FROM unnest(ARRAY[
     'public.transcript_delete_inventory(uuid[])',
     'public.delete_transcript(uuid)',
     'public.finish_project_delete(uuid,uuid[])'
   ]) AS f)
  AND NOT has_function_privilege('authenticated', 'public.transcript_folder_objects(uuid,uuid[])', 'EXECUTE')
  AND to_regprocedure('public.finish_project_delete(uuid,uuid[],text[],text[])') IS NULL,
  'delete functions are for signed-in users; the folder helper is internal; the old finish is gone'
);
SELECT pg_temp.assert_true(
  NOT has_table_privilege('authenticated', 'public.jobs', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.jobs', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.jobs', 'DELETE')
  AND has_table_privilege('authenticated', 'public.jobs', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.transcripts', 'DELETE')
  AND NOT has_column_privilege('authenticated', 'public.transcripts', 'status', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.transcripts', 'status', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.transcripts', 'duration_seconds', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.transcripts', 'title', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.transcripts', 'source_object_key', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.segments', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.segments', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.watchlist', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.watchlist', 'DELETE'),
  'the authenticated role keeps only the writes the app makes'
);

SET LOCAL request.jwt.claims = '{"sub":"user_f1000000000040008000000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

-- ------------------------------------------------- forged writes refused ----

SELECT pg_temp.assert_sqlstate($sql$UPDATE public.transcripts SET status = 'created'
  WHERE id = 'f3000000-0000-4000-8000-000000000001'$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$UPDATE public.transcripts SET duration_seconds = 1
  WHERE id = 'f3000000-0000-4000-8000-000000000001'$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$INSERT INTO public.transcripts (user_id, title, status)
  VALUES ('f1000000-0000-4000-8000-000000000001', 'Forged', 'completed')$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$INSERT INTO public.jobs (transcript_id, type, status)
  VALUES ('f3000000-0000-4000-8000-000000000002', 'transcription', 'error')$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$UPDATE public.jobs SET status = 'processing'
  WHERE transcript_id = 'f3000000-0000-4000-8000-000000000001'$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$DELETE FROM public.jobs
  WHERE transcript_id = 'f3000000-0000-4000-8000-000000000001'$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$INSERT INTO public.segments (transcript_id, start_ms, end_ms, text)
  VALUES ('f3000000-0000-4000-8000-000000000001', 0, 1, 'forged')$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$DELETE FROM public.segments
  WHERE transcript_id = 'f3000000-0000-4000-8000-000000000001'$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$UPDATE public.segments SET start_ms = 5
  WHERE id = 'f6000000-0000-4000-8000-000000000001'$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$UPDATE public.watchlist SET term = 'Forged'
  WHERE transcript_id = 'f3000000-0000-4000-8000-000000000001'$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$DELETE FROM public.watchlist
  WHERE transcript_id = 'f3000000-0000-4000-8000-000000000001'$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$DELETE FROM public.transcripts
  WHERE id = 'f3000000-0000-4000-8000-000000000001'$sql$, '42501');

-- ------------------------------------------------ allowed writes still work ----

UPDATE public.transcripts SET title = 'T1 renamed' WHERE id = 'f3000000-0000-4000-8000-000000000001';
UPDATE public.transcripts SET project_id = 'f2000000-0000-4000-8000-000000000001'
  WHERE id = 'f3000000-0000-4000-8000-000000000002';
UPDATE public.transcripts SET project_id = NULL WHERE id = 'f3000000-0000-4000-8000-000000000002';
UPDATE public.segments SET text = 'edited', is_edited = true WHERE id = 'f6000000-0000-4000-8000-000000000001';
INSERT INTO public.watchlist (transcript_id, term, canonical)
  VALUES ('f3000000-0000-4000-8000-000000000001', 'Globex', 'globex');
SELECT pg_temp.assert_true(
  (SELECT title = 'T1 renamed' FROM public.transcripts WHERE id = 'f3000000-0000-4000-8000-000000000001')
  AND (SELECT text = 'edited' FROM public.segments WHERE id = 'f6000000-0000-4000-8000-000000000001')
  AND (SELECT count(*) = 2 FROM public.watchlist WHERE transcript_id = 'f3000000-0000-4000-8000-000000000001'),
  'title, project, segment text and watchlist inserts stay writable'
);

-- ----------------------------------------- media is linked once, in-folder ----

SELECT pg_temp.assert_sqlstate($sql$UPDATE public.transcripts
  SET source_object_key = 'f1000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000001/audio.webm'
  WHERE id = 'f3000000-0000-4000-8000-000000000002'$sql$, '23514');
SELECT pg_temp.assert_sqlstate($sql$UPDATE public.transcripts
  SET source_object_key = 'f1000000-0000-4000-8000-000000000002/f3000000-0000-4000-8000-000000000002/audio.webm'
  WHERE id = 'f3000000-0000-4000-8000-000000000002'$sql$, '23514');
UPDATE public.transcripts
  SET source_object_key = 'f1000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000002/audio.webm'
  WHERE id = 'f3000000-0000-4000-8000-000000000002';
UPDATE public.transcripts
  SET source_object_key = 'f1000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000002/audio.webm'
  WHERE id = 'f3000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_sqlstate($sql$UPDATE public.transcripts
  SET source_object_key = 'f1000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000002/other.webm'
  WHERE id = 'f3000000-0000-4000-8000-000000000002'$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$UPDATE public.transcripts SET source_object_key = NULL
  WHERE id = 'f3000000-0000-4000-8000-000000000002'$sql$, '42501');

-- ------------------------------------------------------ delete_transcript ----

SELECT pg_temp.assert_sqlstate($sql$SELECT public.delete_transcript('f3000000-0000-4000-8000-000000000001')$sql$, 'TR002');
SELECT pg_temp.assert_true(
  (SELECT media_keys = ARRAY['f1000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000001/audio.webm']
      AND waveform_keys = ARRAY['f1000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000001/waveform.json']
   FROM public.transcript_delete_inventory(ARRAY['f3000000-0000-4000-8000-000000000001']::uuid[])),
  'the inventory lists linked and unlinked files'
);

-- What the Storage API does when the route removes the linked media.
SET LOCAL storage.allow_delete_query = 'true';
RESET ROLE;
DELETE FROM storage.objects WHERE bucket_id = 'media'
  AND name = 'f1000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000001/audio.webm';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_sqlstate($sql$SELECT public.delete_transcript('f3000000-0000-4000-8000-000000000001')$sql$, 'TR002');

RESET ROLE;
DELETE FROM storage.objects WHERE bucket_id = 'waveforms'
  AND name = 'f1000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000001/waveform.json';
SET LOCAL ROLE authenticated;
SELECT public.delete_transcript('f3000000-0000-4000-8000-000000000001');

RESET ROLE;
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.transcripts WHERE id = 'f3000000-0000-4000-8000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.segments WHERE transcript_id = 'f3000000-0000-4000-8000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.jobs WHERE transcript_id = 'f3000000-0000-4000-8000-000000000001'),
  'an empty folder lets the row go, with its segments and jobs'
);
-- A file that lands after the delete is still found by the inventory.
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('media', 'f1000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000001/late.webm');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT media_keys = ARRAY['f1000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000001/late.webm']
   FROM public.transcript_delete_inventory(ARRAY['f3000000-0000-4000-8000-000000000001']::uuid[])),
  'the inventory works after the row is gone'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.delete_transcript('f3000000-0000-4000-8000-000000000001')$sql$, 'TR001');

-- Another user's transcript is not found, and their folder is not listed.
SELECT pg_temp.assert_sqlstate($sql$SELECT public.delete_transcript('f3000000-0000-4000-8000-00000000000b')$sql$, 'TR001');
SELECT pg_temp.assert_true(
  (SELECT cardinality(media_keys) = 0
   FROM public.transcript_delete_inventory(ARRAY['f3000000-0000-4000-8000-00000000000b']::uuid[])),
  'the inventory only lists the caller''s own folders'
);

-- ------------------------------------------------- inside a marked project ----

DO $$
DECLARE inventory record;
BEGIN
  SELECT * INTO inventory FROM public.begin_project_delete('f2000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.assert_true(cardinality(inventory.media_keys) = 1, 'begin lists the branch folders');
END;
$$;
SELECT pg_temp.assert_sqlstate($sql$SELECT public.delete_transcript('f3000000-0000-4000-8000-000000000003')$sql$, 'PJ002');
SELECT pg_temp.assert_sqlstate($sql$SELECT * FROM public.finish_project_delete('f2000000-0000-4000-8000-000000000001',
  ARRAY['f3000000-0000-4000-8000-000000000003']::uuid[])$sql$, 'PJ005');

-- ----------------------------------------------------------- no session ----

SET LOCAL request.jwt.claims = '{"role":"authenticated"}';
SELECT pg_temp.assert_sqlstate($sql$SELECT public.delete_transcript('f3000000-0000-4000-8000-000000000002')$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$SELECT * FROM public.transcript_delete_inventory(
  ARRAY['f3000000-0000-4000-8000-000000000002']::uuid[])$sql$, '42501');

RESET ROLE;
ROLLBACK;
SELECT 'server-owned writes smoke test passed' AS result;
