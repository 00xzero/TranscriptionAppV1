-- Run against the local Supabase database:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f frontend/scripts/smoke-test-projects.sql

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

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.assert_sqlstate(text, text) TO authenticated, service_role;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'projects-smoke-a@example.test', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'projects-smoke-b@example.test', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );

SET LOCAL request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

INSERT INTO public.projects (id, user_id, parent_id, name) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, 'Work'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Client'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Calls'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', null, 'Personal'),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', 'Client');

SELECT pg_temp.assert_sqlstate(
  $sql$INSERT INTO public.projects (user_id, parent_id, name)
       VALUES ('10000000-0000-0000-0000-000000000001', null, 'work')$sql$,
  '23505'
);
SELECT pg_temp.assert_sqlstate(
  $sql$UPDATE public.projects SET parent_id = '20000000-0000-0000-0000-000000000004'
       WHERE id = '20000000-0000-0000-0000-000000000002'$sql$,
  '23514'
);
SELECT pg_temp.assert_sqlstate(
  $sql$INSERT INTO public.projects (id, user_id, parent_id, name)
       VALUES ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001',
               '20000000-0000-0000-0000-000000000006', 'Self')$sql$,
  '23514'
);
SELECT pg_temp.assert_sqlstate(
  $sql$INSERT INTO public.projects (id, user_id, parent_id, name) VALUES
       ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000007', 'Cycle A'),
       ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', 'Cycle B')$sql$,
  'PJ001'
);
SELECT pg_temp.assert_sqlstate(
  $sql$INSERT INTO public.projects (user_id, parent_id, name)
       VALUES ('10000000-0000-0000-0000-000000000001', '29999999-0000-0000-0000-000000000099', 'Missing')$sql$,
  'PJ001'
);

RESET ROLE;
INSERT INTO public.projects (id, user_id, name)
VALUES ('20000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000002', 'Other user');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_sqlstate(
  $sql$INSERT INTO public.projects (user_id, parent_id, name)
       VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000020', 'Cross user')$sql$,
  'PJ001'
);

INSERT INTO public.transcripts (
  id, user_id, project_id, title, status, source_object_key, waveform_object_key
) VALUES
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Root transcript', 'created', 'a/root.mp3', null),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Nested transcript', 'created', 'a/nested.mp3', null),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'Deep transcript', 'created', 'a/deep.mp3', null);

SELECT pg_temp.assert_sqlstate(
  $sql$INSERT INTO public.transcripts (user_id, project_id, title, status)
       VALUES ('10000000-0000-0000-0000-000000000001', '29999999-0000-0000-0000-000000000099', 'Missing project', 'created')$sql$,
  'PJ001'
);
SELECT pg_temp.assert_sqlstate(
  $sql$INSERT INTO public.transcripts (user_id, project_id, title, status)
       VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000020', 'Cross-user project', 'created')$sql$,
  'PJ001'
);

SELECT pg_temp.assert_sqlstate(
  $sql$DELETE FROM public.projects WHERE id = '20000000-0000-0000-0000-000000000001'$sql$,
  '23503'
);

INSERT INTO public.projects (id, user_id, name)
VALUES ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'Disposable');
INSERT INTO public.transcripts (id, user_id, project_id, title, status)
VALUES ('30000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000008', 'Preserved', 'created');
DELETE FROM public.projects WHERE id = '20000000-0000-0000-0000-000000000008';
SELECT pg_temp.assert_true(
  (SELECT project_id IS NULL AND user_id = '10000000-0000-0000-0000-000000000001'
   FROM public.transcripts WHERE id = '30000000-0000-0000-0000-000000000008'),
  'leaf deletion must null only project_id'
);

SELECT pg_temp.assert_true(
  public.project_branch_transcript_count('20000000-0000-0000-0000-000000000001') = 3,
  'branch count must include descendants'
);

