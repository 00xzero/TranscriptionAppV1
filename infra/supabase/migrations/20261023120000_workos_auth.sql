-- WorkOS sign-in.
--
-- People now sign in with WorkOS AuthKit; Supabase accepts its access tokens
-- as a third-party auth provider. A WorkOS user id (`user_01…`) is not a
-- UUID, so our own UUIDs stay the owner of every row, file and event, and
-- app_users maps one WorkOS identity to one of them.
--
-- 1. app_users, filled from auth.users so every existing owner keeps its id.
--    Existing rows start unlinked (workos_user_id NULL) and give no access
--    until linked by their id.
-- 2. current_user_id(): the signed-in person's UUID, or NULL. It replaces
--    auth.uid() everywhere.
-- 3. Owner foreign keys point at app_users instead of auth.users.
-- 4. Every function and every policy (public, storage, realtime) that used
--    auth.uid() is recreated with current_user_id(). Generated from the live
--    catalogue, so it carries each object's current definition unchanged
--    apart from that call.
-- 5. A final check fails the migration if anything still uses auth.uid().

-- ---------------------------------------------------------------------------
-- 1. app_users. Read-only for the person it names; only the service role
--    (the sign-in callback) creates or links rows.
-- ---------------------------------------------------------------------------

CREATE TABLE public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_user_id text UNIQUE
    CONSTRAINT app_users_workos_user_id_shape CHECK (workos_user_id ~ '^user_[A-Za-z0-9_]+$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_users (id, created_at)
SELECT id, created_at FROM auth.users;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.app_users FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.app_users TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.app_users TO service_role;

-- ---------------------------------------------------------------------------
-- 2. current_user_id(). A token whose subject is not a linked WorkOS user (a
--    Supabase-issued token, or a WorkOS user not yet provisioned) gets NULL,
--    which every policy and function treats as signed out. Callers wrap it
--    in a SELECT so it is looked up once per statement, not once per row.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM public.app_users WHERE workos_user_id = (SELECT auth.jwt() ->> 'sub')
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_id() TO authenticated, service_role;

CREATE POLICY "Users can read own app user" ON public.app_users
  FOR SELECT
  TO authenticated
  USING (id = (SELECT public.current_user_id()));

-- ---------------------------------------------------------------------------
-- 3. Owner foreign keys.
-- ---------------------------------------------------------------------------

ALTER TABLE public.transcripts
  DROP CONSTRAINT transcripts_user_id_fkey,
  ADD CONSTRAINT transcripts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

ALTER TABLE public.projects
  DROP CONSTRAINT projects_user_id_fkey,
  ADD CONSTRAINT projects_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

ALTER TABLE public.organisations
  DROP CONSTRAINT organisations_user_id_fkey,
  ADD CONSTRAINT organisations_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

ALTER TABLE public.people
  DROP CONSTRAINT people_user_id_fkey,
  ADD CONSTRAINT people_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 4a. Functions. CREATE OR REPLACE keeps each function's owner and grants.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_segment_speaker_changes(p_transcript_id uuid, p_changes jsonb)
 RETURNS TABLE(segment_id uuid, speaker_id uuid)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_change_count integer;
  v_distinct_count integer;
  v_locked_count integer;
BEGIN
  PERFORM public.require_completed_transcript(p_transcript_id, (SELECT public.current_user_id()));

  IF p_changes IS NULL
     OR jsonb_typeof(p_changes) <> 'array'
     OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'changes must be a non-empty array' USING ERRCODE = 'SP003';
  END IF;

  -- Every key must be present, even when null: a missing expectation must not
  -- silently read as "expected unassigned". A revision is never null.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_changes) AS e
    WHERE jsonb_typeof(e) <> 'object'
       OR NOT (e ? 'segment_id' AND e ? 'expected_speaker_id' AND e ? 'expected_revision'
               AND e ? 'speaker_id')
       OR jsonb_typeof(e -> 'segment_id') <> 'string'
       OR jsonb_typeof(e -> 'expected_revision') <> 'number'
  ) THEN
    RAISE EXCEPTION 'each change needs segment_id, expected_speaker_id, expected_revision and speaker_id'
      USING ERRCODE = 'SP003';
  END IF;

  BEGIN
    SELECT count(*), count(DISTINCT c.segment_id)
    INTO v_change_count, v_distinct_count
    FROM jsonb_to_recordset(p_changes)
      AS c(segment_id uuid, expected_speaker_id uuid, expected_revision integer, speaker_id uuid);
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'changes contain an invalid id or revision' USING ERRCODE = 'SP003';
  END;

  IF v_distinct_count <> v_change_count THEN
    RAISE EXCEPTION 'a segment appears more than once' USING ERRCODE = 'SP003';
  END IF;

  -- Lock in id order so concurrent calls cannot deadlock.
  SELECT count(*) INTO v_locked_count
  FROM (
    SELECT sg.id
    FROM public.segments AS sg
    WHERE sg.transcript_id = p_transcript_id
      AND sg.id IN (
        SELECT c.segment_id FROM jsonb_to_recordset(p_changes) AS c(segment_id uuid)
      )
    ORDER BY sg.id
    FOR UPDATE
  ) AS locked;

  IF v_locked_count <> v_change_count THEN
    RAISE EXCEPTION 'segment not found' USING ERRCODE = 'SP001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_changes) AS c(speaker_id uuid)
    WHERE c.speaker_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.speakers AS sp
        WHERE sp.id = c.speaker_id AND sp.transcript_id = p_transcript_id
      )
  ) THEN
    RAISE EXCEPTION 'speaker not found' USING ERRCODE = 'SP001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_changes) AS c(segment_id uuid, expected_speaker_id uuid, speaker_id uuid)
    JOIN public.segments AS sg ON sg.id = c.segment_id
    WHERE sg.speaker_id IS DISTINCT FROM c.expected_speaker_id
      AND sg.speaker_id IS DISTINCT FROM c.speaker_id
  ) THEN
    RAISE EXCEPTION 'segment speaker changed since it was read' USING ERRCODE = 'SP002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_changes) AS c(segment_id uuid, expected_revision integer)
    JOIN public.segments AS sg ON sg.id = c.segment_id
    WHERE sg.revision <> c.expected_revision
  ) THEN
    RAISE EXCEPTION 'segment was split or rejoined since it was read' USING ERRCODE = 'SP002';
  END IF;

  RETURN QUERY
  UPDATE public.segments AS sg
  SET speaker_id = c.speaker_id
  FROM jsonb_to_recordset(p_changes) AS c(segment_id uuid, speaker_id uuid)
  WHERE sg.id = c.segment_id
    AND sg.transcript_id = p_transcript_id
  RETURNING sg.id, sg.speaker_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.begin_project_delete(p_id uuid)
 RETURNS TABLE(project_ids uuid[], transcript_ids uuid[], media_keys text[], waveform_keys text[], result_keys text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_ids uuid[];
  v_next uuid[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  v_ids := public.project_branch_ids(v_user, p_id);
  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'PJ001';
  END IF;

  LOOP
    UPDATE public.projects
    SET deleting_at = now()
    WHERE id = ANY(v_ids) AND user_id = v_user AND deleting_at IS NULL;

    v_next := public.project_branch_ids(v_user, p_id);
    EXIT WHEN v_next <@ v_ids;
    v_ids := v_next;
  END LOOP;

  RETURN QUERY
  SELECT v_ids, i.transcript_ids, i.media_keys, i.waveform_keys, i.result_keys
  FROM public.project_branch_inventory(v_user, v_ids) AS i;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.correct_segments_to_person(p_transcript_id uuid, p_changes jsonb, p_person_id uuid DEFAULT NULL::uuid, p_new_person_name text DEFAULT NULL::text, p_new_person_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_person_id uuid := p_person_id;
  v_person public.people;
  v_speaker public.speakers;
  v_assignments jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF (p_person_id IS NULL) = (p_new_person_name IS NULL)
     OR (p_new_person_name IS NOT NULL AND p_new_person_id IS NULL) THEN
    RAISE EXCEPTION 'choose an existing person, or a new person with its id' USING ERRCODE = 'SP003';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'changes must be a non-empty array' USING ERRCODE = 'SP003';
  END IF;
  PERFORM public.require_completed_transcript(p_transcript_id, v_user);
  IF p_person_id IS NULL THEN
    SELECT * INTO v_person FROM public.people WHERE id = p_new_person_id FOR UPDATE;
    IF NOT FOUND THEN
      v_person_id := public.editor_create_person(v_user, p_new_person_name, p_new_person_id);
    ELSIF v_person.user_id <> v_user THEN
      RAISE EXCEPTION 'person id is already in use' USING ERRCODE = 'SP003';
    ELSIF v_person.updated_at <> v_person.created_at
       OR v_person.name IS DISTINCT FROM regexp_replace(p_new_person_name, '^\s+|\s+$', '', 'g') THEN
      RAISE EXCEPTION 'person changed since it was created' USING ERRCODE = 'SP002';
    ELSE
      v_person_id := p_new_person_id;
      IF NOT EXISTS (
        SELECT 1 FROM public.speakers AS sp
        WHERE sp.transcript_id = p_transcript_id AND sp.person_id = v_person_id
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_to_recordset(p_changes) AS c(segment_id uuid)
            LEFT JOIN public.segments AS sg ON sg.id = c.segment_id
            WHERE sg.speaker_id IS DISTINCT FROM sp.id
          )
      ) THEN
        RAISE EXCEPTION 'person changed since it was created' USING ERRCODE = 'SP002';
      END IF;
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.people WHERE id = p_person_id AND user_id = v_user) THEN
    RAISE EXCEPTION 'person not found' USING ERRCODE = 'SP001';
  END IF;

  SELECT sp.* INTO v_speaker FROM public.speakers AS sp
  WHERE sp.transcript_id = p_transcript_id AND sp.person_id = v_person_id
  ORDER BY (SELECT count(*) FROM public.segments AS sg WHERE sg.speaker_id = sp.id) DESC,
    sp.created_at, sp.id LIMIT 1;
  IF NOT FOUND THEN
    v_speaker := public.create_transcript_speaker(p_transcript_id, v_user, NULL);
    UPDATE public.speakers SET person_id = v_person_id WHERE id = v_speaker.id
      RETURNING * INTO v_speaker;
  END IF;

  -- Non-object elements pass through so the helper reports them as SP003.
  SELECT jsonb_agg(to_jsonb(a)) INTO v_assignments
  FROM public.apply_segment_speaker_changes(p_transcript_id, (
    SELECT jsonb_agg(CASE WHEN jsonb_typeof(e) = 'object'
      THEN e || jsonb_build_object('speaker_id', v_speaker.id) ELSE e END)
    FROM jsonb_array_elements(p_changes) AS e
  )) AS a;
  RETURN jsonb_build_object('speaker', to_jsonb(v_speaker),
    'person', (SELECT to_jsonb(p) FROM public.people AS p WHERE p.id = v_person_id),
    'assignments', v_assignments);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_local_speaker(p_transcript_id uuid, p_custom_label text, p_changes jsonb, p_speaker_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_label text := regexp_replace(p_custom_label, '^\s+|\s+$', '', 'g');
  v_speaker public.speakers;
  v_assignments jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF p_speaker_id IS NULL THEN RAISE EXCEPTION 'speaker id is required' USING ERRCODE = 'SP003'; END IF;
  IF v_label IS NULL OR char_length(v_label) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'speaker names must be 1 to 50 characters' USING ERRCODE = 'SP003';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'changes must be a non-empty array' USING ERRCODE = 'SP003';
  END IF;
  PERFORM public.require_completed_transcript(p_transcript_id, v_user);

  SELECT * INTO v_speaker FROM public.speakers WHERE id = p_speaker_id FOR UPDATE;
  IF FOUND THEN
    IF v_speaker.transcript_id <> p_transcript_id OR v_speaker.user_id <> v_user THEN
      RAISE EXCEPTION 'speaker id is already in use' USING ERRCODE = 'SP003';
    END IF;
    IF v_speaker.custom_label IS DISTINCT FROM v_label OR v_speaker.person_id IS NOT NULL
       OR v_speaker.diarization_index IS NOT NULL THEN
      RAISE EXCEPTION 'speaker changed since it was created' USING ERRCODE = 'SP002';
    END IF;
  ELSE
    v_speaker := public.create_transcript_speaker(p_transcript_id, v_user, v_label, p_speaker_id);
  END IF;

  -- Non-object elements pass through so the helper reports them as SP003.
  SELECT jsonb_agg(to_jsonb(a)) INTO v_assignments
  FROM public.apply_segment_speaker_changes(p_transcript_id, (
    SELECT jsonb_agg(CASE WHEN jsonb_typeof(e) = 'object'
      THEN e || jsonb_build_object('speaker_id', v_speaker.id) ELSE e END)
    FROM jsonb_array_elements(p_changes) AS e
  )) AS a;
  RETURN jsonb_build_object('speaker', to_jsonb(v_speaker), 'assignments', v_assignments);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_person(p_name text)
 RETURNS people
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_person_id uuid;
  v_person public.people;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  v_person_id := public.editor_create_person(v_user, p_name);
  SELECT * INTO v_person FROM public.people WHERE id = v_person_id;
  RETURN v_person;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_organisation(p_organisation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.organisations WHERE id = p_organisation_id AND user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'organisation not found' USING ERRCODE = 'SP001'; END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_person(p_person_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.people WHERE id = p_person_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'person not found' USING ERRCODE = 'SP001'; END IF;
  IF EXISTS (SELECT 1 FROM public.person_appearances WHERE person_id = p_person_id) THEN
    RAISE EXCEPTION 'person still appears in a transcript' USING ERRCODE = 'SP002';
  END IF;
  DELETE FROM public.people WHERE id = p_person_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_transcript(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_project_id uuid;
  v_deleting_at timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT t.project_id INTO v_project_id
  FROM public.transcripts AS t
  WHERE t.id = p_id AND t.user_id = v_user
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transcript not found' USING ERRCODE = 'TR001';
  END IF;

  -- transcripts_project_guard lets the function owner delete inside a branch
  -- marked for deletion (finish_project_delete relies on that), so repeat its
  -- check here.
  IF v_project_id IS NOT NULL THEN
    SELECT p.deleting_at INTO v_deleting_at
    FROM public.projects AS p
    WHERE p.id = v_project_id AND p.user_id = v_user
    FOR SHARE;
    IF v_deleting_at IS NOT NULL THEN
      RAISE EXCEPTION 'project is being deleted' USING ERRCODE = 'PJ002';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.transcript_folder_objects(v_user, ARRAY[p_id])) THEN
    RAISE EXCEPTION 'transcript files still exist' USING ERRCODE = 'TR002';
  END IF;

  DELETE FROM public.transcripts WHERE id = p_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.editor_people_context(p_transcript_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_project uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  SELECT project_id INTO v_project FROM public.transcripts
  WHERE id = p_transcript_id AND user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'transcript not found' USING ERRCODE = 'SP001'; END IF;

  RETURN jsonb_build_object(
    'people', COALESCE((
      SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.name, entry.id)
      FROM (
        SELECT p.*, o.name AS organisation_name,
          COALESCE(elsewhere.transcript_count, 0) AS other_transcript_count,
          elsewhere.last_title AS last_other_title,
          elsewhere.last_seen_at AS last_other_seen_at,
          COALESCE(elsewhere.in_project, false) AS in_project
        FROM public.people AS p
        LEFT JOIN public.organisations AS o ON o.id = p.organisation_id
        LEFT JOIN LATERAL (
          SELECT count(*)::integer AS transcript_count,
            (array_agg(t.title ORDER BY t.created_at DESC, t.id))[1] AS last_title,
            max(t.created_at) AS last_seen_at,
            bool_or(t.project_id = v_project) AS in_project
          FROM public.person_appearances AS a
          JOIN public.transcripts AS t ON t.id = a.transcript_id
          WHERE a.person_id = p.id AND a.transcript_id <> p_transcript_id
        ) AS elsewhere ON true
        WHERE p.user_id = v_user
      ) AS entry
    ), '[]'::jsonb)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.finish_project_delete(p_id uuid, p_transcript_ids uuid[])
 RETURNS TABLE(deleted_projects integer, deleted_transcripts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_ids uuid[];
  v_transcript_ids uuid[];
  v_deleted_projects integer;
  v_deleted_transcripts integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  v_ids := public.project_branch_ids(v_user, p_id);
  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'PJ001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.projects
    WHERE user_id = v_user AND id = ANY(v_ids) AND deleting_at IS NULL
  ) THEN
    RAISE EXCEPTION 'project branch is not marked for deletion' USING ERRCODE = 'PJ003';
  END IF;

  -- Lock the branch's transcripts before checking what they own, so no link
  -- or move can land between the checks below and the delete.
  PERFORM 1
  FROM public.transcripts
  WHERE user_id = v_user AND project_id = ANY(v_ids)
  ORDER BY id
  FOR UPDATE;

  SELECT public.sorted_distinct(array_agg(t.id)) INTO v_transcript_ids
  FROM public.transcripts AS t
  WHERE t.user_id = v_user AND t.project_id = ANY(v_ids);

  -- Unreachable while the guards and locks hold; kept so a regression fails loudly.
  IF public.sorted_distinct(p_transcript_ids) IS DISTINCT FROM v_transcript_ids THEN
    RAISE EXCEPTION 'project branch changed after deletion began' USING ERRCODE = 'PJ004';
  END IF;

  IF EXISTS (SELECT 1 FROM public.transcript_folder_objects(v_user, v_transcript_ids)) THEN
    RAISE EXCEPTION 'project files still exist' USING ERRCODE = 'PJ005';
  END IF;

  DELETE FROM public.transcripts
  WHERE user_id = v_user AND id = ANY(v_transcript_ids);
  GET DIAGNOSTICS v_deleted_transcripts = ROW_COUNT;

  DELETE FROM public.projects
  WHERE user_id = v_user AND id = ANY(v_ids);
  GET DIAGNOSTICS v_deleted_projects = ROW_COUNT;

  RETURN QUERY SELECT v_deleted_projects, v_deleted_transcripts;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.list_person_appearances(p_person_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
        'transcript_id', t.id, 'title', t.title, 'project_id', t.project_id,
        'created_at', t.created_at, 'talk_ms', talk.person_ms, 'transcript_talk_ms', talk.total_ms)
      ORDER BY t.created_at DESC, t.id)
    FROM public.person_appearances AS a
    JOIN public.transcripts AS t ON t.id = a.transcript_id
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(sum(greatest(sg.end_ms - sg.start_ms, 0)) FILTER (WHERE sp.person_id = p_person_id), 0)::bigint
          AS person_ms,
        COALESCE(sum(greatest(sg.end_ms - sg.start_ms, 0)), 0)::bigint AS total_ms
      FROM public.segments AS sg
      LEFT JOIN public.speakers AS sp ON sp.transcript_id = sg.transcript_id AND sp.id = sg.speaker_id
      WHERE sg.transcript_id = t.id
    ) AS talk
    WHERE a.person_id = p_person_id AND a.user_id = v_user
  ), '[]'::jsonb);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.merge_people(p_survivor_id uuid, p_person_ids uuid[], p_expected_preview jsonb)
 RETURNS people
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_survivor public.people;
  v_organisation_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;

  IF p_expected_preview IS NULL THEN
    RAISE EXCEPTION 'a merge preview is required' USING ERRCODE = 'SP003';
  END IF;
  PERFORM public.lock_speaker_identity_writes(v_user);

  -- Freeze titles and organisation names as well as identity links. Organisation
  -- locks precede people locks, as deleting an organisation updates its people.
  PERFORM 1 FROM public.transcripts AS t
  WHERE t.user_id = v_user AND EXISTS (SELECT 1 FROM public.speakers AS sp
    WHERE sp.transcript_id = t.id AND (sp.person_id = p_survivor_id OR sp.person_id = ANY (p_person_ids)))
  ORDER BY t.id FOR NO KEY UPDATE;
  PERFORM 1 FROM public.organisations AS o
  WHERE o.user_id = v_user AND EXISTS (SELECT 1 FROM public.people AS p
    WHERE p.organisation_id = o.id AND (p.id = p_survivor_id OR p.id = ANY (p_person_ids)))
  ORDER BY o.id FOR SHARE;

  -- Lock in id order so concurrent merges cannot deadlock, then check.
  PERFORM 1 FROM public.people
  WHERE user_id = v_user AND (id = p_survivor_id OR id = ANY (p_person_ids))
  ORDER BY id FOR UPDATE;
  PERFORM public.check_merge_request(v_user, p_survivor_id, p_person_ids);
  IF public.merge_people_preview(p_survivor_id, p_person_ids) IS DISTINCT FROM p_expected_preview THEN
    RAISE EXCEPTION 'merge preview changed since it was read' USING ERRCODE = 'SP002';
  END IF;

  SELECT * INTO v_survivor FROM public.people WHERE id = p_survivor_id;
  v_organisation_id := v_survivor.organisation_id;
  IF v_organisation_id IS NULL THEN
    -- The first person given who has one, not the lowest id.
    SELECT p.organisation_id INTO v_organisation_id
    FROM unnest(p_person_ids) WITH ORDINALITY AS m(id, ord)
    JOIN public.people AS p ON p.id = m.id
    WHERE p.organisation_id IS NOT NULL
    ORDER BY m.ord
    LIMIT 1;
  END IF;

  UPDATE public.speakers SET person_id = p_survivor_id WHERE person_id = ANY (p_person_ids);
  DELETE FROM public.people WHERE id = ANY (p_person_ids);
  UPDATE public.people SET organisation_id = v_organisation_id
  WHERE id = p_survivor_id RETURNING * INTO v_survivor;
  RETURN v_survivor;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.merge_people_preview(p_survivor_id uuid, p_person_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_result jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM public.check_merge_request(v_user, p_survivor_id, p_person_ids);

  WITH voices AS (
    SELECT sp.person_id, sp.transcript_id, sp.id AS speaker_id, sp.custom_label,
      sum(greatest(sg.end_ms - sg.start_ms, 0))::bigint AS talk_ms,
      min(sg.start_ms) AS first_start_ms,
      array_agg(DISTINCT home.ordinal ORDER BY home.ordinal) AS detected_ordinals
    FROM public.speakers AS sp
    JOIN public.segments AS sg ON sg.transcript_id = sp.transcript_id AND sg.speaker_id = sp.id
    LEFT JOIN public.speakers AS home
      ON home.transcript_id = sg.transcript_id AND home.diarization_index = sg.diarization_index
    WHERE sp.user_id = v_user AND sp.person_id = ANY (p_person_ids)
    GROUP BY sp.person_id, sp.transcript_id, sp.id, sp.custom_label
  ),
  by_transcript AS (
    SELECT v.person_id, v.transcript_id,
      jsonb_agg(jsonb_build_object(
          'speaker_id', v.speaker_id, 'custom_label', v.custom_label,
          'talk_ms', v.talk_ms, 'detected_ordinals', to_jsonb(v.detected_ordinals))
        ORDER BY v.first_start_ms, v.speaker_id) AS voices
    FROM voices AS v
    GROUP BY v.person_id, v.transcript_id
  )
  SELECT jsonb_build_object(
    'survivor', (SELECT jsonb_build_object('person_id', p.id, 'name', p.name,
        'preferred_color', p.preferred_color, 'organisation_id', p.organisation_id,
        'organisation_name', o.name)
      FROM public.people AS p LEFT JOIN public.organisations AS o ON o.id = p.organisation_id
      WHERE p.id = p_survivor_id),
    'survivor_transcript_ids', COALESCE((
      SELECT jsonb_agg(a.transcript_id ORDER BY a.transcript_id)
      FROM public.person_appearances AS a
      WHERE a.person_id = p_survivor_id
    ), '[]'::jsonb),
    'people', (
      SELECT jsonb_agg(jsonb_build_object(
          'person_id', m.id, 'name', p.name, 'preferred_color', p.preferred_color,
          'organisation_id', p.organisation_id, 'organisation_name', o.name,
          'transcripts', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'transcript_id', t.id, 'title', t.title, 'created_at', t.created_at, 'voices', bt.voices)
              ORDER BY t.created_at DESC, t.id)
            FROM by_transcript AS bt
            JOIN public.transcripts AS t ON t.id = bt.transcript_id
            WHERE bt.person_id = m.id
          ), '[]'::jsonb))
        ORDER BY m.ord)
      FROM unnest(p_person_ids) WITH ORDINALITY AS m(id, ord)
      JOIN public.people AS p ON p.id = m.id
      LEFT JOIN public.organisations AS o ON o.id = p.organisation_id
    ))
  INTO v_result;

  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.people_directory()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;

  RETURN jsonb_build_object(
    'people', COALESCE((
      SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.created_at, entry.id)
      FROM (
        SELECT p.*, o.name AS organisation_name,
          seen.transcript_count, seen.last_seen_at
        FROM public.people AS p
        LEFT JOIN public.organisations AS o ON o.id = p.organisation_id
        CROSS JOIN LATERAL (
          SELECT count(*)::integer AS transcript_count, max(t.created_at) AS last_seen_at
          FROM public.person_appearances AS a
          JOIN public.transcripts AS t ON t.id = a.transcript_id
          WHERE a.person_id = p.id
        ) AS seen
        WHERE p.user_id = v_user
      ) AS entry
    ), '[]'::jsonb),
    'organisations', COALESCE((
      SELECT jsonb_agg(to_jsonb(entry) ORDER BY lower(entry.name), entry.id)
      FROM (
        SELECT o.*,
          (SELECT count(*)::integer FROM public.people AS p WHERE p.organisation_id = o.id) AS person_count
        FROM public.organisations AS o
        WHERE o.user_id = v_user
      ) AS entry
    ), '[]'::jsonb)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.project_branch_transcript_count(p_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_ids uuid[];
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  v_ids := public.project_branch_ids(v_user, p_id);
  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'PJ001';
  END IF;
  SELECT count(*)::integer INTO v_count
  FROM public.transcripts
  WHERE user_id = v_user AND project_id = ANY(v_ids);
  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.project_people(p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = p_project_id AND user_id = v_user AND deleting_at IS NULL
  ) THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'SP001';
  END IF;

  RETURN (
    WITH RECURSIVE
    -- The active branch: a project being deleted takes its whole subtree out,
    -- as in the summaries.
    branch AS (
      SELECT p_project_id AS id
      UNION ALL
      SELECT c.id
      FROM public.projects AS c
      JOIN branch AS b ON c.parent_id = b.id
      WHERE c.user_id = v_user AND c.deleting_at IS NULL
    ) CYCLE id SET is_cycle USING path,
    scope_transcripts AS (
      SELECT t.id, t.title, t.project_id, t.created_at
      FROM public.transcripts AS t
      WHERE t.user_id = v_user
        AND t.project_id IN (SELECT b.id FROM branch AS b WHERE NOT b.is_cycle)
    ),
    -- Each transcript speaker a segment references, read once: its speaking
    -- time and its first segment in transcript order (start_ms, then id, as
    -- the editor sorts segments).
    speaker_talk AS (
      SELECT sg.transcript_id, sg.speaker_id,
        sum(greatest(sg.end_ms - sg.start_ms, 0))::bigint AS talk_ms,
        min(sg.start_ms) AS first_start_ms,
        (array_agg(sg.id ORDER BY sg.start_ms, sg.id))[1] AS first_segment_id
      FROM public.segments AS sg
      WHERE sg.transcript_id IN (SELECT st.id FROM scope_transcripts AS st)
        AND sg.speaker_id IS NOT NULL
      GROUP BY sg.transcript_id, sg.speaker_id
    ),
    used_speakers AS (
      SELECT talk.transcript_id, talk.speaker_id, talk.talk_ms,
        talk.first_start_ms, talk.first_segment_id,
        sp.ordinal, sp.custom_label, sp.person_id
      FROM speaker_talk AS talk
      JOIN public.speakers AS sp ON sp.id = talk.speaker_id AND sp.transcript_id = talk.transcript_id
    ),
    listed_people AS (
      SELECT us.person_id,
        count(DISTINCT us.transcript_id)::integer AS transcript_count,
        sum(us.talk_ms)::bigint AS talk_ms,
        max(st.created_at) AS last_seen_at
      FROM used_speakers AS us
      JOIN scope_transcripts AS st ON st.id = us.transcript_id
      WHERE us.person_id IS NOT NULL
      GROUP BY us.person_id
    ),
    transcript_peers AS (
      SELECT us.transcript_id,
        jsonb_agg(jsonb_build_object(
            'id',               us.speaker_id,
            'ordinal',          us.ordinal,
            'customLabel',      us.custom_label,
            'personId',         us.person_id,
            'personName',       pe.name,
            'organisationName', og.name
          ) ORDER BY us.first_start_ms, us.first_segment_id) AS peers,
        jsonb_agg(us.speaker_id ORDER BY us.first_start_ms, us.first_segment_id)
          FILTER (WHERE us.person_id IS NULL) AS voice_ids
      FROM used_speakers AS us
      LEFT JOIN public.people AS pe ON pe.id = us.person_id
      LEFT JOIN public.organisations AS og ON og.id = pe.organisation_id
      GROUP BY us.transcript_id
    )
    SELECT jsonb_build_object(
      'people', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', pe.id, 'name', pe.name, 'preferred_color', pe.preferred_color,
            'organisation_name', og.name, 'hidden', pe.hidden,
            'transcript_count', lp.transcript_count, 'talk_ms', lp.talk_ms,
            'last_seen_at', lp.last_seen_at)
          ORDER BY lp.transcript_count DESC, lp.talk_ms DESC, lower(pe.name), pe.id)
        FROM listed_people AS lp
        JOIN public.people AS pe ON pe.id = lp.person_id AND pe.user_id = v_user
        LEFT JOIN public.organisations AS og ON og.id = pe.organisation_id
      ), '[]'::jsonb),
      'voices', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'transcript_id', st.id, 'title', st.title, 'project_id', st.project_id,
            'created_at', st.created_at, 'voice_ids', tp.voice_ids, 'peers', tp.peers)
          ORDER BY st.created_at DESC, st.id)
        FROM transcript_peers AS tp
        JOIN scope_transcripts AS st ON st.id = tp.transcript_id
        WHERE tp.voice_ids IS NOT NULL
      ), '[]'::jsonb)
    )
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reassign_segments(p_transcript_id uuid, p_changes jsonb)
 RETURNS TABLE(segment_id uuid, speaker_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.transcripts AS t
  WHERE t.id = p_transcript_id AND t.user_id = v_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transcript not found' USING ERRCODE = 'SP001';
  END IF;

  RETURN QUERY
  SELECT a.segment_id, a.speaker_id
  FROM public.apply_segment_speaker_changes(p_transcript_id, p_changes) AS a;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rejoin_segments(p_segment_id uuid, p_expected_revision integer, p_next_segment_id uuid, p_expected_next_revision integer, p_next_first_word_id uuid, p_text text, p_expected_text text, p_expected_next_text text, p_expected_speaker_id uuid, p_expected_next_speaker_id uuid)
 RETURNS segments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_transcript_id uuid;
  v_first public.segments;
  v_next public.segments;
  v_last_order integer;
  v_last_id uuid;
  v_next_first_order integer;
  v_next_first_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_segment_id IS NULL OR p_expected_revision IS NULL OR p_next_segment_id IS NULL
     OR p_expected_next_revision IS NULL OR p_next_first_word_id IS NULL
     OR p_segment_id = p_next_segment_id THEN
    RAISE EXCEPTION 'two segments, their revisions and the next first word are required'
      USING ERRCODE = 'SP003';
  END IF;

  SELECT sg.transcript_id INTO v_transcript_id
  FROM public.segments AS sg
  JOIN public.transcripts AS t ON t.id = sg.transcript_id
  WHERE sg.id = p_segment_id AND t.user_id = v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'segment not found' USING ERRCODE = 'SP001';
  END IF;

  PERFORM public.require_completed_transcript(v_transcript_id, v_user);

  -- Lock in id order so concurrent calls cannot deadlock. The next segment may
  -- already be gone (a replay).
  PERFORM 1
  FROM public.segments
  WHERE transcript_id = v_transcript_id AND id IN (p_segment_id, p_next_segment_id)
  ORDER BY id
  FOR UPDATE;

  SELECT * INTO v_first
  FROM public.segments
  WHERE id = p_segment_id AND transcript_id = v_transcript_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'segment not found' USING ERRCODE = 'SP001';
  END IF;

  SELECT * INTO v_next
  FROM public.segments
  WHERE id = p_next_segment_id AND transcript_id = v_transcript_id;
  IF NOT FOUND THEN
    -- Replay: the next segment's words are in this one, and it still holds the
    -- joined text and speaker this call wrote. Only p_segment_id, already
    -- scoped to the caller, and its own words are read.
    IF v_first.revision = p_expected_revision + 1
       AND v_first.text IS NOT DISTINCT FROM p_text
       AND v_first.speaker_id IS NOT DISTINCT FROM p_expected_speaker_id
       AND EXISTS (
         SELECT 1 FROM public.words AS w
         WHERE w.id = p_next_first_word_id AND w.segment_id = p_segment_id
       ) THEN
      RETURN v_first;
    END IF;
    RAISE EXCEPTION 'segment changed since it was read' USING ERRCODE = 'SP002';
  END IF;

  IF v_first.revision <> p_expected_revision OR v_next.revision <> p_expected_next_revision
     OR v_first.text IS DISTINCT FROM p_expected_text OR v_next.text IS DISTINCT FROM p_expected_next_text
     OR v_first.speaker_id IS DISTINCT FROM p_expected_speaker_id
     OR v_next.speaker_id IS DISTINCT FROM p_expected_next_speaker_id THEN
    RAISE EXCEPTION 'segment changed since it was read' USING ERRCODE = 'SP002';
  END IF;

  IF (v_next.start_ms, v_next.id) <= (v_first.start_ms, v_first.id)
     OR EXISTS (
       SELECT 1 FROM public.segments AS sg
       WHERE sg.transcript_id = v_transcript_id
         AND sg.id NOT IN (p_segment_id, p_next_segment_id)
         AND (sg.start_ms, sg.id) > (v_first.start_ms, v_first.id)
         AND (sg.start_ms, sg.id) < (v_next.start_ms, v_next.id)
     ) THEN
    RAISE EXCEPTION 'segments are not neighbours' USING ERRCODE = 'SP002';
  END IF;

  SELECT w.order_index, w.id INTO v_next_first_order, v_next_first_id
  FROM public.words AS w
  WHERE w.segment_id = p_next_segment_id
  ORDER BY w.order_index, w.id
  LIMIT 1;
  IF v_next_first_id IS DISTINCT FROM p_next_first_word_id THEN
    RAISE EXCEPTION 'next first word does not match' USING ERRCODE = 'SP003';
  END IF;

  -- Joined words must keep their spoken order.
  SELECT w.order_index, w.id INTO v_last_order, v_last_id
  FROM public.words AS w
  WHERE w.segment_id = p_segment_id
  ORDER BY w.order_index DESC, w.id DESC
  LIMIT 1;
  IF v_last_id IS NOT NULL
     AND (v_last_order, v_last_id) >= (v_next_first_order, v_next_first_id) THEN
    RAISE EXCEPTION 'words would fall out of order' USING ERRCODE = 'SP002';
  END IF;

  IF p_text IS NULL OR p_text !~ '\S' THEN
    RAISE EXCEPTION 'the joined segment needs text' USING ERRCODE = 'SP003';
  END IF;

  -- Words first: deleting the segment would cascade to them.
  UPDATE public.words SET segment_id = p_segment_id WHERE segment_id = p_next_segment_id;
  DELETE FROM public.segments WHERE id = p_next_segment_id;

  UPDATE public.segments
  SET text = p_text,
      is_edited = true,
      revision = revision + 1,
      end_ms = GREATEST(v_first.end_ms, v_next.end_ms)
  WHERE id = p_segment_id
  RETURNING * INTO v_first;

  RETURN v_first;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_person_from_transcript(p_person_id uuid, p_transcript_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_changes jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM public.require_completed_transcript(p_transcript_id, v_user);
  -- Merge and delete lock the person FOR UPDATE, so this waits for either to
  -- finish and then finds the person gone. Without it, a merge committing
  -- between the read and the move below would pass the segment guard, since a
  -- merge relinks speakers and leaves segments where they are.
  PERFORM 1 FROM public.people WHERE id = p_person_id AND user_id = v_user FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'person not found' USING ERRCODE = 'SP001'; END IF;

  SELECT jsonb_agg(jsonb_build_object(
      'segment_id', sg.id, 'expected_speaker_id', sg.speaker_id,
      'expected_revision', sg.revision, 'speaker_id', home.id)
    ORDER BY sg.start_ms, sg.id)
  INTO v_changes
  FROM public.segments AS sg
  JOIN public.speakers AS sp ON sp.transcript_id = sg.transcript_id AND sp.id = sg.speaker_id
  LEFT JOIN public.speakers AS home
    ON home.transcript_id = sg.transcript_id AND home.diarization_index = sg.diarization_index
  WHERE sg.transcript_id = p_transcript_id AND sp.person_id = p_person_id;

  IF v_changes IS NULL THEN
    RAISE EXCEPTION 'person has no segments in this transcript' USING ERRCODE = 'SP002';
  END IF;

  -- Locks the segments and checks each still holds the speaker read above.
  PERFORM 1 FROM public.apply_segment_speaker_changes(p_transcript_id, v_changes);
  RETURN v_changes;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rename_organisation(p_organisation_id uuid, p_expected_name text, p_name text)
 RETURNS organisations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_name text := regexp_replace(p_name, '^\s+|\s+$', '', 'g');
  v_organisation public.organisations;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  -- Mirrors TEXT_LIMITS.organisationName in frontend/contracts/limits.ts.
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'organisation names must be 1 to 50 characters' USING ERRCODE = 'SP003';
  END IF;
  SELECT * INTO v_organisation FROM public.organisations
  WHERE id = p_organisation_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organisation not found' USING ERRCODE = 'SP001'; END IF;
  IF v_organisation.name IS DISTINCT FROM p_expected_name THEN
    RAISE EXCEPTION 'organisation name changed since it was read' USING ERRCODE = 'SP002';
  END IF;
  UPDATE public.organisations SET name = v_name
  WHERE id = p_organisation_id RETURNING * INTO v_organisation;
  RETURN v_organisation;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rename_person_guarded(p_person_id uuid, p_expected_name text, p_name text)
 RETURNS people
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_name text := regexp_replace(p_name, '^\s+|\s+$', '', 'g');
  v_person public.people;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid person name' USING ERRCODE = 'SP003';
  END IF;
  SELECT * INTO v_person FROM public.people
  WHERE id = p_person_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'person not found' USING ERRCODE = 'SP001'; END IF;
  IF v_person.name = v_name THEN RETURN v_person; END IF;
  IF v_person.name IS DISTINCT FROM p_expected_name THEN
    RAISE EXCEPTION 'person name changed since it was read' USING ERRCODE = 'SP002';
  END IF;
  UPDATE public.people SET name = v_name WHERE id = p_person_id RETURNING * INTO v_person;
  RETURN v_person;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.restore_created_person(p_transcript_id uuid, p_person_id uuid, p_name text, p_preferred_color text, p_speaker_id uuid, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_name text := regexp_replace(p_name, '^\s+|\s+$', '', 'g');
  v_speaker public.speakers;
  v_person public.people;
  v_assignments jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF p_person_id IS NULL OR p_speaker_id IS NULL OR p_changes IS NULL
     OR jsonb_typeof(p_changes) <> 'array' OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'person, speaker and changes are required' USING ERRCODE = 'SP003';
  END IF;
  PERFORM public.require_completed_transcript(p_transcript_id, v_user);
  SELECT * INTO v_person FROM public.people WHERE id = p_person_id FOR UPDATE;
  IF FOUND THEN
    IF v_person.user_id <> v_user THEN
      RAISE EXCEPTION 'person id is already in use' USING ERRCODE = 'SP003';
    END IF;
    IF v_person.updated_at <> v_person.created_at OR v_person.name IS DISTINCT FROM v_name
       OR v_person.preferred_color IS DISTINCT FROM p_preferred_color
       OR NOT EXISTS (
         SELECT 1 FROM public.speakers
         WHERE id = p_speaker_id AND transcript_id = p_transcript_id AND user_id = v_user
           AND person_id = p_person_id
       )
       OR EXISTS (
         SELECT 1 FROM jsonb_to_recordset(p_changes) AS c(segment_id uuid)
         LEFT JOIN public.segments AS sg ON sg.id = c.segment_id
         WHERE sg.speaker_id IS DISTINCT FROM p_speaker_id
       ) THEN
      RAISE EXCEPTION 'person changed since it was restored' USING ERRCODE = 'SP002';
    END IF;
    SELECT * INTO v_speaker FROM public.speakers WHERE id = p_speaker_id;
  ELSE
    SELECT * INTO v_speaker FROM public.speakers WHERE id = p_speaker_id
      AND transcript_id = p_transcript_id AND user_id = v_user FOR UPDATE;
    IF NOT FOUND OR v_speaker.person_id IS NOT NULL OR v_speaker.custom_label IS NOT NULL
      OR v_speaker.diarization_index IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.segments WHERE speaker_id = p_speaker_id) THEN
      RAISE EXCEPTION 'speaker changed since it was read' USING ERRCODE = 'SP002';
    END IF;
    INSERT INTO public.people(id, user_id, name, preferred_color)
      VALUES(p_person_id, v_user, v_name, p_preferred_color) RETURNING * INTO v_person;
    UPDATE public.speakers SET person_id = p_person_id WHERE id = p_speaker_id RETURNING * INTO v_speaker;
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO v_assignments
  FROM public.apply_segment_speaker_changes(p_transcript_id,
    (SELECT jsonb_agg(e || jsonb_build_object('speaker_id', p_speaker_id)) FROM jsonb_array_elements(p_changes) e)) a;
  RETURN jsonb_build_object('speaker', to_jsonb(v_speaker), 'person', to_jsonb(v_person), 'assignments', v_assignments);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_person_color(p_person_id uuid, p_expected_color text, p_color text)
 RETURNS people
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_person public.people;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF p_color IS NULL OR NOT (p_color = ANY (public.speaker_palette())) THEN
    RAISE EXCEPTION 'choose a palette colour' USING ERRCODE = 'SP003';
  END IF;
  SELECT * INTO v_person FROM public.people
  WHERE id = p_person_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'person not found' USING ERRCODE = 'SP001'; END IF;
  IF v_person.preferred_color IS DISTINCT FROM p_expected_color THEN
    RAISE EXCEPTION 'colour changed since it was read' USING ERRCODE = 'SP002';
  END IF;
  UPDATE public.people SET preferred_color = p_color
  WHERE id = p_person_id RETURNING * INTO v_person;
  RETURN v_person;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_person_hidden(p_person_id uuid, p_hidden boolean)
 RETURNS people
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_person public.people;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF p_hidden IS NULL THEN RAISE EXCEPTION 'hidden must be true or false' USING ERRCODE = 'SP003'; END IF;
  UPDATE public.people SET hidden = p_hidden
  WHERE id = p_person_id AND user_id = v_user RETURNING * INTO v_person;
  IF NOT FOUND THEN RAISE EXCEPTION 'person not found' USING ERRCODE = 'SP001'; END IF;
  RETURN v_person;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_person_organisation(p_person_id uuid, p_expected_organisation_id uuid, p_organisation_id uuid DEFAULT NULL::uuid, p_new_organisation_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_name text := regexp_replace(p_new_organisation_name, '^\s+|\s+$', '', 'g');
  v_person public.people;
  v_organisation public.organisations;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF p_organisation_id IS NOT NULL AND p_new_organisation_name IS NOT NULL THEN
    RAISE EXCEPTION 'choose an existing or a new organisation, not both' USING ERRCODE = 'SP003';
  END IF;
  -- Mirrors TEXT_LIMITS.organisationName in frontend/contracts/limits.ts.
  IF p_new_organisation_name IS NOT NULL AND char_length(v_name) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'organisation names must be 1 to 50 characters' USING ERRCODE = 'SP003';
  END IF;

  SELECT * INTO v_person FROM public.people
  WHERE id = p_person_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'person not found' USING ERRCODE = 'SP001'; END IF;
  IF v_person.organisation_id IS DISTINCT FROM p_expected_organisation_id THEN
    RAISE EXCEPTION 'organisation changed since it was read' USING ERRCODE = 'SP002';
  END IF;

  IF p_organisation_id IS NOT NULL THEN
    SELECT * INTO v_organisation FROM public.organisations
    WHERE id = p_organisation_id AND user_id = v_user;
    IF NOT FOUND THEN RAISE EXCEPTION 'organisation not found' USING ERRCODE = 'SP001'; END IF;
  ELSIF v_name IS NOT NULL THEN
    INSERT INTO public.organisations (user_id, name) VALUES (v_user, v_name) ON CONFLICT DO NOTHING;
    SELECT * INTO v_organisation FROM public.organisations
    WHERE user_id = v_user AND lower(name) = lower(v_name);
  END IF;

  UPDATE public.people SET organisation_id = v_organisation.id
  WHERE id = p_person_id RETURNING * INTO v_person;

  RETURN jsonb_build_object(
    'person', to_jsonb(v_person),
    'organisation', CASE WHEN v_organisation.id IS NULL THEN NULL ELSE to_jsonb(v_organisation) END
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_segment_texts_guarded(p_edits jsonb)
 RETURNS SETOF segments
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_edit jsonb;
  v_row public.segments;
BEGIN
  IF (SELECT public.current_user_id()) IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF p_edits IS NULL OR jsonb_typeof(p_edits) <> 'array' OR jsonb_array_length(p_edits) = 0 THEN
    RAISE EXCEPTION 'edits must be a non-empty array' USING ERRCODE = 'SP003';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_edits) e WHERE jsonb_typeof(e) <> 'object'
    OR NOT (e ?& ARRAY['segment_id', 'expected_revision', 'expected_text', 'text'])
    OR jsonb_typeof(e->'segment_id') <> 'string' OR jsonb_typeof(e->'expected_revision') <> 'number'
    OR jsonb_typeof(e->'expected_text') <> 'string' OR jsonb_typeof(e->'text') <> 'string')
    OR (SELECT count(DISTINCT e->>'segment_id') FROM jsonb_array_elements(p_edits) e) <> jsonb_array_length(p_edits) THEN
    RAISE EXCEPTION 'invalid or duplicate edits' USING ERRCODE = 'SP003';
  END IF;
  -- In id order, so concurrent calls cannot deadlock.
  FOR v_edit IN SELECT e FROM jsonb_array_elements(p_edits) e ORDER BY (e->>'segment_id')::uuid LOOP
    UPDATE public.segments sg SET text = v_edit->>'text', is_edited = true
    WHERE sg.id = (v_edit->>'segment_id')::uuid
      AND sg.revision = (v_edit->>'expected_revision')::integer
      AND (sg.text = v_edit->>'expected_text' OR sg.text = v_edit->>'text')
      AND EXISTS (SELECT 1 FROM public.transcripts t WHERE t.id = sg.transcript_id AND t.user_id = (SELECT public.current_user_id()))
    RETURNING sg.* INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'segment text changed since it was read' USING ERRCODE = 'SP002'; END IF;
    RETURN NEXT v_row;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_speaker_custom_label(p_speaker_id uuid, p_expected_custom_label text, p_custom_label text)
 RETURNS speakers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_label text := NULLIF(regexp_replace(p_custom_label, '^\s+|\s+$', '', 'g'), '');
  v_speaker public.speakers;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF v_label IS NULL OR char_length(v_label) > 50 THEN
    RAISE EXCEPTION 'speaker names must be 1 to 50 characters' USING ERRCODE = 'SP003';
  END IF;
  SELECT * INTO v_speaker FROM public.speakers WHERE id = p_speaker_id AND user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'speaker not found' USING ERRCODE = 'SP001'; END IF;
  PERFORM public.require_completed_transcript(v_speaker.transcript_id, v_user);
  SELECT * INTO v_speaker FROM public.speakers WHERE id = p_speaker_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'speaker not found' USING ERRCODE = 'SP001'; END IF;
  IF v_speaker.diarization_index IS NOT NULL THEN
    RAISE EXCEPTION 'a detected speaker has no name of its own' USING ERRCODE = 'SP003';
  END IF;
  IF v_speaker.person_id IS NULL AND v_speaker.custom_label = v_label THEN RETURN v_speaker; END IF;
  IF v_speaker.person_id IS NOT NULL OR v_speaker.custom_label IS DISTINCT FROM p_expected_custom_label THEN
    RAISE EXCEPTION 'speaker changed since it was read' USING ERRCODE = 'SP002';
  END IF;
  UPDATE public.speakers SET custom_label = v_label WHERE id = p_speaker_id RETURNING * INTO v_speaker;
  RETURN v_speaker;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.split_segment(p_segment_id uuid, p_expected_revision integer, p_split_word_id uuid, p_first_text text, p_second_text text, p_new_segment_id uuid, p_expected_text text, p_expected_speaker_id uuid)
 RETURNS SETOF segments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_transcript_id uuid;
  v_segment public.segments;
  v_new public.segments;
  v_split_order integer;
  v_first_end integer;
  v_new_start integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_segment_id IS NULL OR p_expected_revision IS NULL
     OR p_split_word_id IS NULL OR p_new_segment_id IS NULL THEN
    RAISE EXCEPTION 'segment, revision, split word and new segment id are required'
      USING ERRCODE = 'SP003';
  END IF;

  SELECT sg.transcript_id INTO v_transcript_id
  FROM public.segments AS sg
  JOIN public.transcripts AS t ON t.id = sg.transcript_id
  WHERE sg.id = p_segment_id AND t.user_id = v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'segment not found' USING ERRCODE = 'SP001';
  END IF;

  PERFORM public.require_completed_transcript(v_transcript_id, v_user);

  SELECT * INTO v_segment
  FROM public.segments
  WHERE id = p_segment_id AND transcript_id = v_transcript_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'segment not found' USING ERRCODE = 'SP001';
  END IF;

  -- Replay. The new id is only ever made by this call, so finding it means the
  -- split happened; it counts as this call's result only while both halves
  -- still hold what it wrote. Text and speaker edits leave revisions alone, so
  -- they are checked too. The lookup stays inside the caller's transcript.
  IF EXISTS (SELECT 1 FROM public.segments WHERE id = p_new_segment_id) THEN
    SELECT * INTO v_new
    FROM public.segments
    WHERE id = p_new_segment_id AND transcript_id = v_transcript_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'new segment id is already in use' USING ERRCODE = 'SP003';
    END IF;
    IF v_new.revision = 0
       AND v_segment.revision = p_expected_revision + 1
       AND v_segment.text IS NOT DISTINCT FROM p_first_text
       AND v_new.text IS NOT DISTINCT FROM p_second_text
       AND v_segment.speaker_id IS NOT DISTINCT FROM p_expected_speaker_id
       AND v_new.speaker_id IS NOT DISTINCT FROM p_expected_speaker_id
       AND EXISTS (
         SELECT 1 FROM public.words AS w
         WHERE w.id = p_split_word_id AND w.segment_id = p_new_segment_id
       ) THEN
      RETURN QUERY
      SELECT * FROM public.segments AS sg
      WHERE sg.id IN (p_segment_id, p_new_segment_id)
      ORDER BY sg.start_ms, sg.id;
      RETURN;
    END IF;
    RAISE EXCEPTION 'segment changed since it was split' USING ERRCODE = 'SP002';
  END IF;

  IF v_segment.revision <> p_expected_revision
     OR v_segment.text IS DISTINCT FROM p_expected_text
     OR v_segment.speaker_id IS DISTINCT FROM p_expected_speaker_id THEN
    RAISE EXCEPTION 'segment changed since it was read' USING ERRCODE = 'SP002';
  END IF;

  IF p_first_text IS NULL OR p_second_text IS NULL
     OR p_first_text !~ '\S' OR p_second_text !~ '\S' THEN
    RAISE EXCEPTION 'both halves need text' USING ERRCODE = 'SP003';
  END IF;

  SELECT w.order_index INTO v_split_order
  FROM public.words AS w
  WHERE w.id = p_split_word_id AND w.segment_id = p_segment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'split word is not in this segment' USING ERRCODE = 'SP003';
  END IF;

  -- Words are in (order_index, id) order, as the editor reads them.
  SELECT max(w.end_ms) INTO v_first_end
  FROM public.words AS w
  WHERE w.segment_id = p_segment_id
    AND (w.order_index, w.id) < (v_split_order, p_split_word_id);
  IF v_first_end IS NULL THEN
    RAISE EXCEPTION 'the first half needs a spoken word' USING ERRCODE = 'SP003';
  END IF;

  SELECT min(w.start_ms) INTO v_new_start
  FROM public.words AS w
  WHERE w.segment_id = p_segment_id
    AND (w.order_index, w.id) >= (v_split_order, p_split_word_id);

  -- The halves must stay side by side in display order, (start_ms, id). With
  -- equal start times the random new id would otherwise decide which comes
  -- first, and a segment starting between them would end up in the middle.
  IF (v_new_start, p_new_segment_id) <= (v_segment.start_ms, v_segment.id)
     OR EXISTS (
       SELECT 1 FROM public.segments AS sg
       WHERE sg.transcript_id = v_transcript_id
         AND sg.id <> p_segment_id
         AND (sg.start_ms, sg.id) > (v_segment.start_ms, v_segment.id)
         AND (sg.start_ms, sg.id) < (v_new_start, p_new_segment_id)
     ) THEN
    RAISE EXCEPTION 'the halves would not stay in order' USING ERRCODE = 'SP003';
  END IF;

  INSERT INTO public.segments (
    id, transcript_id, speaker_id, diarization_index, start_ms, end_ms,
    text, is_edited, is_filler, algo_version, revision
  )
  VALUES (
    p_new_segment_id, v_transcript_id, v_segment.speaker_id, v_segment.diarization_index,
    v_new_start, v_segment.end_ms, p_second_text, true, v_segment.is_filler,
    v_segment.algo_version, 0
  );

  UPDATE public.words AS w
  SET segment_id = p_new_segment_id
  WHERE w.segment_id = p_segment_id
    AND (w.order_index, w.id) >= (v_split_order, p_split_word_id);

  UPDATE public.segments
  SET text = p_first_text, is_edited = true, revision = revision + 1, end_ms = v_first_end
  WHERE id = p_segment_id;

  RETURN QUERY
  SELECT * FROM public.segments AS sg
  WHERE sg.id IN (p_segment_id, p_new_segment_id)
  ORDER BY sg.start_ms, sg.id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.transcript_delete_inventory(p_ids uuid[])
 RETURNS TABLE(media_keys text[], waveform_keys text[], result_keys text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(array_agg(f.name ORDER BY f.name) FILTER (WHERE f.bucket_id = 'media'), '{}'::text[]),
    COALESCE(array_agg(f.name ORDER BY f.name) FILTER (WHERE f.bucket_id = 'waveforms'), '{}'::text[]),
    COALESCE(array_agg(f.name ORDER BY f.name) FILTER (WHERE f.bucket_id = 'transcription-results'), '{}'::text[])
  FROM public.transcript_folder_objects(v_user, p_ids) AS f;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.transition_job_status(p_job_id uuid, p_to_status text, p_extra_fields jsonb DEFAULT '{}'::jsonb, p_metadata jsonb DEFAULT '{}'::jsonb, p_context text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_status TEXT;
  v_transcript_id UUID;
  v_valid_targets TEXT[];
  v_rows_updated INT;
  v_caller_uid UUID;
  v_unknown_field TEXT;
BEGIN
  SELECT k INTO v_unknown_field
  FROM jsonb_object_keys(COALESCE(p_extra_fields, '{}'::jsonb)) AS k
  WHERE k NOT IN (
    'finished_at', 'started_at', 'inngest_event_id',
    'error_message', 'error_type', 'error_detail'
  )
  LIMIT 1;
  IF v_unknown_field IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid', 'error', format('Unknown job field: %s', v_unknown_field));
  END IF;

  SELECT status, transcript_id INTO v_current_status, v_transcript_id
  FROM public.jobs WHERE id = p_job_id FOR UPDATE;

  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid', 'error', 'Job not found');
  END IF;

  v_caller_uid := (SELECT public.current_user_id());
  IF v_caller_uid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.transcripts WHERE id = v_transcript_id AND user_id = v_caller_uid
    ) THEN
      RETURN jsonb_build_object('outcome', 'invalid', 'error', 'Not authorized');
    END IF;
  END IF;

  IF v_current_status = p_to_status THEN
    RETURN jsonb_build_object('outcome', 'noop', 'previous_status', v_current_status);
  END IF;

  v_valid_targets := CASE v_current_status
    WHEN 'queued' THEN ARRAY['processing', 'completed', 'error']
    WHEN 'processing' THEN ARRAY['completed', 'error']
    WHEN 'error' THEN ARRAY['completed']
    ELSE ARRAY[]::TEXT[]
  END;

  IF NOT (p_to_status = ANY(v_valid_targets)) THEN
    RETURN jsonb_build_object(
      'outcome', 'invalid',
      'error', format('Invalid transition: %s -> %s', v_current_status, p_to_status),
      'previous_status', v_current_status
    );
  END IF;

  -- A job that completes, including one recovered from error, carries no error.
  UPDATE public.jobs SET
    status = p_to_status,
    finished_at = COALESCE((p_extra_fields->>'finished_at')::timestamptz, finished_at),
    started_at = COALESCE((p_extra_fields->>'started_at')::timestamptz, started_at),
    inngest_event_id = COALESCE(p_extra_fields->>'inngest_event_id', inngest_event_id),
    error_message = CASE
      WHEN p_to_status = 'completed' THEN NULL
      WHEN p_extra_fields ? 'error_message' THEN p_extra_fields->>'error_message'
      ELSE error_message
    END,
    error_type = CASE
      WHEN p_to_status = 'completed' THEN NULL
      WHEN p_extra_fields ? 'error_type' THEN p_extra_fields->>'error_type'
      ELSE error_type
    END,
    error_detail = CASE
      WHEN p_to_status = 'completed' THEN NULL
      WHEN p_extra_fields ? 'error_detail' THEN left(p_extra_fields->>'error_detail', 500)
      ELSE error_detail
    END,
    updated_at = now()
  WHERE id = p_job_id AND status = v_current_status;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'previous_status', v_current_status);
  END IF;

  INSERT INTO public.job_events (job_id, from_status, to_status, metadata)
  VALUES (p_job_id, v_current_status, p_to_status,
    p_metadata || jsonb_build_object('context', COALESCE(p_context, 'unknown'))
  );

  RETURN jsonb_build_object('outcome', 'applied', 'previous_status', v_current_status);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.undo_created_person_action(p_transcript_id uuid, p_person_id uuid, p_expected_name text, p_expected_color text, p_speaker_id uuid, p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_person public.people;
  v_speaker public.speakers;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'changes must be a non-empty array' USING ERRCODE = 'SP003';
  END IF;
  PERFORM public.require_completed_transcript(p_transcript_id, v_user);
  SELECT * INTO v_person FROM public.people WHERE id = p_person_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN
    -- Resend: already undone while the speaker is unlinked and every segment
    -- is back where the undo sends it, in the shape the undo was made for.
    -- Speaker writes leave revisions alone; a split or rejoin since does not.
    IF EXISTS (
         SELECT 1 FROM public.speakers
         WHERE id = p_speaker_id AND transcript_id = p_transcript_id AND user_id = v_user
           AND person_id IS NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_to_recordset(p_changes) AS c(segment_id uuid, speaker_id uuid, expected_revision integer)
         LEFT JOIN public.segments AS sg ON sg.id = c.segment_id AND sg.transcript_id = p_transcript_id
         WHERE sg.id IS NULL OR sg.speaker_id IS DISTINCT FROM c.speaker_id
            OR sg.revision IS DISTINCT FROM c.expected_revision
       ) THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'person changed since it was created' USING ERRCODE = 'SP002';
  END IF;
  IF v_person.name IS DISTINCT FROM p_expected_name
     OR v_person.preferred_color IS DISTINCT FROM p_expected_color
     OR v_person.organisation_id IS NOT NULL OR v_person.hidden THEN
    RAISE EXCEPTION 'person changed since it was created' USING ERRCODE = 'SP002';
  END IF;
  SELECT * INTO v_speaker FROM public.speakers WHERE id = p_speaker_id
    AND transcript_id = p_transcript_id AND user_id = v_user AND person_id = p_person_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'speaker link changed since it was read' USING ERRCODE = 'SP002'; END IF;
  IF EXISTS (SELECT 1 FROM public.speakers WHERE person_id = p_person_id AND id <> p_speaker_id) THEN
    RAISE EXCEPTION 'person has another link' USING ERRCODE = 'SP002';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.segments AS sg WHERE sg.speaker_id = p_speaker_id
    AND sg.id NOT IN (SELECT c.segment_id FROM jsonb_to_recordset(p_changes) AS c(segment_id uuid))
  ) THEN RAISE EXCEPTION 'new speaker has other segments' USING ERRCODE = 'SP002'; END IF;
  PERFORM 1 FROM public.apply_segment_speaker_changes(p_transcript_id, p_changes);
  DELETE FROM public.people WHERE id = p_person_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_transcript_title_guarded(p_transcript_id uuid, p_expected_title text, p_title text)
 RETURNS transcripts
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v_row public.transcripts;
BEGIN
  IF (SELECT public.current_user_id()) IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  UPDATE public.transcripts SET title = p_title
  WHERE id = p_transcript_id AND user_id = (SELECT public.current_user_id())
    AND (title IS NOT DISTINCT FROM p_expected_title OR title IS NOT DISTINCT FROM p_title)
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'title changed since it was read' USING ERRCODE = 'SP002'; END IF;
  RETURN v_row;
END;
$function$
;


-- ---------------------------------------------------------------------------
-- 4b. Policies: public tables, the media and waveforms buckets, and the
--     private Projects v1 delete invalidations on realtime.messages.
-- ---------------------------------------------------------------------------

DROP POLICY "Users can read own transcript jobs" ON public.jobs;
CREATE POLICY "Users can read own transcript jobs" ON public.jobs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((transcript_id IN ( SELECT t.id
   FROM transcripts t
  WHERE (t.user_id = ( SELECT public.current_user_id() AS uid)))));

DROP POLICY "Users can view own organisations" ON public.organisations;
CREATE POLICY "Users can view own organisations" ON public.organisations
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = ( SELECT public.current_user_id() AS uid)));

