-- Speaker identity overhaul, slice 3: the People directory and person-aware
-- project summaries (spec §4, §8).
--
-- people and organisations stay read-only to signed-in users. Every directory
-- write goes through a guarded definer function below, as the editor's do. No
-- table changes shape and no row is rewritten.
--
-- SQLSTATEs follow the earlier speaker migrations: SP001 not found (or not the
-- caller's), SP002 changed since it was read, SP003 invalid input.

-- -------------------------------------------------------------------------
-- 1. Reads. Definer rights so they can use person_appearances, which stays
--    internal; every query filters on the caller explicitly.
-- -------------------------------------------------------------------------

-- The list page: every person the caller owns with their organisation, the
-- number of transcripts they appear in and when they were last seen (the
-- created_at of the newest such transcript), plus every organisation with its
-- number of people. One JSON result avoids row-limit truncation.
CREATE FUNCTION public.people_directory()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;

-- The person page: one row per transcript the person appears in, newest
-- first. A person the caller does not own has none.
CREATE FUNCTION public.list_person_appearances(p_person_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
        'transcript_id', t.id, 'title', t.title, 'project_id', t.project_id,
        'created_at', t.created_at, 'segment_count', a.segment_count)
      ORDER BY t.created_at DESC, t.id)
    FROM public.person_appearances AS a
    JOIN public.transcripts AS t ON t.id = a.transcript_id
    WHERE a.person_id = p_person_id AND a.user_id = v_user
  ), '[]'::jsonb);
END;
$$;

-- Internal: the input rules merge_people and its preview share. A survivor
-- and at least one other person, each named once, all owned by the caller.
CREATE FUNCTION public.check_merge_request(p_user_id uuid, p_survivor_id uuid, p_person_ids uuid[])
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF p_survivor_id IS NULL OR p_person_ids IS NULL OR cardinality(p_person_ids) = 0
     OR EXISTS (SELECT 1 FROM unnest(p_person_ids) AS m(id) WHERE m.id IS NULL) THEN
    RAISE EXCEPTION 'choose a survivor and at least one person to merge' USING ERRCODE = 'SP003';
  END IF;
  IF p_survivor_id = ANY (p_person_ids)
     OR (SELECT count(DISTINCT m.id) FROM unnest(p_person_ids) AS m(id)) <> cardinality(p_person_ids) THEN
    RAISE EXCEPTION 'each person is merged once, and never into themselves' USING ERRCODE = 'SP003';
  END IF;
  IF (SELECT count(*) FROM public.people AS p
      WHERE p.user_id = p_user_id AND (p.id = p_survivor_id OR p.id = ANY (p_person_ids)))
     <> cardinality(p_person_ids) + 1 THEN
    RAISE EXCEPTION 'person not found' USING ERRCODE = 'SP001';
  END IF;
END;
$$;

