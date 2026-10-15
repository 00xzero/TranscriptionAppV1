-- Editor undo/redo: guarded writes that recognise their own earlier success.
--
-- The editor keeps one undo/redo history and writes every step through the
-- functions below. When a write's answer is lost, the editor sends the same
-- request again until the database answers. Each write is therefore phrased as
-- "make it so": finding exactly the state the request intended, it answers as
-- if it had just made it; finding anything else, it refuses (SP002). The state
-- cannot say which request produced it, so a change made elsewhere between a
-- committed write and its resend is refused as changed, and the editor reloads.
--
-- Errors, as the speaker functions:
--   SP001  not found (or not the caller's)
--   SP002  changed since: an expectation no longer holds
--   SP003  invalid input, or a chosen id already in use by another row
--   SP004  the transcript is not completed (require_completed_transcript)

-- ---------------------------------------------------------------------------
-- split_segment and rejoin_segments also expect the text and speaker of the
-- segments they reshape, so neither writes over a change made elsewhere. A
-- replay counts as done only while the halves (or the joined segment) still
-- hold exactly what the split (or rejoin) wrote.
-- ---------------------------------------------------------------------------
DROP FUNCTION public.split_segment(uuid, integer, uuid, text, text, uuid);
DROP FUNCTION public.rejoin_segments(uuid, integer, uuid, integer, uuid, text);

CREATE FUNCTION public.split_segment(
  p_segment_id uuid,
  p_expected_revision integer,
  p_split_word_id uuid,
  p_first_text text,
  p_second_text text,
  p_new_segment_id uuid,
  p_expected_text text,
  p_expected_speaker_id uuid
)
RETURNS SETOF public.segments
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;

CREATE FUNCTION public.rejoin_segments(
  p_segment_id uuid,
  p_expected_revision integer,
  p_next_segment_id uuid,
  p_expected_next_revision integer,
  p_next_first_word_id uuid,
  p_text text,
  p_expected_text text,
  p_expected_next_text text,
  p_expected_speaker_id uuid,
  p_expected_next_speaker_id uuid
)
RETURNS public.segments
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;

REVOKE ALL ON FUNCTION public.split_segment(uuid, integer, uuid, text, text, uuid, text, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.rejoin_segments(uuid, integer, uuid, integer, uuid, text, text, text, uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.split_segment(uuid, integer, uuid, text, text, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rejoin_segments(uuid, integer, uuid, integer, uuid, text, text, text, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Segment text, all or nothing: each edit names the revision and the text it
-- expects. A segment already holding the new text is a resend and passes. Runs
-- as the caller, so RLS and the UPDATE (text, is_edited) column grant apply.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.set_segment_texts_guarded(p_edits jsonb)
RETURNS SETOF public.segments LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_edit jsonb;
  v_row public.segments;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
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
      AND EXISTS (SELECT 1 FROM public.transcripts t WHERE t.id = sg.transcript_id AND t.user_id = auth.uid())
    RETURNING sg.* INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'segment text changed since it was read' USING ERRCODE = 'SP002'; END IF;
    RETURN NEXT v_row;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.set_segment_texts_guarded(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_segment_texts_guarded(jsonb) TO authenticated;

-- The title, expecting the one it replaces; already the new title is a resend.
CREATE FUNCTION public.update_transcript_title_guarded(p_transcript_id uuid, p_expected_title text, p_title text)
RETURNS public.transcripts LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_row public.transcripts;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  UPDATE public.transcripts SET title = p_title
  WHERE id = p_transcript_id AND user_id = auth.uid()
    AND (title IS NOT DISTINCT FROM p_expected_title OR title IS NOT DISTINCT FROM p_title)
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'title changed since it was read' USING ERRCODE = 'SP002'; END IF;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_transcript_title_guarded(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_transcript_title_guarded(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Speaker changes: as in the segment split migration, except that a segment
-- already on its target speaker passes, so a resent change is done, not
-- refused. The revision must still match; speaker writes leave it alone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_segment_speaker_changes(
  p_transcript_id uuid,
  p_changes jsonb
)
RETURNS TABLE (segment_id uuid, speaker_id uuid)
SECURITY INVOKER
SET search_path = public
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_change_count integer;
  v_distinct_count integer;
  v_locked_count integer;
BEGIN
  PERFORM public.require_completed_transcript(p_transcript_id, auth.uid());

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
$$;

-- ---------------------------------------------------------------------------
-- Rows the editor creates take ids it chose, so a resend can find what the
-- first attempt made. Both helpers keep their other callers' behaviour.
-- ---------------------------------------------------------------------------
DROP FUNCTION public.create_transcript_speaker(uuid, uuid, text);
CREATE FUNCTION public.create_transcript_speaker(
  p_transcript_id uuid,
  p_user_id uuid,
  p_custom_label text,
  p_speaker_id uuid DEFAULT NULL
)
RETURNS public.speakers
SECURITY INVOKER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_speaker public.speakers;
BEGIN
  PERFORM public.require_completed_transcript(p_transcript_id, p_user_id);

  INSERT INTO public.speakers (id, transcript_id, user_id, ordinal, custom_label)
  SELECT COALESCE(p_speaker_id, gen_random_uuid()), p_transcript_id, p_user_id,
    COALESCE(max(sp.ordinal), -1) + 1, p_custom_label
  FROM public.speakers AS sp
  WHERE sp.transcript_id = p_transcript_id
  RETURNING * INTO v_speaker;

  RETURN v_speaker;
END;
$$;
REVOKE ALL ON FUNCTION public.create_transcript_speaker(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.editor_create_person(uuid, text);
CREATE FUNCTION public.editor_create_person(p_user_id uuid, p_name text, p_person_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_name text := regexp_replace(p_name, '^\s+|\s+$', '', 'g');
  v_color text;
  v_person_id uuid;
BEGIN
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid person name' USING ERRCODE = 'SP003';
  END IF;

  SELECT palette.color INTO v_color
  FROM unnest(public.speaker_palette()) WITH ORDINALITY AS palette(color, priority)
  LEFT JOIN public.people AS p ON p.user_id = p_user_id AND p.preferred_color = palette.color
  GROUP BY palette.color, palette.priority
  ORDER BY count(p.id), palette.priority
  LIMIT 1;

  INSERT INTO public.people (id, user_id, name, preferred_color)
  VALUES (COALESCE(p_person_id, gen_random_uuid()), p_user_id, v_name, v_color)
  RETURNING id INTO v_person_id;
  RETURN v_person_id;
END;
$$;
REVOKE ALL ON FUNCTION public.editor_create_person(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Naming a detected speaker: the new local speaker takes p_speaker_id. Finding
-- it already made (this caller's, this transcript, same label, unlinked) is a
-- resend; the segments then pass as already moved.
DROP FUNCTION public.create_local_speaker(uuid, text, jsonb);
CREATE FUNCTION public.create_local_speaker(
  p_transcript_id uuid, p_custom_label text, p_changes jsonb, p_speaker_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;
REVOKE ALL ON FUNCTION public.create_local_speaker(uuid, text, jsonb, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_local_speaker(uuid, text, jsonb, uuid) TO authenticated;

-- Correcting to a new person: it takes p_new_person_id. Finding that person
-- already made counts as a resend only while it is exactly what this call
-- made: untouched since (the people trigger moves updated_at on any edit), the
-- requested name, linked to a speaker here that holds every segment. Anything
-- else is a change made elsewhere, never adopted.
DROP FUNCTION public.correct_segments_to_person(uuid, jsonb, uuid, text);
CREATE FUNCTION public.correct_segments_to_person(
  p_transcript_id uuid, p_changes jsonb, p_person_id uuid DEFAULT NULL,
  p_new_person_name text DEFAULT NULL, p_new_person_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;
REVOKE ALL ON FUNCTION public.correct_segments_to_person(uuid, jsonb, uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.correct_segments_to_person(uuid, jsonb, uuid, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Renames: as before, except that already holding the new name is a resend.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rename_person_guarded(
  p_person_id uuid, p_expected_name text, p_name text
)
RETURNS public.people LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;

CREATE OR REPLACE FUNCTION public.set_speaker_custom_label(
  p_speaker_id uuid, p_expected_custom_label text, p_custom_label text
)
RETURNS public.speakers LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;

-- ---------------------------------------------------------------------------
-- Undo of "new person": deletes the person only while it still has the name
-- and colour it was created with, no organisation, and is not hidden. When the
-- undo runs, every later rename has already been undone, so these hold unless
-- something changed elsewhere. A timestamp would not do: a resend recognised
-- as done hands back whatever row is current.
-- ---------------------------------------------------------------------------
DROP FUNCTION public.undo_created_person_action(uuid, uuid, timestamptz, uuid, jsonb);
CREATE FUNCTION public.undo_created_person_action(
  p_transcript_id uuid, p_person_id uuid, p_expected_name text, p_expected_color text,
  p_speaker_id uuid, p_changes jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;
REVOKE ALL ON FUNCTION public.undo_created_person_action(uuid, uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.undo_created_person_action(uuid, uuid, text, text, uuid, jsonb) TO authenticated;

-- Redo of "new person": the person comes back under the same id, name and
-- colour, and relinks the speaker its undo left bare and silent. Finding the
-- person already back counts as a resend only while it is exactly what this
-- call made: untouched since, same name and colour, linked to this speaker,
-- which holds every segment.
CREATE FUNCTION public.restore_created_person(p_transcript_id uuid, p_person_id uuid, p_name text,
  p_preferred_color text, p_speaker_id uuid, p_changes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;
REVOKE ALL ON FUNCTION public.restore_created_person(uuid, uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.restore_created_person(uuid, uuid, text, text, uuid, jsonb) TO authenticated;