DROP POLICY "Users can view own people" ON public.people;
CREATE POLICY "Users can view own people" ON public.people
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = ( SELECT public.current_user_id() AS uid)));

DROP POLICY "Users can create own projects" ON public.projects;
CREATE POLICY "Users can create own projects" ON public.projects
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((user_id = (SELECT public.current_user_id())));

DROP POLICY "Users can delete own projects" ON public.projects;
CREATE POLICY "Users can delete own projects" ON public.projects
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((user_id = (SELECT public.current_user_id())));

DROP POLICY "Users can update own projects" ON public.projects;
CREATE POLICY "Users can update own projects" ON public.projects
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((user_id = (SELECT public.current_user_id())))
  WITH CHECK ((user_id = (SELECT public.current_user_id())));

DROP POLICY "Users can view own projects" ON public.projects;
CREATE POLICY "Users can view own projects" ON public.projects
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = (SELECT public.current_user_id())));

DROP POLICY "Users can edit own transcript segments" ON public.segments;
CREATE POLICY "Users can edit own transcript segments" ON public.segments
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((transcript_id IN ( SELECT t.id
   FROM transcripts t
  WHERE (t.user_id = ( SELECT public.current_user_id() AS uid)))))
  WITH CHECK ((transcript_id IN ( SELECT t.id
   FROM transcripts t
  WHERE (t.user_id = ( SELECT public.current_user_id() AS uid)))));

