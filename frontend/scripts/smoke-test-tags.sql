-- Local-only behavioural coverage for transcript tags
-- (20261101000000_transcript_tags.sql). Run with psql -v ON_ERROR_STOP=1;
-- all fixtures are rolled back. Concurrency is covered separately by
-- scripts/concurrency-test-tags.sh, which needs two connections.
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
     'public.add_transcript_tag(uuid,uuid)', 'public.remove_transcript_tag(uuid,uuid)',
     'public.create_transcript_tag(uuid,uuid,text,text)', 'public.undo_created_tag(uuid,uuid)',
     'public.rename_tag(uuid,text,text)', 'public.set_tag_color(uuid,text,text)',
     'public.delete_tag(uuid)', 'public.merge_tags(uuid,uuid)'
   ]) AS f)
  AND (SELECT bool_and(has_table_privilege('authenticated', t, 'SELECT')
      AND NOT has_table_privilege('authenticated', t, 'INSERT')
      AND NOT has_table_privilege('authenticated', t, 'UPDATE')
      AND NOT has_table_privilege('authenticated', t, 'DELETE')
      AND NOT has_table_privilege('anon', t, 'SELECT'))
   FROM unnest(ARRAY['public.tags', 'public.transcript_tags']) AS t),
  'tag functions are for signed-in users only, and the tables stay read-only'
);

-- -------------------------------------------------------------- fixtures ----
-- Account A has three transcripts, account B one.
INSERT INTO public.app_users (id, workos_user_id) VALUES
  ('f0000000-0000-4000-8000-00000000000a', 'user_f000000000004000800000000000000a'),
  ('f0000000-0000-4000-8000-00000000000b', 'user_f000000000004000800000000000000b');
INSERT INTO public.transcripts (id, user_id, title, status) VALUES
  ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-00000000000a', 'One', 'completed'),
  ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-00000000000a', 'Two', 'completed'),
  ('f2000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-00000000000a', 'Three', 'processing'),
  ('f2000000-0000-4000-8000-00000000000b', 'f0000000-0000-4000-8000-00000000000b', 'Theirs', 'completed');

