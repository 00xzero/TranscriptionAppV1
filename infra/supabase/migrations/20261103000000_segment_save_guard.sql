-- Only the running attempt may save a transcript's segments (audit finding
-- pipeline-3). save_transcript_segments replaces every segment, so a late
-- duplicate run of the pipeline, one that read its job before the transcript
-- completed, could otherwise wipe the edits made since. The save now names
-- its job and is refused unless that job belongs to the transcript and is
-- still processing. A future re-transcription runs as a new job and saves as
-- usual; leftovers of the old one are refused.
--
-- Locking order is unchanged: the speaker identity advisory lock, then the
-- transcript row, the order delete_transcript takes too. Both checks are made
-- under that lock. The transcript's status is read from the row the save
-- holds, so a completion that committed first is always seen, and one still
-- in flight waits for the save (its trigger updates this row) and lands
-- after it. The job is not locked: locking it before the transcript would
-- deadlock with a delete (transcript, then its jobs), and after it with
-- completion (the job, then the transcript).
--
-- SQLSTATEs follow the people migrations: SP001 not found; SP005 the save is
-- not the running attempt's (the pipeline skips it).
--
-- No existing content is rewritten by this migration.

DROP FUNCTION public.save_transcript_segments(UUID, JSONB);

CREATE FUNCTION public.save_transcript_segments(
    p_transcript_id UUID,
    p_job_id UUID,
    p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_transcript_status TEXT;
    v_job_status TEXT;
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

    -- The row lock serialises ordinal allocation with create_transcript_speaker,
    -- and the checks below with completion.
    SELECT t.user_id, t.status INTO v_user_id, v_transcript_status
    FROM public.transcripts AS t
    WHERE t.id = p_transcript_id
    FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'transcript not found' USING ERRCODE = 'SP001';
    END IF;

    -- One active job per transcript, so a processing job is the running attempt.
    SELECT j.status INTO v_job_status
    FROM public.jobs AS j
    WHERE j.id = p_job_id AND j.transcript_id = p_transcript_id;

    IF v_transcript_status = 'completed' OR v_job_status IS DISTINCT FROM 'processing' THEN
        RAISE EXCEPTION 'only the running attempt may save segments' USING ERRCODE = 'SP005';
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

REVOKE ALL ON FUNCTION public.save_transcript_segments(UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_transcript_segments(UUID, UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.save_transcript_segments(UUID, UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.save_transcript_segments(UUID, UUID, JSONB) TO service_role;

COMMENT ON FUNCTION public.save_transcript_segments IS
'Atomically replaces the transcript content (segments + words) for a transcript
from a JSONB payload built by the Inngest webhook handler, creating transcript
speakers keyed on (transcript_id, diarization_index). Never creates people.
Refused (SP005) once the transcript is completed, or unless p_job_id is the
transcript''s job and still processing.';