DO $$
DECLARE inventory record;
BEGIN
  SELECT * INTO inventory
  FROM public.begin_project_delete('20000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.assert_true(cardinality(inventory.project_ids) = 3, 'begin project inventory');
  PERFORM pg_temp.assert_true(cardinality(inventory.transcript_ids) = 3, 'begin transcript inventory');
  PERFORM pg_temp.assert_true(cardinality(inventory.media_keys) = 3, 'begin media inventory');
  PERFORM pg_temp.assert_true(cardinality(inventory.waveform_keys) = 0, 'begin waveform inventory');

  PERFORM pg_temp.assert_true(
    (SELECT project_ids = inventory.project_ids
     FROM public.begin_project_delete('20000000-0000-0000-0000-000000000001')),
    'begin retry must be stable'
  );
END;
$$;

SELECT pg_temp.assert_sqlstate(
  $sql$UPDATE public.transcripts SET project_id = '20000000-0000-0000-0000-000000000001'
       WHERE id = '30000000-0000-0000-0000-000000000008'$sql$,
  'PJ002'
);
SELECT pg_temp.assert_sqlstate(
  $sql$UPDATE public.transcripts SET project_id = null
       WHERE id = '30000000-0000-0000-0000-000000000001'$sql$,
  'PJ002'
);
SELECT pg_temp.assert_sqlstate(
  $sql$INSERT INTO public.transcripts (user_id, project_id, title, status)
       VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Late', 'created')$sql$,
  'PJ002'
);
SELECT pg_temp.assert_sqlstate(
  $sql$INSERT INTO public.projects (user_id, parent_id, name)
       VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Late child')$sql$,
  'PJ002'
);
SELECT pg_temp.assert_sqlstate(
  $sql$UPDATE public.projects SET name = 'Renamed'
       WHERE id = '20000000-0000-0000-0000-000000000002'$sql$,
  'PJ002'
);
SELECT pg_temp.assert_sqlstate(
  $sql$UPDATE public.transcripts SET source_object_key = 'a/changed.mp3'
       WHERE id = '30000000-0000-0000-0000-000000000002'$sql$,
  'PJ002'
);
SELECT pg_temp.assert_sqlstate(
  $sql$UPDATE public.projects SET deleting_at = null
       WHERE id = '20000000-0000-0000-0000-000000000003'$sql$,
  '42501'
);
SELECT pg_temp.assert_sqlstate(
  $sql$UPDATE public.projects SET deleting_at = now()
       WHERE id = '20000000-0000-0000-0000-000000000004'$sql$,
  '42501'
);
SELECT pg_temp.assert_sqlstate(
  $sql$DELETE FROM public.transcripts
       WHERE id = '30000000-0000-0000-0000-000000000003'$sql$,
  'PJ002'
);
SELECT pg_temp.assert_sqlstate(
  $sql$DELETE FROM public.projects
       WHERE id = '20000000-0000-0000-0000-000000000003'$sql$,
  'PJ002'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_sqlstate(
  $sql$UPDATE public.transcripts SET waveform_object_key = 'a/late-waveform.json'
       WHERE id = '30000000-0000-0000-0000-000000000002'$sql$,
  'PJ002'
);
SELECT pg_temp.assert_sqlstate(
  $sql$DELETE FROM public.transcripts
       WHERE id = '30000000-0000-0000-0000-000000000002'$sql$,
  'PJ002'
);
SELECT pg_temp.assert_sqlstate(
  $sql$DELETE FROM public.projects
       WHERE id = '20000000-0000-0000-0000-000000000003'$sql$,
  'PJ002'
);

RESET ROLE;
UPDATE public.projects SET deleting_at = null
WHERE id = '20000000-0000-0000-0000-000000000003';
UPDATE public.projects SET deleting_at = now()
WHERE id = '20000000-0000-0000-0000-000000000003';

SET LOCAL request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.projects WHERE id = '20000000-0000-0000-0000-000000000001'),
  'user B must not see user A projects'
);
WITH changed AS (
  UPDATE public.projects SET name = 'Not allowed'
  WHERE id = '20000000-0000-0000-0000-000000000004'
  RETURNING 1
)
SELECT pg_temp.assert_true((SELECT count(*) FROM changed) = 0, 'user B must not rename user A projects');
WITH removed AS (
  DELETE FROM public.projects
  WHERE id = '20000000-0000-0000-0000-000000000005'
  RETURNING 1
)
SELECT pg_temp.assert_true((SELECT count(*) FROM removed) = 0, 'user B must not delete user A projects');
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT * FROM public.begin_project_delete('20000000-0000-0000-0000-000000000001')$sql$,
  'PJ001'
);
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT * FROM public.finish_project_delete(
       '20000000-0000-0000-0000-000000000001', '{}'::uuid[], '{}'::text[], '{}'::text[])$sql$,
  'PJ001'
);

SET LOCAL request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT pg_temp.assert_sqlstate(
  $sql$SELECT * FROM public.finish_project_delete(
       '20000000-0000-0000-0000-000000000004', '{}'::uuid[], '{}'::text[], '{}'::text[])$sql$,
  'PJ003'
);

