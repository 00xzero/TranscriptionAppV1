-- Speaker identity overhaul, slice 2: account-owned identities and editor actions.
--
-- Deepgram's speaker detection is kept as a fixed layer under everything the
-- user does (spec §3). Each segment keeps the number Deepgram gave it, and each
-- number has one detected speaker, which never carries a name: naming one
-- moves its segments to a named speaker, so Remove can always send a segment
-- back. Existing speakers and segments are brought into that shape once, below.
--
-- SQLSTATEs follow the foundations migration: SP001 not found (or not the
-- caller's), SP002 changed since it was read, SP003 invalid input.

-- The avatar palette in allocation order. SPEAKER_COLORS in
-- frontend/lib/speakers/palette.ts must match; a Jest test compares the two.
CREATE FUNCTION public.speaker_palette()
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT ARRAY[
    '#4F638C', '#C73E1D', '#CA8A04', '#0D9488', '#7C3AED',
    '#64748B', '#B45309', '#059669', '#DB2777', '#2563EB'
  ]::text[]
$$;

CREATE TABLE public.organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organisations_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT organisations_name_valid CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 50)
);
CREATE UNIQUE INDEX organisations_user_name_unique ON public.organisations (user_id, lower(name));
CREATE TRIGGER update_organisations_updated_at BEFORE UPDATE ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  organisation_id uuid,
  preferred_color text NOT NULL,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT people_name_valid CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 50),
  CONSTRAINT people_preferred_color_valid CHECK (preferred_color = ANY (public.speaker_palette())),
  CONSTRAINT people_organisation_owner_fk FOREIGN KEY (organisation_id, user_id)
    REFERENCES public.organisations (id, user_id) ON DELETE SET NULL (organisation_id)
);
CREATE INDEX people_user_organisation_idx ON public.people (user_id, organisation_id);
CREATE TRIGGER update_people_updated_at BEFORE UPDATE ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.speakers ADD COLUMN person_id uuid;
ALTER TABLE public.speakers ADD CONSTRAINT speakers_person_owner_fk
  FOREIGN KEY (person_id, user_id) REFERENCES public.people (id, user_id)
  ON DELETE SET NULL (person_id);
CREATE INDEX speakers_person_id_idx ON public.speakers (person_id) WHERE person_id IS NOT NULL;

-- Deepgram's speaker number per segment, fixed when the transcript is saved.
-- Existing segments take the number most of their words carry.
ALTER TABLE public.segments ADD COLUMN diarization_index integer
  CONSTRAINT segments_diarization_index_nonnegative CHECK (diarization_index >= 0);

UPDATE public.segments AS sg SET diarization_index = w.speaker
FROM (
  SELECT DISTINCT ON (segment_id) segment_id, speaker
  FROM public.words
  WHERE speaker IS NOT NULL
  GROUP BY segment_id, speaker
  ORDER BY segment_id, count(*) DESC, speaker
) AS w
WHERE w.segment_id = sg.id;

-- One pass over existing data:
--   1. A named detected speaker hands its name and its segments to a new
--      speaker, and keeps only its Deepgram number.
--   2. Each Deepgram number in a transcript gets a detected speaker: the
--      unnamed speaker holding most of that number's segments, else a new one.
--   3. Segments on an unnamed, undetected speaker or on none go back to their
--      detected speaker, so every unnamed voice is one Deepgram heard.
--   4. A detected speaker's ordinal becomes its Deepgram number plus one, so
--      Deepgram's first speaker is `Speaker 1`; other speakers follow in
--      their existing order.
DO $$
DECLARE
  r record;
  v_speaker_id uuid;
