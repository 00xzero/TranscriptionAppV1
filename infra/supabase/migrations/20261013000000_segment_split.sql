-- Segment split.
--
-- Splitting is the first change to a segment's shape after transcription: the
-- editor can cut a segment in two, and join the halves back (Undo). Both run
-- through the guarded functions below, the only way a signed-in user creates
-- or removes segment rows. Words move between segments with the text they
-- belong to; a word's text and timing never change.
--
-- revision counts a segment's shape changes. Split and rejoin bump it on the
-- segment they reshape, and every write names the revision it was made
-- against: these functions and the speaker changes refuse a mismatch, and the
-- editor's text saves filter on it, so text written against an old shape can
-- never land on the new one and duplicate what moved. Signed-in users may
-- filter on revision but never set it: their column grant stays
-- UPDATE (text, is_edited).
--
-- A retry after a lost response replays the same call. Each function
-- recognises its own completed write, as long as nothing has reshaped the
-- segments since, and returns it without changing anything.
--
-- Errors, as the speaker functions:
--   SP001  segment not found (or not the caller's)
--   SP002  changed since: a revision or neighbour expectation no longer holds
--   SP003  invalid input
--   SP004  the transcript is not completed (require_completed_transcript)

ALTER TABLE public.segments ADD COLUMN revision integer NOT NULL DEFAULT 0;

-- Display order within a transcript, (start_ms, id). The editor pages through
-- segments in it, and split and rejoin check that nothing sits between two
-- neighbours in it, which would otherwise read the whole transcript.
CREATE INDEX idx_segments_transcript_order ON public.segments (transcript_id, start_ms, id);

-- ---------------------------------------------------------------------------
-- split_segment: the words from p_split_word_id onward, and p_second_text,
-- become a new segment p_new_segment_id with the same speaker. Returns both
-- rows in display order.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.split_segment(
  p_segment_id uuid,
  p_expected_revision integer,
  p_split_word_id uuid,
  p_first_text text,
  p_second_text text,
  p_new_segment_id uuid
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
  -- split happened; it counts as this call's result only while neither half
  -- has been reshaped since. The lookup stays inside the caller's transcript.
  IF EXISTS (SELECT 1 FROM public.segments WHERE id = p_new_segment_id) THEN
    SELECT * INTO v_new
    FROM public.segments
    WHERE id = p_new_segment_id AND transcript_id = v_transcript_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'new segment id is already in use' USING ERRCODE = 'SP003';
    END IF;
    IF v_new.revision = 0
       AND v_segment.revision = p_expected_revision + 1
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

  IF v_segment.revision <> p_expected_revision THEN
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

-- ---------------------------------------------------------------------------
-- rejoin_segments: the segment directly after p_segment_id joins it, words and
-- all, under p_text and p_segment_id's speaker. Returns the joined row. Undo
-- of a split uses it.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.rejoin_segments(
  p_segment_id uuid,
  p_expected_revision integer,
  p_next_segment_id uuid,
  p_expected_next_revision integer,
  p_next_first_word_id uuid,
  p_text text
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
    -- Replay: the next segment's words are in this one and nothing has
    -- reshaped it since. Only p_segment_id, already scoped to the caller, and
    -- its own words are read.
    IF v_first.revision = p_expected_revision + 1
       AND EXISTS (
         SELECT 1 FROM public.words AS w
         WHERE w.id = p_next_first_word_id AND w.segment_id = p_segment_id
       ) THEN
      RETURN v_first;
    END IF;
    RAISE EXCEPTION 'segment changed since it was read' USING ERRCODE = 'SP002';
  END IF;

  IF v_first.revision <> p_expected_revision OR v_next.revision <> p_expected_next_revision THEN
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

REVOKE ALL ON FUNCTION public.split_segment(uuid, integer, uuid, text, text, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.rejoin_segments(uuid, integer, uuid, integer, uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.split_segment(uuid, integer, uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rejoin_segments(uuid, integer, uuid, integer, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Speaker changes name the revision too. A split keeps the original segment's
-- id and speaker, so a correction chosen while the segment was whole would
-- still hold its expected speaker and change only the first half. Each change
-- is now [{segment_id, expected_speaker_id, expected_revision, speaker_id}];
-- as in the speaker identity guards, all are as before except the new key.
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
    FROM jsonb_to_recordset(p_changes) AS c(segment_id uuid, expected_speaker_id uuid)
    JOIN public.segments AS sg ON sg.id = c.segment_id
    WHERE sg.speaker_id IS DISTINCT FROM c.expected_speaker_id
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

-- As in the speaker identity guards, except that each change it builds, and
-- returns for Undo, carries the segment's revision.
CREATE OR REPLACE FUNCTION public.remove_person_from_transcript(p_person_id uuid, p_transcript_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;