DROP POLICY "Users can read own transcript segments" ON public.segments;
CREATE POLICY "Users can read own transcript segments" ON public.segments
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((transcript_id IN ( SELECT t.id
   FROM transcripts t
  WHERE (t.user_id = ( SELECT public.current_user_id() AS uid)))));

DROP POLICY "Users can view own transcript speakers" ON public.speakers;
CREATE POLICY "Users can view own transcript speakers" ON public.speakers
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = ( SELECT public.current_user_id() AS uid)));

DROP POLICY "Users can create own transcripts" ON public.transcripts;
CREATE POLICY "Users can create own transcripts" ON public.transcripts
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((user_id = (SELECT public.current_user_id())));

DROP POLICY "Users can update own transcripts" ON public.transcripts;
CREATE POLICY "Users can update own transcripts" ON public.transcripts
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((user_id = (SELECT public.current_user_id())));

DROP POLICY "Users can view own transcripts" ON public.transcripts;
CREATE POLICY "Users can view own transcripts" ON public.transcripts
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = (SELECT public.current_user_id())));

DROP POLICY "Users can add own transcript watchlist terms" ON public.watchlist;
CREATE POLICY "Users can add own transcript watchlist terms" ON public.watchlist
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((transcript_id IN ( SELECT t.id
   FROM transcripts t
  WHERE (t.user_id = ( SELECT public.current_user_id() AS uid)))));