DO $$
DECLARE inventory record;
DECLARE result record;
BEGIN
  SELECT * INTO inventory
  FROM public.begin_project_delete('20000000-0000-0000-0000-000000000001');

  BEGIN
    PERFORM * FROM public.finish_project_delete(
      '20000000-0000-0000-0000-000000000001',
      inventory.transcript_ids[1:2], inventory.media_keys, inventory.waveform_keys
    );
    RAISE EXCEPTION 'stale transcript inventory unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'PJ004' THEN
    NULL;
  END;

  BEGIN
    PERFORM * FROM public.finish_project_delete(
      '20000000-0000-0000-0000-000000000001',
      inventory.transcript_ids, inventory.media_keys[1:2], inventory.waveform_keys
    );
    RAISE EXCEPTION 'stale key inventory unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'PJ004' THEN
    NULL;
  END;

  SELECT * INTO result FROM public.finish_project_delete(
    '20000000-0000-0000-0000-000000000001',
    inventory.transcript_ids, inventory.media_keys, inventory.waveform_keys
  );
  PERFORM pg_temp.assert_true(result.deleted_projects = 3, 'finish project count');
  PERFORM pg_temp.assert_true(result.deleted_transcripts = 3, 'finish transcript count');
END;
$$;

INSERT INTO public.projects (id, user_id, name)
VALUES ('20000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000001', 'Bulk');
INSERT INTO public.transcripts (user_id, project_id, title, status)
SELECT '10000000-0000-0000-0000-000000000001',
       '20000000-0000-0000-0000-000000000030',
       'Bulk ' || n, 'created'
FROM generate_series(1, 1001) AS n;
SELECT pg_temp.assert_true(
  (SELECT cardinality(transcript_ids) = 1001
   FROM public.begin_project_delete('20000000-0000-0000-0000-000000000030')),
  'branch inventory must not be capped at 1000 rows'
);

RESET ROLE;
INSERT INTO public.projects (id, user_id, name)
VALUES ('20000000-0000-0000-0000-000000000040', '10000000-0000-0000-0000-000000000001', 'Broadcast');
INSERT INTO public.transcripts (id, user_id, title, status)
VALUES ('30000000-0000-0000-0000-000000000040', '10000000-0000-0000-0000-000000000001', 'Broadcast', 'created');

CREATE TEMP TABLE broadcast_counts (table_name text PRIMARY KEY, message_count bigint) ON COMMIT DROP;
INSERT INTO broadcast_counts (table_name, message_count)
SELECT 'transcripts', count(*) FROM realtime.messages
WHERE topic = 'projects-v1:10000000-0000-0000-0000-000000000001'
  AND event = 'DELETE' AND payload ->> 'table' = 'transcripts';
INSERT INTO broadcast_counts (table_name, message_count)
SELECT 'projects', count(*) FROM realtime.messages
WHERE topic = 'projects-v1:10000000-0000-0000-0000-000000000001'
  AND event = 'DELETE' AND payload ->> 'table' = 'projects';

DELETE FROM public.transcripts WHERE id = '30000000-0000-0000-0000-000000000040';
DELETE FROM public.projects WHERE id = '20000000-0000-0000-0000-000000000040';

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM realtime.messages
   WHERE topic = 'projects-v1:10000000-0000-0000-0000-000000000001'
     AND event = 'DELETE' AND private
     AND payload ->> 'table' = 'transcripts')
  = (SELECT message_count + 1 FROM broadcast_counts WHERE table_name = 'transcripts'),
  'one private transcript invalidation per delete statement'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM realtime.messages
   WHERE topic = 'projects-v1:10000000-0000-0000-0000-000000000001'
     AND event = 'DELETE' AND private
     AND payload ->> 'table' = 'projects')
  = (SELECT message_count + 1 FROM broadcast_counts WHERE table_name = 'projects'),
  'one private project invalidation per delete statement'
);

SET LOCAL request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT set_config('realtime.topic', 'projects-v1:10000000-0000-0000-0000-000000000001', true);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM realtime.messages
    WHERE event = 'DELETE' AND payload ->> 'table' = 'projects'
  ),
  'owner can receive own delete invalidations'
);
SELECT set_config('realtime.topic', 'projects-v1:10000000-0000-0000-0000-000000000002', true);
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM realtime.messages),
  'a foreign delete-invalidation topic is not authorized'
);

ROLLBACK;
SELECT 'projects smoke test passed' AS result;