-- Whether a transcript carries a tag, read past RLS.
CREATE FUNCTION pg_temp.linked(p_transcript uuid, p_tag uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.transcript_tags WHERE transcript_id = p_transcript AND tag_id = p_tag)
$$;
CREATE FUNCTION pg_temp.tag_exists(p_tag uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.tags WHERE id = p_tag)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.linked(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.tag_exists(uuid) TO authenticated;

SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------- unauthenticated --
SET LOCAL request.jwt.claims = '{"role":"authenticated"}';
SELECT pg_temp.assert_sqlstate($sql$SELECT public.create_transcript_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Nope', '#4F638C')$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.add_transcript_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001')$sql$, '42501');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.delete_tag('f1000000-0000-4000-8000-000000000001')$sql$, '42501');

SET LOCAL request.jwt.claims = '{"sub":"user_f000000000004000800000000000000a","role":"authenticated"}';

-- ---------------------------------------------------------------- create ----
SELECT pg_temp.assert_true(
  (SELECT r->>'outcome' = 'created' AND r->'tag'->>'name' = 'Interview' AND r->'tag'->>'color' = '#4F638C'
   FROM public.create_transcript_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '  Interview ', '#4F638C') AS r),
  'a new tag is created, trimmed, and its outcome says so'
);
SELECT pg_temp.assert_true(
  (SELECT r->>'outcome' = 'own' AND r->'tag'->>'id' = 'f1000000-0000-4000-8000-000000000001'
   FROM public.create_transcript_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Interview', '#4F638C') AS r)
  AND (SELECT count(*) = 1 FROM public.transcript_tags WHERE transcript_id = 'f2000000-0000-4000-8000-000000000001'),
  'a resend finds its own tag under the id it asked for, and links once'
);
SELECT pg_temp.assert_true(
  (SELECT r->>'outcome' = 'adopted' AND r->'tag'->>'id' = 'f1000000-0000-4000-8000-000000000001'
   FROM public.create_transcript_tag('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'INTERVIEW', '#C73E1D') AS r)
  AND pg_temp.linked('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001')
  AND NOT pg_temp.tag_exists('f1000000-0000-4000-8000-000000000002'),
  'a name already taken (ignoring case) adopts that tag instead of creating one'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.tags),
  'the account reads its own tags through RLS'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.create_transcript_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000009', '   ', '#4F638C')$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.create_transcript_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000009', repeat('x', 51), '#4F638C')$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.create_transcript_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000009', 'Off palette', '#000000')$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.create_transcript_tag('f2000000-0000-4000-8000-000000000001', NULL, 'No id', '#4F638C')$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.create_transcript_tag('f2000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-000000000009', 'Theirs', '#4F638C')$sql$, 'SP001');

-- ------------------------------------------------------------ add/remove ----
SELECT public.add_transcript_tag('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001');
SELECT public.add_transcript_tag('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.transcript_tags WHERE transcript_id = 'f2000000-0000-4000-8000-000000000003'),
  'adding twice links once, and a transcript still processing can be tagged'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.add_transcript_tag('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000009')$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.add_transcript_tag('f2000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-000000000001')$sql$, 'SP001');
SELECT public.remove_transcript_tag('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001');
SELECT public.remove_transcript_tag('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001');
SELECT public.remove_transcript_tag('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000009');
SELECT pg_temp.assert_true(
  NOT pg_temp.linked('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001')
  AND pg_temp.tag_exists('f1000000-0000-4000-8000-000000000001'),
  'removing twice, or removing a missing tag, is done without error and keeps the tag'
);

-- ------------------------------------------------------------------ undo ----
-- Fresh is on nothing else: undo deletes it, and a resend finds it gone.
SELECT public.create_transcript_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', 'Fresh', '#CA8A04');
SELECT pg_temp.assert_true(
  public.undo_created_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003') = 'deleted'
  AND NOT pg_temp.tag_exists('f1000000-0000-4000-8000-000000000003')
  AND public.undo_created_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003') = 'gone',
  'undoing an unused new tag deletes it; a resend answers gone'
);
-- Redo recreates it under the same id, name and colour.
SELECT pg_temp.assert_true(
  (SELECT r->>'outcome' = 'created' AND r->'tag'->>'id' = 'f1000000-0000-4000-8000-000000000003'
     AND r->'tag'->>'name' = 'Fresh' AND r->'tag'->>'color' = '#CA8A04'
   FROM public.create_transcript_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', 'Fresh', '#CA8A04') AS r),
  'redo of a deleted tag recreates it as it was'
);
-- Renamed after creating it, still on nothing else: undo still deletes it.
SELECT public.rename_tag('f1000000-0000-4000-8000-000000000003', 'Fresh', 'Fresher');
SELECT pg_temp.assert_true(
  public.undo_created_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003') = 'deleted',
  'a rename does not stop undo deleting an unused new tag'
);
-- Shared is on another transcript by the time of undo: kept, off this one only.
SELECT public.create_transcript_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000004', 'Shared', '#0D9488');
SELECT public.add_transcript_tag('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000004');
SELECT pg_temp.assert_true(
  public.undo_created_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000004') = 'kept'
  AND pg_temp.tag_exists('f1000000-0000-4000-8000-000000000004')
  AND NOT pg_temp.linked('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000004')
  AND pg_temp.linked('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000004')
  AND public.undo_created_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000004') = 'kept',
  'a new tag another transcript uses is kept and only comes off this one, also on a resend'
);
-- Redo of a kept tag finds it under its own id.
SELECT pg_temp.assert_true(
  (SELECT r->>'outcome' = 'own'
   FROM public.create_transcript_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000004', 'Shared', '#0D9488') AS r)
  AND pg_temp.linked('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000004'),
  'redo of a kept tag puts it back on this transcript'
);
-- Redo after the tag was deleted while a namesake appeared: adopts the namesake.
SELECT public.create_transcript_tag('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000005', 'Fresh', '#7C3AED');
SELECT pg_temp.assert_true(
  (SELECT r->>'outcome' = 'adopted' AND r->'tag'->>'id' = 'f1000000-0000-4000-8000-000000000005'
   FROM public.create_transcript_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', 'Fresh', '#CA8A04') AS r)
  AND NOT pg_temp.tag_exists('f1000000-0000-4000-8000-000000000003'),
  'redo whose name is taken by now uses the existing tag'
);

-- ------------------------------------------------------- rename / colour ----
SELECT pg_temp.assert_true(
  (SELECT name = 'Interviews' FROM public.rename_tag('f1000000-0000-4000-8000-000000000001', 'Interview', ' Interviews '))
  AND (SELECT name = 'Interviews' FROM public.rename_tag('f1000000-0000-4000-8000-000000000001', 'Interview', 'Interviews')),
  'a rename succeeds, and its resend recognises the name it asked for'
);
SELECT pg_temp.assert_true(
  (SELECT name = 'interviews' FROM public.rename_tag('f1000000-0000-4000-8000-000000000001', 'Interviews', 'interviews')),
  'a tag can change only the case of its own name'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.rename_tag('f1000000-0000-4000-8000-000000000001', 'Interview', 'Calls')$sql$, 'SP002');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.rename_tag('f1000000-0000-4000-8000-000000000001', 'interviews', 'SHARED')$sql$, '23505');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.rename_tag('f1000000-0000-4000-8000-000000000001', 'interviews', '')$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.rename_tag('f1000000-0000-4000-8000-000000000009', 'x', 'y')$sql$, 'SP001');
SELECT pg_temp.assert_true(
  (SELECT color = '#0D9488' FROM public.set_tag_color('f1000000-0000-4000-8000-000000000001', '#4F638C', '#0D9488'))
  AND (SELECT color = '#0D9488' FROM public.set_tag_color('f1000000-0000-4000-8000-000000000001', '#4F638C', '#0D9488')),
  'a recolour succeeds, and its resend recognises the colour it asked for'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_tag_color('f1000000-0000-4000-8000-000000000001', '#4F638C', '#C73E1D')$sql$, 'SP002');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_tag_color('f1000000-0000-4000-8000-000000000001', '#0D9488', '#000000')$sql$, 'SP003');

-- ----------------------------------------------------------------- merge ----
-- Shared (on One and Two) folds into interviews (on One and Two): no duplicates.
SELECT pg_temp.assert_true(
  (SELECT r->>'merged' = 'true' AND r->'tag'->>'id' = 'f1000000-0000-4000-8000-000000000001'
   FROM public.merge_tags('f1000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001') AS r)
  AND NOT pg_temp.tag_exists('f1000000-0000-4000-8000-000000000004')
  AND (SELECT count(*) = 2 FROM public.transcript_tags WHERE tag_id = 'f1000000-0000-4000-8000-000000000001'),
  'merging moves every link onto the surviving tag and deletes the other'
);
SELECT public.add_transcript_tag('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000005');
SELECT pg_temp.assert_true(
  (SELECT r->>'merged' = 'true' FROM public.merge_tags('f1000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001') AS r)
  AND pg_temp.linked('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001')
  AND (SELECT r->>'merged' = 'false' FROM public.merge_tags('f1000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001') AS r),
  'a merge adds the survivor where it was missing; a resend answers merged false'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.merge_tags('f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001')$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.merge_tags('f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000009')$sql$, 'SP001');

-- ---------------------------------------------------------------- delete ----
SELECT public.create_transcript_tag('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000006', 'Doomed', '#B45309');
SELECT pg_temp.assert_true(
  public.delete_tag('f1000000-0000-4000-8000-000000000006')
  AND NOT pg_temp.tag_exists('f1000000-0000-4000-8000-000000000006')
  AND NOT pg_temp.linked('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000006')
  AND public.delete_tag('f1000000-0000-4000-8000-000000000006') = false,
  'deleting a tag takes it off every transcript; a resend answers false'
);

-- ------------------------------------------------------------- account B ----
SET LOCAL request.jwt.claims = '{"sub":"user_f000000000004000800000000000000b","role":"authenticated"}';
SELECT public.create_transcript_tag('f2000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', 'interviews', '#4F638C');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.tags) AND (SELECT count(*) = 1 FROM public.transcript_tags),
  'another account reads only its own tags, and can reuse a name another account has'
);
SELECT pg_temp.assert_sqlstate($sql$SELECT public.create_transcript_tag('f2000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-000000000001', 'Steal', '#4F638C')$sql$, 'SP003');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.add_transcript_tag('f2000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-000000000001')$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.add_transcript_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-00000000000b')$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.rename_tag('f1000000-0000-4000-8000-000000000001', 'interviews', 'Mine')$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.set_tag_color('f1000000-0000-4000-8000-000000000001', '#0D9488', '#4F638C')$sql$, 'SP001');
SELECT pg_temp.assert_sqlstate($sql$SELECT public.merge_tags('f1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-000000000001')$sql$, 'SP001');
SELECT public.remove_transcript_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001');
SELECT pg_temp.assert_true(
  public.undo_created_tag('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001') = 'gone'
  AND public.delete_tag('f1000000-0000-4000-8000-000000000001') = false
  AND (SELECT r->>'merged' = 'false' FROM public.merge_tags('f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-00000000000b') AS r),
  'another account''s tag looks missing to every write'
);

RESET ROLE;
SELECT pg_temp.assert_true(
  pg_temp.tag_exists('f1000000-0000-4000-8000-000000000001')
  AND pg_temp.linked('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001')
  AND (SELECT name = 'interviews' AND color = '#0D9488' FROM public.tags WHERE id = 'f1000000-0000-4000-8000-000000000001'),
  'nothing the other account tried changed account A'
);

-- --------------------------------------------------------------- cascade ----
DELETE FROM public.transcripts WHERE id = 'f2000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.transcript_tags WHERE transcript_id = 'f2000000-0000-4000-8000-000000000003')
  AND pg_temp.tag_exists('f1000000-0000-4000-8000-000000000001'),
  'deleting a transcript removes its links and keeps the tags'
);
SELECT pg_temp.assert_sqlstate($sql$UPDATE public.tags SET name = 'x' || repeat('y', 60) WHERE id = 'f1000000-0000-4000-8000-000000000001'$sql$, '23514');
SELECT pg_temp.assert_sqlstate($sql$INSERT INTO public.tags (user_id, name, color) VALUES ('f0000000-0000-4000-8000-00000000000a', NULL, '#4F638C')$sql$, '23502');
SELECT pg_temp.assert_sqlstate($sql$INSERT INTO public.tags (user_id, name, color) VALUES ('f0000000-0000-4000-8000-00000000000a', 'No colour', NULL)$sql$, '23502');
SELECT pg_temp.assert_sqlstate($sql$INSERT INTO public.transcript_tags (transcript_id, tag_id, user_id) VALUES ('f2000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-00000000000a')$sql$, '23503');

ROLLBACK;
SELECT 'tags smoke test passed' AS result;
