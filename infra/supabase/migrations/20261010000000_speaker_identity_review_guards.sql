-- Guard speaker edits until completion, and bind an irreversible merge to the
-- exact preview the user confirmed. Earlier migrations are already deployed.
-- No existing content is rewritten by this migration.

-- The API checks status before preparing a job. Check again at insertion under
-- the transcript lock: completion may have happened while it prepared the media
-- URL, and direct Data API inserts must respect the same completed boundary.
CREATE FUNCTION public.refuse_completed_transcript_restart()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.type = 'transcription' AND NEW.status IN ('queued', 'processing') THEN
    SELECT status INTO v_status FROM public.transcripts
    WHERE id = NEW.transcript_id FOR NO KEY UPDATE;
    IF v_status = 'completed' THEN
      RAISE EXCEPTION 'completed transcripts cannot be restarted' USING ERRCODE = 'SP004';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER refuse_completed_transcript_restart
  BEFORE INSERT ON public.jobs FOR EACH ROW
  EXECUTE FUNCTION public.refuse_completed_transcript_restart();
REVOKE ALL ON FUNCTION public.refuse_completed_transcript_restart() FROM PUBLIC, anon, authenticated, service_role;

-- Speaker writes for one account take this lock before transcript/person/segment
-- row locks. Merge takes it too, including corrections to an existing linked
-- voice which would otherwise never lock its person. Different accounts remain
-- independent. The content-save service uses the same lock for retry safety.
CREATE FUNCTION public.lock_speaker_identity_writes(p_user_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('speaker-identity:' || p_user_id::text, 0))
$$;