DROP POLICY "Users can read own transcript watchlist" ON public.watchlist;
CREATE POLICY "Users can read own transcript watchlist" ON public.watchlist
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((transcript_id IN ( SELECT t.id
   FROM transcripts t
  WHERE (t.user_id = ( SELECT public.current_user_id() AS uid)))));

DROP POLICY "Users can read own transcript words" ON public.words;
CREATE POLICY "Users can read own transcript words" ON public.words
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((segment_id IN ( SELECT s.id
   FROM (segments s
     JOIN transcripts t ON ((t.id = s.transcript_id)))
  WHERE (t.user_id = ( SELECT public.current_user_id() AS uid)))));

DROP POLICY "Users can receive own Projects v1 delete invalidations" ON realtime.messages;
CREATE POLICY "Users can receive own Projects v1 delete invalidations" ON realtime.messages
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((extension = 'broadcast'::text) AND (realtime.topic() = ('projects-v1:'::text || (( SELECT public.current_user_id() AS uid))::text))));

DROP POLICY "Users can delete own files" ON storage.objects;
CREATE POLICY "Users can delete own files" ON storage.objects
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (((bucket_id = 'media'::text) AND (((SELECT public.current_user_id()))::text = (storage.foldername(name))[1])));

DROP POLICY "Users can delete own waveforms" ON storage.objects;
CREATE POLICY "Users can delete own waveforms" ON storage.objects
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (((bucket_id = 'waveforms'::text) AND (((SELECT public.current_user_id()))::text = (storage.foldername(name))[1])));