BEGIN
  FOR r IN
    SELECT * FROM public.speakers
    WHERE diarization_index IS NOT NULL AND (custom_label IS NOT NULL OR person_id IS NOT NULL)
  LOOP
    INSERT INTO public.speakers (transcript_id, user_id, ordinal, custom_label, person_id)
    SELECT r.transcript_id, r.user_id, max(sp.ordinal) + 1, r.custom_label, r.person_id
    FROM public.speakers AS sp WHERE sp.transcript_id = r.transcript_id
    RETURNING id INTO v_speaker_id;
    UPDATE public.segments SET speaker_id = v_speaker_id WHERE speaker_id = r.id;
    UPDATE public.speakers SET custom_label = NULL, person_id = NULL WHERE id = r.id;
  END LOOP;

  -- The biggest holder claims a number first; a `Speaker N` row wins a tie for N.
  FOR r IN
    SELECT sg.transcript_id, sg.diarization_index AS num, sp.id AS speaker_id
    FROM public.segments AS sg
    JOIN public.speakers AS sp ON sp.id = sg.speaker_id
    WHERE sg.diarization_index IS NOT NULL AND sp.diarization_index IS NULL
      AND sp.custom_label IS NULL AND sp.person_id IS NULL
    GROUP BY sg.transcript_id, sg.diarization_index, sp.id, sp.ordinal
    ORDER BY count(*) DESC, sp.ordinal = sg.diarization_index DESC, sp.id
  LOOP
    UPDATE public.speakers AS sp SET diarization_index = r.num
    WHERE sp.id = r.speaker_id AND sp.diarization_index IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.speakers AS d
        WHERE d.transcript_id = r.transcript_id AND d.diarization_index = r.num);
  END LOOP;

  FOR r IN
    SELECT DISTINCT sg.transcript_id, t.user_id, sg.diarization_index AS num
    FROM public.segments AS sg
    JOIN public.transcripts AS t ON t.id = sg.transcript_id
    WHERE sg.diarization_index IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.speakers AS d
      WHERE d.transcript_id = sg.transcript_id AND d.diarization_index = sg.diarization_index)
  LOOP
    INSERT INTO public.speakers (transcript_id, user_id, ordinal, diarization_index)
    SELECT r.transcript_id, r.user_id, COALESCE(max(sp.ordinal), -1) + 1, r.num
    FROM public.speakers AS sp WHERE sp.transcript_id = r.transcript_id;
  END LOOP;

  UPDATE public.segments AS sg SET speaker_id = d.id
  FROM public.speakers AS d
  WHERE d.transcript_id = sg.transcript_id AND d.diarization_index = sg.diarization_index
    AND sg.speaker_id IS DISTINCT FROM d.id
    AND (sg.speaker_id IS NULL OR EXISTS (
      SELECT 1 FROM public.speakers AS sp WHERE sp.id = sg.speaker_id
        AND sp.diarization_index IS NULL AND sp.custom_label IS NULL AND sp.person_id IS NULL));

  -- Two passes keep (transcript_id, ordinal) unique at every step.
  UPDATE public.speakers SET ordinal = ordinal + 1000000;
  UPDATE public.speakers AS sp SET ordinal = n.ordinal
  FROM (
    SELECT s.id, COALESCE(s.diarization_index + 1,
      COALESCE(max(s.diarization_index) OVER (PARTITION BY s.transcript_id) + 1, 0)
        + row_number() OVER (PARTITION BY s.transcript_id, s.diarization_index IS NULL
                             ORDER BY s.ordinal, s.id)) AS ordinal
    FROM public.speakers AS s
  ) AS n
  WHERE n.id = sp.id;
END $$;

ALTER TABLE public.speakers ADD CONSTRAINT speakers_detected_unnamed
  CHECK (diarization_index IS NULL OR (custom_label IS NULL AND person_id IS NULL));

-- Every numbered segment has a detected speaker to go back to.
ALTER TABLE public.segments ADD CONSTRAINT segments_detected_speaker_fk
  FOREIGN KEY (transcript_id, diarization_index)
  REFERENCES public.speakers (transcript_id, diarization_index);

-- As in the foundations migration, plus each segment's Deepgram number. Every
-- number a segment carries gets a detected speaker, numbered from 1. A re-run
-- puts every segment back on its detected speaker.
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

-- Editor writes go through guarded functions, while the browser may read only
-- its own directory. Slice 3 adds directory-management functions.
REVOKE ALL ON TABLE public.people FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.organisations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.people, public.organisations TO authenticated;
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own people" ON public.people FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can view own organisations" ON public.organisations FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- An appearance is a transcript in which a person's linked speakers say at
-- least one segment. A linked speaker left with no segments, for example after
-- an undone correction, is not an appearance (spec §6). Internal for now; the
-- slice 3 directory builds on the same definition.
CREATE VIEW public.person_appearances WITH (security_invoker = true) AS
SELECT sp.user_id, sp.person_id, sp.transcript_id, count(*)::integer AS segment_count
FROM public.speakers AS sp
JOIN public.segments AS sg ON sg.transcript_id = sp.transcript_id AND sg.speaker_id = sp.id
WHERE sp.person_id IS NOT NULL
GROUP BY sp.user_id, sp.person_id, sp.transcript_id;