CREATE FUNCTION public.require_completed_transcript(p_transcript_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM public.lock_speaker_identity_writes(p_user_id);
  SELECT status INTO v_status FROM public.transcripts
  WHERE id = p_transcript_id AND user_id = p_user_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transcript not found' USING ERRCODE = 'SP001'; END IF;
  IF v_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'speaker changes require a completed transcript' USING ERRCODE = 'SP004';
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.create_transcript_speaker(
  p_transcript_id uuid,
  p_user_id uuid,
  p_custom_label text
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

  INSERT INTO public.speakers (transcript_id, user_id, ordinal, custom_label)
  SELECT p_transcript_id, p_user_id, COALESCE(max(sp.ordinal), -1) + 1, p_custom_label
  FROM public.speakers AS sp
  WHERE sp.transcript_id = p_transcript_id
  RETURNING * INTO v_speaker;

  RETURN v_speaker;
END;
$$;

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

  -- Both keys must be present, even when null: a missing expectation must not
  -- silently read as "expected unassigned".
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_changes) AS e
    WHERE jsonb_typeof(e) <> 'object'
       OR NOT (e ? 'segment_id' AND e ? 'expected_speaker_id' AND e ? 'speaker_id')
       OR jsonb_typeof(e -> 'segment_id') <> 'string'
  ) THEN
    RAISE EXCEPTION 'each change needs segment_id, expected_speaker_id and speaker_id'
      USING ERRCODE = 'SP003';
  END IF;

  BEGIN
    SELECT count(*), count(DISTINCT c.segment_id)
    INTO v_change_count, v_distinct_count
    FROM jsonb_to_recordset(p_changes)
      AS c(segment_id uuid, expected_speaker_id uuid, speaker_id uuid);
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'changes contain an invalid id' USING ERRCODE = 'SP003';
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

  RETURN QUERY
  UPDATE public.segments AS sg
  SET speaker_id = c.speaker_id
  FROM jsonb_to_recordset(p_changes) AS c(segment_id uuid, speaker_id uuid)
  WHERE sg.id = c.segment_id
    AND sg.transcript_id = p_transcript_id
  RETURNING sg.id, sg.speaker_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_segments_to_person(
  p_transcript_id uuid, p_changes jsonb, p_person_id uuid DEFAULT NULL,
  p_new_person_name text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_person_id uuid := p_person_id;
  v_speaker public.speakers;
  v_assignments jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF (p_person_id IS NULL) = (p_new_person_name IS NULL) THEN
    RAISE EXCEPTION 'choose an existing or new person' USING ERRCODE = 'SP003';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'changes must be a non-empty array' USING ERRCODE = 'SP003';
  END IF;
  PERFORM public.require_completed_transcript(p_transcript_id, v_user);
  IF p_person_id IS NULL THEN
    v_person_id := public.editor_create_person(v_user, p_new_person_name);
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

CREATE OR REPLACE FUNCTION public.undo_created_person_action(
  p_transcript_id uuid, p_person_id uuid, p_person_updated_at timestamptz,
  p_speaker_id uuid, p_changes jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_speaker public.speakers;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM public.require_completed_transcript(p_transcript_id, v_user);
  PERFORM 1 FROM public.people WHERE id = p_person_id AND user_id = v_user
    AND updated_at = p_person_updated_at FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'person changed since it was created' USING ERRCODE = 'SP002'; END IF;
  SELECT * INTO v_speaker FROM public.speakers WHERE id = p_speaker_id
    AND transcript_id = p_transcript_id AND user_id = v_user AND person_id = p_person_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'speaker link changed since it was read' USING ERRCODE = 'SP002'; END IF;
  IF EXISTS (SELECT 1 FROM public.speakers WHERE person_id = p_person_id AND id <> p_speaker_id) THEN
    RAISE EXCEPTION 'person has another link' USING ERRCODE = 'SP002';
  END IF;
  IF jsonb_typeof(p_changes) = 'array' AND EXISTS (
    SELECT 1 FROM public.segments AS sg WHERE sg.speaker_id = p_speaker_id
    AND sg.id NOT IN (SELECT c.segment_id FROM jsonb_to_recordset(p_changes) AS c(segment_id uuid))
  ) THEN RAISE EXCEPTION 'new speaker has other segments' USING ERRCODE = 'SP002'; END IF;
  PERFORM 1 FROM public.apply_segment_speaker_changes(p_transcript_id, p_changes);
  DELETE FROM public.people WHERE id = p_person_id;
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
  IF v_speaker.person_id IS NOT NULL OR v_speaker.custom_label IS DISTINCT FROM p_expected_custom_label THEN
    RAISE EXCEPTION 'speaker changed since it was read' USING ERRCODE = 'SP002';
  END IF;
  UPDATE public.speakers SET custom_label = v_label WHERE id = p_speaker_id RETURNING * INTO v_speaker;
  RETURN v_speaker;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.save_transcript_segments(
    p_transcript_id UUID,
    p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_num INT;
    v_speaker_id UUID;
    v_ordinal INT;
    v_segment_count INT := 0;
    v_word_count INT := 0;
    v_max_end_ms INT := 0;
BEGIN
    SELECT user_id INTO v_user_id FROM public.transcripts WHERE id = p_transcript_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'transcript not found' USING ERRCODE = 'SP001'; END IF;
    PERFORM public.lock_speaker_identity_writes(v_user_id);

    -- The row lock serialises ordinal allocation with create_transcript_speaker.
    SELECT t.user_id INTO v_user_id
    FROM public.transcripts AS t
    WHERE t.id = p_transcript_id
    FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'transcript not found' USING ERRCODE = 'SP001';
    END IF;

    -- 1. Delete existing transcript content for this transcript.
    --    words.segment_id FK has ON DELETE CASCADE, so word rows go with them.
    DELETE FROM public.segments WHERE transcript_id = p_transcript_id;

    -- 2. Resolve each diarization index, from the speaker list or from any
    --    segment, to a transcript speaker. A re-run reuses the speaker already
    --    holding that index. A new speaker takes ordinal = index + 1, unless an
    --    earlier speaker (a legacy row or one made by a correction) already
    --    holds that ordinal; then the next free one.
    DROP TABLE IF EXISTS tmp_speaker_mapping;
    CREATE TEMP TABLE tmp_speaker_mapping (
        speaker_num INT PRIMARY KEY,
        speaker_id UUID NOT NULL
    ) ON COMMIT DROP;

    FOR v_num IN
        SELECT n.num
        FROM (
            SELECT x.num
            FROM jsonb_to_recordset(COALESCE(p_payload->'speakers', '[]'::jsonb)) AS x(num INT)
            UNION
            SELECT s.speaker_num
            FROM jsonb_to_recordset(COALESCE(p_payload->'segments', '[]'::jsonb)) AS s(speaker_num INT)
        ) AS n
        WHERE n.num IS NOT NULL
        ORDER BY n.num
    LOOP
        SELECT sp.id INTO v_speaker_id
        FROM public.speakers AS sp
        WHERE sp.transcript_id = p_transcript_id
          AND sp.diarization_index = v_num;

        IF NOT FOUND THEN
            IF EXISTS (
                SELECT 1 FROM public.speakers AS sp
                WHERE sp.transcript_id = p_transcript_id AND sp.ordinal = v_num + 1
            ) THEN
                SELECT COALESCE(max(sp.ordinal), -1) + 1 INTO v_ordinal
                FROM public.speakers AS sp
                WHERE sp.transcript_id = p_transcript_id;
            ELSE
                v_ordinal := v_num + 1;
            END IF;

            INSERT INTO public.speakers (transcript_id, user_id, ordinal, diarization_index)
            VALUES (p_transcript_id, v_user_id, v_ordinal, v_num)
            RETURNING id INTO v_speaker_id;
        END IF;

        INSERT INTO tmp_speaker_mapping (speaker_num, speaker_id)
        VALUES (v_num, v_speaker_id);
    END LOOP;

    -- 3. Insert segments. speaker_num is the join key; LEFT JOIN keeps a
    --    segment with no speaker_num, unassigned.
    WITH inserted_segments AS (
        INSERT INTO public.segments (
            id,
            transcript_id,
            speaker_id,
            start_ms,
            end_ms,
            text,
            is_filler,
            algo_version,
            diarization_index
        )
        SELECT
            s.id,
            p_transcript_id,
            m.speaker_id,
            s.start_ms,
            s.end_ms,
            s.text,
            s.is_filler,
            s.algo_version,
            s.speaker_num
        FROM jsonb_to_recordset(COALESCE(p_payload->'segments', '[]'::jsonb))
            AS s(
                id UUID,
                speaker_num INT,
                start_ms INT,
                end_ms INT,
                text TEXT,
                is_filler BOOLEAN,
                algo_version TEXT
            )
        LEFT JOIN tmp_speaker_mapping AS m ON m.speaker_num = s.speaker_num
        RETURNING id, end_ms
    )
    SELECT COUNT(*)::INT, COALESCE(MAX(end_ms), 0)::INT
    INTO v_segment_count, v_max_end_ms
    FROM inserted_segments;

    -- 4. Insert words for all segments in a single statement.
    WITH inserted_words AS (
        INSERT INTO public.words (
            segment_id,
            start_ms,
            end_ms,
            text,
            confidence,
            order_index,
            speaker,
            speaker_confidence,
            punctuated_text,
            paragraph_index,
            sentence_end
        )
        SELECT
            (seg->>'id')::UUID,
            w.start_ms,
            w.end_ms,
            w.text,
            w.confidence,
            w.order_index,
            w.speaker,
            w.speaker_confidence,
            w.punctuated_text,
            w.paragraph_index,
            w.sentence_end
        FROM jsonb_array_elements(COALESCE(p_payload->'segments', '[]'::jsonb)) AS seg
        CROSS JOIN LATERAL jsonb_to_recordset(COALESCE(seg->'words', '[]'::jsonb))
            AS w(
                start_ms INT,
                end_ms INT,
                text TEXT,
                confidence REAL,
                order_index INT,
                speaker INT,
                speaker_confidence REAL,
                punctuated_text TEXT,
                paragraph_index INT,
                sentence_end BOOLEAN
            )
        RETURNING 1
    )
    SELECT COUNT(*)::INT INTO v_word_count FROM inserted_words;

    RETURN jsonb_build_object(
        'segment_count', v_segment_count,
        'word_count', v_word_count,
        'duration_ms', v_max_end_ms
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_people_preview(p_survivor_id uuid, p_person_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;

DROP FUNCTION public.merge_people(uuid, uuid[]);

CREATE FUNCTION public.merge_people(p_survivor_id uuid, p_person_ids uuid[], p_expected_preview jsonb)
RETURNS public.people LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;

REVOKE ALL ON FUNCTION public.lock_speaker_identity_writes(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.require_completed_transcript(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.merge_people(uuid, uuid[], jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.merge_people(uuid, uuid[], jsonb) TO authenticated;
-- CREATE OR REPLACE preserves existing least-privilege grants on the other RPCs.