DROP POLICY "Users can read own files" ON storage.objects;
CREATE POLICY "Users can read own files" ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((bucket_id = 'media'::text) AND (((SELECT public.current_user_id()))::text = (storage.foldername(name))[1])));

DROP POLICY "Users can read own waveforms" ON storage.objects;
CREATE POLICY "Users can read own waveforms" ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((bucket_id = 'waveforms'::text) AND (((SELECT public.current_user_id()))::text = (storage.foldername(name))[1])));

DROP POLICY "Users can update own files" ON storage.objects;
CREATE POLICY "Users can update own files" ON storage.objects
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((bucket_id = 'media'::text) AND (((SELECT public.current_user_id()))::text = (storage.foldername(name))[1])));

DROP POLICY "Users can upload to own folder" ON storage.objects;
CREATE POLICY "Users can upload to own folder" ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((bucket_id = 'media'::text) AND (((SELECT public.current_user_id()))::text = (storage.foldername(name))[1])));


-- ---------------------------------------------------------------------------
-- 5. Nothing may still read auth.uid(): under WorkOS it is NULL for everyone
--    (the token subject is not a UUID), so a leftover would quietly deny.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_left text;
BEGIN
  SELECT string_agg(item, ', ') INTO v_left
  FROM (
    SELECT format('policy %I on %I.%I', policyname, schemaname, tablename) AS item
    FROM pg_policies
    WHERE schemaname IN ('public', 'storage', 'realtime')
      AND coalesce(qual, '') || coalesce(with_check, '') ILIKE '%auth.uid()%'
    UNION ALL
    SELECT format('function %s', p.oid::regprocedure)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosrc ILIKE '%auth.uid()%'
  ) leftovers;

  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'auth.uid() is still used by: %', v_left;
  END IF;
END;
$$;