-- What a merge would move (spec §4): for each person to fold in, in the order
-- given, every transcript they appear in and each local voice there, a linked
-- transcript speaker with segments. A voice carries its own label, if it has
-- one, and the ordinals of the detected speakers its segments came from (null
-- for Unknown), since a linked speaker's own ordinal names no voice Deepgram
-- heard. Linked speakers without segments move too but show nowhere, so they
-- are not listed. survivor_transcript_ids lets the preview mark transcripts
-- where the two will show as one.
CREATE FUNCTION public.merge_people_preview(p_survivor_id uuid, p_person_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM public.check_merge_request(v_user, p_survivor_id, p_person_ids);

  WITH voices AS (
    SELECT sp.person_id, sp.transcript_id, sp.id AS speaker_id, sp.custom_label,
      count(*)::integer AS segment_count,
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
          'segment_count', v.segment_count, 'detected_ordinals', to_jsonb(v.detected_ordinals))
        ORDER BY v.first_start_ms, v.speaker_id) AS voices
    FROM voices AS v
    GROUP BY v.person_id, v.transcript_id
  )
  SELECT jsonb_build_object(
    'survivor_transcript_ids', COALESCE((
      SELECT jsonb_agg(a.transcript_id ORDER BY a.transcript_id)
      FROM public.person_appearances AS a
      WHERE a.person_id = p_survivor_id
    ), '[]'::jsonb),
    'people', (
      SELECT jsonb_agg(jsonb_build_object(
          'person_id', m.id,
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
    ))
  INTO v_result;

  RETURN v_result;
END;
$$;

-- -------------------------------------------------------------------------
-- 2. Writes. Each checks the caller owns what it touches and refuses a write
--    whose expectation no longer holds.
-- -------------------------------------------------------------------------

-- Creates a person from the directory, with the least-used palette colour.
-- Duplicate names are allowed (spec §4).
CREATE FUNCTION public.create_person(p_name text)
RETURNS public.people LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_person_id uuid;
  v_person public.people;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  v_person_id := public.editor_create_person(v_user, p_name);
  SELECT * INTO v_person FROM public.people WHERE id = v_person_id;
  RETURN v_person;
END;
$$;

-- Sets, changes or clears a person's organisation: an existing one by id, or a
-- new name, which reuses an organisation already called that (ignoring case)
-- and otherwise creates it. Both null clears it.
CREATE FUNCTION public.set_person_organisation(
  p_person_id uuid,
  p_expected_organisation_id uuid,
  p_organisation_id uuid DEFAULT NULL,
  p_new_organisation_name text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;

CREATE FUNCTION public.set_person_color(p_person_id uuid, p_expected_color text, p_color text)
RETURNS public.people LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;

-- Hiding only keeps a person out of the picker's suggestions and the list's
-- default view; nothing else changes (spec §4).
CREATE FUNCTION public.set_person_hidden(p_person_id uuid, p_hidden boolean)
RETURNS public.people LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_person public.people;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF p_hidden IS NULL THEN RAISE EXCEPTION 'hidden must be true or false' USING ERRCODE = 'SP003'; END IF;
  UPDATE public.people SET hidden = p_hidden
  WHERE id = p_person_id AND user_id = v_user RETURNING * INTO v_person;
  IF NOT FOUND THEN RAISE EXCEPTION 'person not found' USING ERRCODE = 'SP001'; END IF;
  RETURN v_person;
END;
$$;

-- A person can be deleted only once no transcript shows them (spec §4, decision
-- 18). Linked speakers without segments are unlinked by the foreign key.
CREATE FUNCTION public.delete_person(p_person_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.people WHERE id = p_person_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'person not found' USING ERRCODE = 'SP001'; END IF;
  IF EXISTS (SELECT 1 FROM public.person_appearances WHERE person_id = p_person_id) THEN
    RAISE EXCEPTION 'person still appears in a transcript' USING ERRCODE = 'SP002';
  END IF;
  DELETE FROM public.people WHERE id = p_person_id;
END;
$$;

-- Remove from this transcript (spec §4): every segment showing the person in
-- the transcript goes back to what Deepgram gave it, its detected speaker or
-- Unknown. Returns the changes it made, so the caller can undo them through
-- reassign_segments with each expectation and target swapped.
CREATE FUNCTION public.remove_person_from_transcript(p_person_id uuid, p_transcript_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_changes jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.transcripts WHERE id = p_transcript_id AND user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'transcript not found' USING ERRCODE = 'SP001'; END IF;
  -- Merge and delete lock the person FOR UPDATE, so this waits for either to
  -- finish and then finds the person gone. Without it, a merge committing
  -- between the read and the move below would pass the segment guard, since a
  -- merge relinks speakers and leaves segments where they are.
  PERFORM 1 FROM public.people WHERE id = p_person_id AND user_id = v_user FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'person not found' USING ERRCODE = 'SP001'; END IF;

  SELECT jsonb_agg(jsonb_build_object(
      'segment_id', sg.id, 'expected_speaker_id', sg.speaker_id, 'speaker_id', home.id)
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
$$;

-- Merge people (spec §4, decision 19): every link to the given people moves to
-- the survivor, which keeps its name, colour and organisation, and the merged
-- people are deleted, all in one transaction. A survivor without an
-- organisation takes the first one in the order the people were given.
CREATE FUNCTION public.merge_people(p_survivor_id uuid, p_person_ids uuid[])
RETURNS public.people LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_survivor public.people;
  v_organisation_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;

  -- Lock in id order so concurrent merges cannot deadlock, then check.
  PERFORM 1 FROM public.people
  WHERE user_id = v_user AND (id = p_survivor_id OR id = ANY (p_person_ids))
  ORDER BY id FOR UPDATE;
  PERFORM public.check_merge_request(v_user, p_survivor_id, p_person_ids);

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
$$;

-- A name another of the caller's organisations already has (ignoring case)
-- is refused by organisations_user_name_unique (23505).
CREATE FUNCTION public.rename_organisation(p_organisation_id uuid, p_expected_name text, p_name text)
RETURNS public.organisations LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;

-- Deleting an organisation clears it from its people, through the foreign key,
-- and never deletes a person (spec §4).
CREATE FUNCTION public.delete_organisation(p_organisation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.organisations WHERE id = p_organisation_id AND user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'organisation not found' USING ERRCODE = 'SP001'; END IF;
END;
$$;

-- -------------------------------------------------------------------------
-- 3. project_speaker_summaries, counted by person (spec §8). Scope, pruning
--    and the preview clamp are as before; what changes is what is counted
--    and shown.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_speaker_summaries(
  p_project_ids uuid[],
  p_include_descendants boolean,
  p_preview_limit integer DEFAULT 4
)
RETURNS TABLE (
  project_id uuid,
  speaker_count integer,
  preview jsonb
)
STABLE
SECURITY INVOKER
SET search_path = public
LANGUAGE sql
AS $$
  WITH RECURSIVE
  requested AS (
    SELECT DISTINCT r.id
    FROM unnest(COALESCE(p_project_ids, '{}'::uuid[])) AS r(id)
    WHERE r.id IS NOT NULL
  ),
  emitted AS (
    SELECT p.id
    FROM public.projects AS p
    JOIN requested AS q ON q.id = p.id
    WHERE p.deleting_at IS NULL
  ),
  branch AS (
    SELECT e.id AS root_id, e.id AS scope_project_id
    FROM emitted AS e
    UNION ALL
    SELECT b.root_id, c.id
    FROM branch AS b
    JOIN public.projects AS c ON c.parent_id = b.scope_project_id
    WHERE c.deleting_at IS NULL
      AND COALESCE(p_include_descendants, false)
  ) CYCLE scope_project_id SET is_cycle USING path,
  -- Unique (root_id, scope_project_id), and a transcript has one project, so
  -- each (root_id, transcript_id) below appears once.
  scope AS (
    SELECT DISTINCT b.root_id, b.scope_project_id
    FROM branch AS b
    WHERE NOT b.is_cycle
  ),
  scope_transcripts AS (
    SELECT s.root_id, t.id AS transcript_id, t.title, t.created_at
    FROM scope AS s
    JOIN public.transcripts AS t ON t.project_id = s.scope_project_id
  ),
  -- Every transcript speaker a segment references, at its first segment in
  -- transcript order (start_ms, then id, as the editor sorts segments). That
  -- belongs to the speaker, not to a requested root, so it carries no root_id:
  -- the IN () reads a transcript reachable from two roots once, and the join
  -- to scope_transcripts below gives it to each of them.
  used_speakers AS (
    SELECT DISTINCT ON (sg.speaker_id)
      sp.id, sp.transcript_id, sp.ordinal, sp.custom_label, sp.person_id,
      sg.start_ms AS first_start_ms, sg.id AS first_segment_id
    FROM public.segments AS sg
    JOIN public.speakers AS sp ON sp.transcript_id = sg.transcript_id AND sp.id = sg.speaker_id
    WHERE sg.transcript_id IN (SELECT st.transcript_id FROM scope_transcripts AS st)
    ORDER BY sg.speaker_id, sg.start_ms, sg.id
  ),
  -- A transcript's identities with segments, in order of first appearance:
  -- what the client's label resolver needs to name a voice as the editor does.
  transcript_peers AS (
    SELECT us.transcript_id,
      jsonb_agg(jsonb_build_object(
          'id',               us.id,
          'ordinal',          us.ordinal,
          'customLabel',      us.custom_label,
          'personId',         us.person_id,
          'personName',       pe.name,
          'organisationName', og.name
        ) ORDER BY us.first_start_ms, us.first_segment_id) AS peers
    FROM used_speakers AS us
    LEFT JOIN public.people AS pe ON pe.id = us.person_id
    LEFT JOIN public.organisations AS og ON og.id = pe.organisation_id
    GROUP BY us.transcript_id
  ),
  -- One row per root and identity. A linked person counts once, however many
  -- transcripts and voices carry them, and was last seen in the newest of those
  -- transcripts; every unlinked voice counts on its own. Hidden people count.
  identities AS (
    SELECT st.root_id, 0 AS rank_group, us.person_id AS id,
      NULL::uuid AS transcript_id, NULL::text AS transcript_title,
      max(st.created_at) AS seen_at,
      NULL::integer AS first_start_ms, NULL::uuid AS first_segment_id
    FROM scope_transcripts AS st
    JOIN used_speakers AS us ON us.transcript_id = st.transcript_id
    WHERE us.person_id IS NOT NULL
    GROUP BY st.root_id, us.person_id
    UNION ALL
    SELECT st.root_id, 1, us.id,
      st.transcript_id, st.title,
      st.created_at,
      us.first_start_ms, us.first_segment_id
    FROM scope_transcripts AS st
    JOIN used_speakers AS us ON us.transcript_id = st.transcript_id
    WHERE us.person_id IS NULL
  ),
  -- People first, by most recent appearance; then voices, newest transcript
  -- first and in order of first appearance within it.
  ordered AS (
    SELECT
      i.root_id, i.rank_group, i.id, i.transcript_id, i.transcript_title,
      pe.name AS person_name, pe.preferred_color AS person_color, og.name AS organisation_name,
      row_number() OVER (
        PARTITION BY i.root_id
        ORDER BY i.rank_group, i.seen_at DESC, pe.name, i.transcript_id,
          i.first_start_ms, i.first_segment_id, i.id
      ) AS rn
    FROM identities AS i
    LEFT JOIN public.people AS pe ON i.rank_group = 0 AND pe.id = i.id
    LEFT JOIN public.organisations AS og ON og.id = pe.organisation_id
  ),
  aggregated AS (
    SELECT
      o.root_id,
      count(*)::integer AS speaker_count,
      -- ORDER BY belongs inside the aggregate; an ordering in an upstream CTE is
      -- not binding on jsonb_agg. COALESCE because jsonb_agg returns NULL for an
      -- empty group, which a preview limit of 0 produces.
      COALESCE(
        jsonb_agg(
          CASE WHEN o.rank_group = 0 THEN jsonb_build_object(
            'kind',             'person',
            'id',               o.id,
            'name',             o.person_name,
            'color',            o.person_color,
            'organisationName', o.organisation_name
          ) ELSE jsonb_build_object(
            'kind',             'voice',
            'id',               o.id,
            'transcriptId',     o.transcript_id,
            'transcriptTitle',  o.transcript_title,
            'peers',            tp.peers
          ) END
          ORDER BY o.rn
        ) FILTER (WHERE o.rn <= LEAST(GREATEST(COALESCE(p_preview_limit, 4), 0), 4)),
        '[]'::jsonb
      ) AS preview
    FROM ordered AS o
    LEFT JOIN transcript_peers AS tp ON tp.transcript_id = o.transcript_id
    GROUP BY o.root_id
  )
  -- Positional output: RETURNS TABLE makes project_id / speaker_count / preview
  -- visible as parameters inside this body, so every column reference above is
  -- qualified and none are aliased here.
  SELECT
    e.id,
    COALESCE(a.speaker_count, 0),
    COALESCE(a.preview, '[]'::jsonb)
  FROM emitted AS e
  LEFT JOIN aggregated AS a ON a.root_id = e.id;
$$;

COMMENT ON FUNCTION public.project_speaker_summaries(uuid[], boolean, integer) IS
'Per-project speaker avatar summary over a project''s direct transcripts (or its
whole active branch): each linked person once and each unlinked voice with
segments, people first by most recent appearance, plus a bounded preview.
SECURITY INVOKER -- RLS performs the ownership filtering.';

-- -------------------------------------------------------------------------
-- 4. Grants. Only the directory functions are callable, and only by signed-in
--    users; service_role gets nothing because auth.uid() is NULL for it.
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.check_merge_request(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.people_directory() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.list_person_appearances(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.merge_people_preview(uuid, uuid[]) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.create_person(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.set_person_organisation(uuid, uuid, uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.set_person_color(uuid, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.set_person_hidden(uuid, boolean) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.delete_person(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.remove_person_from_transcript(uuid, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.merge_people(uuid, uuid[]) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.rename_organisation(uuid, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.delete_organisation(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.project_speaker_summaries(uuid[], boolean, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.people_directory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_person_appearances(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_people_preview(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_person(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_person_organisation(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_person_color(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_person_hidden(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_person(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_person_from_transcript(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_people(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_organisation(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_organisation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_speaker_summaries(uuid[], boolean, integer) TO authenticated;