-- Internal: callable only by the definer-rights functions below. A new person
-- takes the palette colour least used among the account's people (spec §8);
-- two concurrent creations may pick the same colour, which is harmless. A
-- person's organisation is set on the person page (slice 3), not in the editor.
CREATE FUNCTION public.editor_create_person(p_user_id uuid, p_name text)
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

  INSERT INTO public.people (user_id, name, preferred_color)
  VALUES (p_user_id, v_name, v_color)
  RETURNING id INTO v_person_id;
  RETURN v_person_id;
END;
$$;

-- The picker's directory: every person the caller owns, hidden or not, with
-- their appearances in OTHER transcripts. The editor works out who is in the
-- open transcript from its own speaker state, so these figures do not go stale
-- when it links or unlinks a speaker. One JSON result avoids row-limit truncation.
CREATE FUNCTION public.editor_people_context(p_transcript_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;

CREATE FUNCTION public.rename_person_guarded(
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
  IF v_person.name IS DISTINCT FROM p_expected_name THEN
    RAISE EXCEPTION 'person name changed since it was read' USING ERRCODE = 'SP002';
  END IF;
  UPDATE public.people SET name = v_name WHERE id = p_person_id RETURNING * INTO v_person;
  RETURN v_person;
END;
$$;

-- Moves segments to an existing or new person: a passage, or every segment of
-- an identity. They go to the person's linked speaker in this transcript with
-- the most segments (ties go to the earliest created); when there is none, the
-- foundations helper creates one at the next free ordinal (spec §5, §6).
CREATE FUNCTION public.correct_segments_to_person(
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
  PERFORM 1 FROM public.transcripts WHERE id = p_transcript_id AND user_id = v_user
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transcript not found' USING ERRCODE = 'SP001'; END IF;
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

-- Reverse a correction that created a person: move the segments back and
-- delete the person. Nothing changes unless the person, its one speaker and
-- the segments still hold what the correction wrote. The emptied speaker
-- remains, unlinked and hidden.
CREATE FUNCTION public.undo_created_person_action(
  p_transcript_id uuid, p_person_id uuid, p_person_updated_at timestamptz,
  p_speaker_id uuid, p_changes jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_speaker public.speakers;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.transcripts WHERE id = p_transcript_id AND user_id = v_user
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transcript not found' USING ERRCODE = 'SP001'; END IF;
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

-- Renames a speaker in this transcript only. A linked speaker shows its
-- person's name, and a detected speaker has no name of its own (naming one is
-- create_local_speaker). A label is never cleared: Remove moves the segments
-- back to their detected speakers instead.
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

-- Names a detected speaker in this transcript only: its segments move to a new
-- speaker with the label, since a detected speaker carries no name.
CREATE FUNCTION public.create_local_speaker(
  p_transcript_id uuid, p_custom_label text, p_changes jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_label text := regexp_replace(p_custom_label, '^\s+|\s+$', '', 'g');
  v_speaker public.speakers;
  v_assignments jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF v_label IS NULL OR char_length(v_label) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'speaker names must be 1 to 50 characters' USING ERRCODE = 'SP003';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'changes must be a non-empty array' USING ERRCODE = 'SP003';
  END IF;
  v_speaker := public.create_transcript_speaker(p_transcript_id, v_user, v_label);

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

-- The former Tag path: a passage correction goes to a person (spec §6).
DROP FUNCTION public.assign_segments_to_new_speaker(uuid, text, jsonb);

REVOKE ALL ON TABLE public.person_appearances FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.speaker_palette() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editor_create_person(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editor_people_context(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.rename_person_guarded(uuid, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.correct_segments_to_person(uuid, jsonb, uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.undo_created_person_action(uuid, uuid, timestamptz, uuid, jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.create_local_speaker(uuid, text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.editor_people_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_person_guarded(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_segments_to_person(uuid, jsonb, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_created_person_action(uuid, uuid, timestamptz, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_local_speaker(uuid, text, jsonb) TO authenticated;
