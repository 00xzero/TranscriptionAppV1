-- =========================================================================
-- Speaker identity foundations (speaker overhaul, slice 1)
-- =========================================================================
--
-- Replaces the free-text speakers.label with the transcript speaker model from
-- .docs/speaker-identity-functional-spec.md (§3, §9, §10):
--
--   ordinal            the N in "Speaker N"
--   custom_label       an optional transcript-local label
--   diarization_index  Deepgram's speaker number; save_transcript_segments keys
--                      on it instead of on the label
--   user_id            the transcript's owner, enforced by a composite key
--
-- Every existing speaker id and segment assignment is preserved. Each legacy
-- label is parsed once: an exact "Speaker N" becomes ordinal N with no custom
-- label; anything else is kept verbatim as the custom label and takes the next
-- free ordinal, so every label displays exactly as before. Blank labels, which
-- never displayed anything useful, fall back to "Speaker N". Existing rows get
-- no diarization index: the save function never runs again on a completed
-- transcript.
--
-- Speaker writes from the app go only through the guarded functions below;
-- signed-in users can no longer write speakers or segments.speaker_id directly.
--
-- SQLSTATEs raised by the speaker write functions:
--   SP001  transcript, speaker or segment not found (or not the caller's)
--   SP002  changed since: a guarded expectation no longer holds
--   SP003  invalid input
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Owner key on transcripts, for the composite owner FK on speakers.
-- -------------------------------------------------------------------------
ALTER TABLE public.transcripts
  ADD CONSTRAINT transcripts_id_user_unique UNIQUE (id, user_id);

-- -------------------------------------------------------------------------
-- 2. New transcript speaker columns, backfilled from the legacy label.
-- -------------------------------------------------------------------------
ALTER TABLE public.speakers
  ADD COLUMN user_id uuid,
  ADD COLUMN ordinal integer,
  ADD COLUMN custom_label text,
  ADD COLUMN diarization_index integer;

UPDATE public.speakers AS sp
SET user_id = t.user_id
FROM public.transcripts AS t
WHERE t.id = sp.transcript_id;

-- Strict on purpose: only the exact text "Speaker " || N reproduces the label,
-- so "speaker 2", "Speaker 01" or "Speaker  1" stay custom labels. Nine digits
-- keep the cast inside integer range.
UPDATE public.speakers
SET ordinal = substr(label, 9)::integer
WHERE label ~ '^Speaker (0|[1-9][0-9]{0,8})$';

WITH base AS (
  SELECT sp.transcript_id, COALESCE(max(sp.ordinal), -1) AS max_ordinal
  FROM public.speakers AS sp
  GROUP BY sp.transcript_id
),
numbered AS (
  SELECT
    sp.id,
    b.max_ordinal + row_number() OVER (
      PARTITION BY sp.transcript_id
      ORDER BY sp.created_at, sp.id
    ) AS ordinal
  FROM public.speakers AS sp
  JOIN base AS b ON b.transcript_id = sp.transcript_id
  WHERE sp.ordinal IS NULL
)
UPDATE public.speakers AS sp
SET
  ordinal = n.ordinal,
  custom_label = CASE WHEN sp.label ~ '\S' THEN sp.label END
FROM numbered AS n
WHERE n.id = sp.id;

-- -------------------------------------------------------------------------
-- 3. Speaker constraints and keys.
-- -------------------------------------------------------------------------
-- The 50-character limit (TEXT_LIMITS.speakerName) is enforced by the write
-- functions, not here, so a longer legacy label stays valid.
ALTER TABLE public.speakers
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN ordinal SET NOT NULL,
  ADD CONSTRAINT speakers_ordinal_nonnegative CHECK (ordinal >= 0),
  ADD CONSTRAINT speakers_diarization_index_nonnegative CHECK (diarization_index >= 0),
  ADD CONSTRAINT speakers_custom_label_not_blank CHECK (custom_label ~ '\S'),
  ADD CONSTRAINT speakers_transcript_ordinal_unique UNIQUE (transcript_id, ordinal),
  ADD CONSTRAINT speakers_transcript_diarization_unique UNIQUE (transcript_id, diarization_index),
  ADD CONSTRAINT speakers_transcript_id_id_unique UNIQUE (transcript_id, id),
  ADD CONSTRAINT speakers_transcript_owner_fk
    FOREIGN KEY (transcript_id, user_id)
    REFERENCES public.transcripts (id, user_id)
    ON DELETE CASCADE;

-- The composite owner FK replaces the single-column transcript FK, and the
-- new unique keys all lead with transcript_id, which makes its index redundant.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint AS c
    WHERE c.conrelid = 'public.speakers'::regclass
      AND c.contype = 'f'
      AND c.confrelid = 'public.transcripts'::regclass
      AND c.conkey = ARRAY[(
        SELECT a.attnum FROM pg_attribute AS a
        WHERE a.attrelid = 'public.speakers'::regclass AND a.attname = 'transcript_id'
      )]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.speakers DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$$;

DROP INDEX IF EXISTS public.idx_speakers_transcript_id;

-- -------------------------------------------------------------------------
-- 4. A segment may reference only a speaker of its own transcript.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.segments AS sg
  JOIN public.speakers AS sp ON sp.id = sg.speaker_id
  WHERE sp.transcript_id <> sg.transcript_id;

  IF v_count > 0 THEN
    RAISE EXCEPTION '% segments reference a speaker from another transcript', v_count;
  END IF;
END
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint AS c
    WHERE c.conrelid = 'public.segments'::regclass
      AND c.contype = 'f'
      AND c.confrelid = 'public.speakers'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.segments DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$$;

ALTER TABLE public.segments
  ADD CONSTRAINT segments_transcript_speaker_fk
    FOREIGN KEY (transcript_id, speaker_id)
    REFERENCES public.speakers (transcript_id, id)
    ON DELETE SET NULL (speaker_id);

-- -------------------------------------------------------------------------
-- 5. Drop the legacy columns. The label uniqueness constraint goes with
--    label: it would block two speakers sharing a custom label and collide
--    with speakers created by corrections (§10).
-- -------------------------------------------------------------------------
ALTER TABLE public.speakers DROP CONSTRAINT IF EXISTS speakers_transcript_id_label_unique;
ALTER TABLE public.speakers
  DROP COLUMN label,
  DROP COLUMN color;

-- -------------------------------------------------------------------------
-- 6. RLS and grants. Speakers are read-only to signed-in users; every write
--    goes through a guarded function. Segment text stays directly editable,
--    but the speaker assignment does not.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can access own transcript speakers" ON public.speakers;
DROP POLICY IF EXISTS "Users can access own project speakers" ON public.speakers;

CREATE POLICY "Users can view own transcript speakers"
  ON public.speakers FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON TABLE public.speakers FROM authenticated;

REVOKE UPDATE ON TABLE public.segments FROM authenticated;
GRANT UPDATE (text, is_edited) ON TABLE public.segments TO authenticated;

-- -------------------------------------------------------------------------
-- 7. save_transcript_segments: speakers keyed on the diarization index.
--    Same signature, so existing grants carry over; re-asserted below.
-- -------------------------------------------------------------------------
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

    -- 2. Resolve each diarization index to a transcript speaker. A re-run
    --    reuses the speaker already holding that index. A new speaker takes
    --    ordinal = index, unless an earlier speaker (a legacy row or one made
    --    by a correction) already holds that ordinal; then the next free one.
    DROP TABLE IF EXISTS tmp_speaker_mapping;
    CREATE TEMP TABLE tmp_speaker_mapping (
        speaker_num INT PRIMARY KEY,
        speaker_id UUID NOT NULL
    ) ON COMMIT DROP;

    FOR v_num IN
        SELECT DISTINCT x.num
        FROM jsonb_to_recordset(COALESCE(p_payload->'speakers', '[]'::jsonb)) AS x(num INT)
        WHERE x.num IS NOT NULL
        ORDER BY x.num
    LOOP
        SELECT sp.id INTO v_speaker_id
        FROM public.speakers AS sp
        WHERE sp.transcript_id = p_transcript_id
          AND sp.diarization_index = v_num;

        IF NOT FOUND THEN
            IF EXISTS (
                SELECT 1 FROM public.speakers AS sp
                WHERE sp.transcript_id = p_transcript_id AND sp.ordinal = v_num
            ) THEN
                SELECT COALESCE(max(sp.ordinal), -1) + 1 INTO v_ordinal
                FROM public.speakers AS sp
                WHERE sp.transcript_id = p_transcript_id;
            ELSE
                v_ordinal := v_num;
            END IF;

            INSERT INTO public.speakers (transcript_id, user_id, ordinal, diarization_index)
            VALUES (p_transcript_id, v_user_id, v_ordinal, v_num)
            RETURNING id INTO v_speaker_id;
        END IF;

        INSERT INTO tmp_speaker_mapping (speaker_num, speaker_id)
        VALUES (v_num, v_speaker_id);
    END LOOP;

    -- 3. Insert segments. speaker_num is the join key; LEFT JOIN preserves
    --    rows where the payload's speaker_num is NULL or unmapped (defensive).
    WITH inserted_segments AS (
        INSERT INTO public.segments (
            id,
            transcript_id,
            speaker_id,
            start_ms,
            end_ms,
            text,
            is_filler,
            algo_version
        )
        SELECT
            s.id,
            p_transcript_id,
            m.speaker_id,
            s.start_ms,
            s.end_ms,
            s.text,
            s.is_filler,
            s.algo_version
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

REVOKE ALL ON FUNCTION public.save_transcript_segments(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_transcript_segments(UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.save_transcript_segments(UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.save_transcript_segments(UUID, JSONB) TO service_role;

COMMENT ON FUNCTION public.save_transcript_segments IS
'Atomically replaces the transcript content (segments + words) for a transcript
from a JSONB payload built by the Inngest webhook handler, creating transcript
speakers keyed on (transcript_id, diarization_index). Never creates people.';

-- -------------------------------------------------------------------------
-- 8. Internal helpers. Invoker rights and no grants: only the definer
--    functions below (running as their owner) may call them.
-- -------------------------------------------------------------------------

-- Creates a transcript speaker at the next free ordinal: the highest ordinal
-- plus one, never a gap, so a new voice cannot inherit the number of a
-- diarized voice that had no segments.
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
  PERFORM 1
  FROM public.transcripts AS t
  WHERE t.id = p_transcript_id AND t.user_id = p_user_id
  FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transcript not found' USING ERRCODE = 'SP001';
  END IF;

  INSERT INTO public.speakers (transcript_id, user_id, ordinal, custom_label)
  SELECT p_transcript_id, p_user_id, COALESCE(max(sp.ordinal), -1) + 1, p_custom_label
  FROM public.speakers AS sp
  WHERE sp.transcript_id = p_transcript_id
  RETURNING * INTO v_speaker;

  RETURN v_speaker;
END;
$$;

-- Applies [{segment_id, expected_speaker_id, speaker_id}, ...] to one
-- transcript, all or nothing. A NULL speaker_id means Unknown. Every segment
-- must still hold its expected speaker, or nothing changes (SP002).
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

-- -------------------------------------------------------------------------
-- 9. Guarded speaker writes for signed-in users. Definer rights because the
--    tables are no longer writable by authenticated; ownership is checked
--    explicitly against auth.uid().
-- -------------------------------------------------------------------------

-- Rename in this transcript only, or clear the label with NULL or blank. The
-- caller passes the custom_label it last read; a mismatch refuses the write.
CREATE OR REPLACE FUNCTION public.set_speaker_custom_label(
  p_speaker_id uuid,
  p_expected_custom_label text,
  p_custom_label text
)
RETURNS public.speakers
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_label text := NULLIF(regexp_replace(p_custom_label, '^\s+|\s+$', '', 'g'), '');
  v_speaker public.speakers;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- Mirrors TEXT_LIMITS.speakerName in frontend/contracts/limits.ts.
  IF char_length(v_label) > 50 THEN
    RAISE EXCEPTION 'speaker names must be 50 characters or fewer' USING ERRCODE = 'SP003';
  END IF;

  SELECT sp.* INTO v_speaker
  FROM public.speakers AS sp
  WHERE sp.id = p_speaker_id AND sp.user_id = v_user
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'speaker not found' USING ERRCODE = 'SP001';
  END IF;

  IF v_speaker.custom_label IS DISTINCT FROM p_expected_custom_label THEN
    RAISE EXCEPTION 'speaker label changed since it was read' USING ERRCODE = 'SP002';
  END IF;

  UPDATE public.speakers AS sp
  SET custom_label = v_label
  WHERE sp.id = p_speaker_id
  RETURNING sp.* INTO v_speaker;

  RETURN v_speaker;
END;
$$;

-- Passage correction to an existing speaker of the transcript or to Unknown.
-- Takes one target per segment, so an Undo can restore a mixed turn in one call.
CREATE OR REPLACE FUNCTION public.reassign_segments(
  p_transcript_id uuid,
  p_changes jsonb
)
RETURNS TABLE (segment_id uuid, speaker_id uuid)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;

-- Creates a transcript speaker with a local label and moves the given
-- segments to it, as one operation. Changes are [{segment_id,
-- expected_speaker_id}, ...]. Backs today's Tag action; slice 2 replaces the
-- label with a person link, since corrections must not create local labels.
CREATE OR REPLACE FUNCTION public.assign_segments_to_new_speaker(
  p_transcript_id uuid,
  p_custom_label text,
  p_changes jsonb
)
RETURNS public.speakers
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_label text := NULLIF(regexp_replace(p_custom_label, '^\s+|\s+$', '', 'g'), '');
  v_speaker public.speakers;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- Mirrors TEXT_LIMITS.speakerName in frontend/contracts/limits.ts.
  IF v_label IS NULL OR char_length(v_label) > 50 THEN
    RAISE EXCEPTION 'speaker names must be 1 to 50 characters' USING ERRCODE = 'SP003';
  END IF;

  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'changes must be a non-empty array' USING ERRCODE = 'SP003';
  END IF;

  v_speaker := public.create_transcript_speaker(p_transcript_id, v_user, v_label);

  -- Any failure below also rolls back the speaker created above.
  PERFORM 1
  FROM public.apply_segment_speaker_changes(
    p_transcript_id,
    (
      SELECT jsonb_agg(
        CASE WHEN jsonb_typeof(e) = 'object'
          THEN e || jsonb_build_object('speaker_id', v_speaker.id)
          ELSE e
        END
      )
      FROM jsonb_array_elements(p_changes) AS e
    )
  );

  RETURN v_speaker;
END;
$$;

REVOKE ALL ON FUNCTION public.create_transcript_speaker(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_transcript_speaker(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.create_transcript_speaker(uuid, uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.create_transcript_speaker(uuid, uuid, text) FROM service_role;
REVOKE ALL ON FUNCTION public.apply_segment_speaker_changes(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_segment_speaker_changes(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.apply_segment_speaker_changes(uuid, jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.apply_segment_speaker_changes(uuid, jsonb) FROM service_role;

-- service_role is not granted: auth.uid() is NULL for it, so it could only
-- ever fail the authentication check.
REVOKE ALL ON FUNCTION public.set_speaker_custom_label(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_speaker_custom_label(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.set_speaker_custom_label(uuid, text, text) FROM service_role;
REVOKE ALL ON FUNCTION public.reassign_segments(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reassign_segments(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.reassign_segments(uuid, jsonb) FROM service_role;
REVOKE ALL ON FUNCTION public.assign_segments_to_new_speaker(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_segments_to_new_speaker(uuid, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.assign_segments_to_new_speaker(uuid, text, jsonb) FROM service_role;

GRANT EXECUTE ON FUNCTION public.set_speaker_custom_label(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_segments(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_segments_to_new_speaker(uuid, text, jsonb) TO authenticated;

-- -------------------------------------------------------------------------
-- 10. project_speaker_summaries: the preview carries ordinal and customLabel
--     instead of the dropped label and color columns; the client resolves the
--     label. Everything else is unchanged until the slice 3 rewrite.
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
  -- DISTINCT so a caller passing the same id twice gets one row, and a NULL or
  -- empty array yields no rows at all rather than an error.
  requested AS (
    SELECT DISTINCT r.id
    FROM unnest(COALESCE(p_project_ids, '{}'::uuid[])) AS r(id)
    WHERE r.id IS NOT NULL
  ),
  -- RLS on public.projects restricts this to the caller's own rows. A project
  -- marked for deletion is dropped here, so it is absent from the result
  -- entirely rather than reported with a zero count.
  emitted AS (
    SELECT p.id
    FROM public.projects AS p
    JOIN requested AS q ON q.id = p.id
    WHERE p.deleting_at IS NULL
  ),
  -- Fresh recursion rather than public.project_branch_ids(): that function is
  -- REVOKEd from PUBLIC and never granted to authenticated, so a SECURITY
  -- INVOKER caller cannot execute it, and it deliberately does not prune
  -- deleting_at. Pruning happens DURING recursion, so a deleting project takes
  -- its whole subtree with it -- post-filtering would keep its grandchildren.
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
  -- This DISTINCT is not cosmetic: count(*) below is a distinct-speaker count
  -- only because (root_id, scope_project_id) is unique here and a transcript has
  -- exactly one project_id. Drop it and both counts and avatars duplicate.
  scope AS (
    SELECT DISTINCT b.root_id, b.scope_project_id
    FROM branch AS b
    WHERE NOT b.is_cycle
  ),
  scope_transcripts AS (
    SELECT s.root_id, t.id AS transcript_id, t.updated_at
    FROM scope AS s
    JOIN public.transcripts AS t ON t.project_id = s.scope_project_id
  ),
  -- Palette index over EVERY speaker of the transcript, before the "referenced
  -- by a segment" filter below. The IN () de-duplicates, so a transcript
  -- reachable from two requested roots is ranked exactly once.
  ranked_speakers AS (
    SELECT
      sp.id,
      sp.transcript_id,
      sp.ordinal,
      sp.custom_label,
      sp.created_at,
      (row_number() OVER (
        PARTITION BY sp.transcript_id
        ORDER BY sp.created_at, sp.id
      ) - 1)::integer AS palette_index
    FROM public.speakers AS sp
    WHERE sp.transcript_id IN (SELECT st.transcript_id FROM scope_transcripts AS st)
  ),
  -- EXISTS rather than a DISTINCT pre-aggregation over segments: this is a
  -- semi-join that stops at the first matching segment per speaker, and
  -- idx_segments_transcript_speaker covers both correlation columns.
  used_speakers AS (
    SELECT rs.*
    FROM ranked_speakers AS rs
    WHERE EXISTS (
      SELECT 1
      FROM public.segments AS sg
      WHERE sg.transcript_id = rs.transcript_id
        AND sg.speaker_id = rs.id
    )
  ),
  ordered AS (
    SELECT
      st.root_id,
      us.id,
      us.transcript_id,
      us.ordinal,
      us.custom_label,
      us.palette_index,
      row_number() OVER (
        PARTITION BY st.root_id
        ORDER BY st.updated_at DESC, st.transcript_id, us.created_at, us.id
      ) AS rn
    FROM scope_transcripts AS st
    JOIN used_speakers AS us ON us.transcript_id = st.transcript_id
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
          jsonb_build_object(
            'id',           o.id,
            'transcriptId', o.transcript_id,
            'ordinal',      o.ordinal,
            'customLabel',  o.custom_label,
            'paletteIndex', o.palette_index
          )
          ORDER BY o.rn
        ) FILTER (WHERE o.rn <= LEAST(GREATEST(COALESCE(p_preview_limit, 4), 0), 4)),
        '[]'::jsonb
      ) AS preview
    FROM ordered AS o
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
'Per-project speaker avatar summary: the distinct transcript speakers referenced
by segments in a project''s direct transcripts (or its whole active branch), each
with its ordinal, custom label and editor palette index, plus a bounded preview
slice. SECURITY INVOKER -- RLS performs the ownership filtering.';

REVOKE ALL ON FUNCTION public.project_speaker_summaries(uuid[], boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.project_speaker_summaries(uuid[], boolean, integer) FROM anon;
REVOKE ALL ON FUNCTION public.project_speaker_summaries(uuid[], boolean, integer) FROM service_role;
GRANT EXECUTE ON FUNCTION public.project_speaker_summaries(uuid[], boolean, integer) TO authenticated;
