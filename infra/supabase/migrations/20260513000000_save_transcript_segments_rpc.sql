-- =========================================================================
-- save_transcript_segments: atomically replace transcript for a project
-- =========================================================================
--
-- Replaces the loop-based persistence in the Inngest webhook handler. The
-- handler builds the canonical transcript in TypeScript (via segment-builder)
-- and hands the full payload here. All deletes and inserts happen inside a
-- single Postgres transaction: any failure rolls back the entire rewrite, so
-- the project can never be left with partial segment/word data.
--
-- Payload shape (matches SaveTranscriptSegmentsPayloadSchema in
-- frontend/contracts/db.ts):
--   {
--     "speakers": [{ "num": int, "label": text }, ...],
--     "segments": [
--       {
--         "id": uuid,               -- pre-generated client-side
--         "speaker_num": int|null,
--         "start_ms": int,
--         "end_ms": int,
--         "text": text,
--         "is_filler": bool,
--         "algo_version": text,
--         "words": [
--           {
--             "start_ms": int, "end_ms": int, "text": text,
--             "confidence": real, "order_index": int,
--             "speaker": int|null, "speaker_confidence": real|null,
--             "punctuated_text": text,
--             "paragraph_index": int|null, "sentence_end": bool
--           }, ...
--         ]
--       }, ...
--     ]
--   }
--
-- Returns: { "segment_count": int, "word_count": int, "duration_ms": int }
-- =========================================================================

CREATE OR REPLACE FUNCTION save_transcript_segments(
    p_project_id UUID,
    p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_segment_count INT := 0;
    v_word_count INT := 0;
    v_max_end_ms INT := 0;
BEGIN
    -- 1. Delete existing transcript for this project.
    --    words.segment_id FK has ON DELETE CASCADE, so word rows go with them.
    DELETE FROM segments WHERE project_id = p_project_id;

    -- 2. Build the speaker mapping table.
    --    Three columns by design: speaker_num is the only key segments resolve
    --    against; label is carried for diagnostics; speaker_id is the upserted
    --    speakers.id. Segments with NULL speaker_num get NULL speaker_id via
    --    LEFT JOIN in step 3.
    --
    --    Drop-then-create makes the function safely re-entrant within a single
    --    transaction (rare, but possible during testing).
    DROP TABLE IF EXISTS tmp_speaker_mapping;
    CREATE TEMP TABLE tmp_speaker_mapping (
        speaker_num INT,
        speaker_label TEXT,
        speaker_id UUID
    ) ON COMMIT DROP;

    WITH src AS (
        SELECT num, label
        FROM jsonb_to_recordset(COALESCE(p_payload->'speakers', '[]'::jsonb))
            AS x(num INT, label TEXT)
    ),
    upserted AS (
        INSERT INTO speakers (project_id, label)
        SELECT p_project_id, label FROM src
        -- DO UPDATE (instead of DO NOTHING) so RETURNING fires for conflict
        -- rows too; the SET is a no-op that preserves the existing label.
        ON CONFLICT (project_id, label) DO UPDATE SET label = EXCLUDED.label
        RETURNING id, label
    )
    INSERT INTO tmp_speaker_mapping (speaker_num, speaker_label, speaker_id)
    SELECT s.num, s.label, u.id
    FROM src s
    JOIN upserted u ON u.label = s.label;

    -- 3. Insert segments. speaker_num is the join key; LEFT JOIN preserves
    --    rows where the payload's speaker_num is NULL or unmapped (defensive).
    WITH inserted_segments AS (
        INSERT INTO segments (
            id,
            project_id,
            speaker_id,
            start_ms,
            end_ms,
            text,
            is_filler,
            algo_version
        )
        SELECT
            s.id,
            p_project_id,
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
        LEFT JOIN tmp_speaker_mapping m ON m.speaker_num = s.speaker_num
        RETURNING id, end_ms
    )
    SELECT COUNT(*)::INT, COALESCE(MAX(end_ms), 0)::INT
    INTO v_segment_count, v_max_end_ms
    FROM inserted_segments;

    -- 4. Insert words for all segments in a single statement. Flatten the
    --    payload via jsonb_array_elements over segments, then jsonb_to_recordset
    --    over each segment's words array. segment_id comes from (seg->>'id').
    WITH inserted_words AS (
        INSERT INTO words (
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

-- Permissions: service_role only. Mirror transition_job_status.
REVOKE ALL ON FUNCTION save_transcript_segments(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_transcript_segments(UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION save_transcript_segments(UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION save_transcript_segments(UUID, JSONB) TO service_role;

COMMENT ON FUNCTION save_transcript_segments IS
'Atomically replaces the transcript (segments + words + speaker upserts) for
a project from a JSONB payload built by the Inngest webhook handler. All
operations run in one transaction so partial-write states are impossible.';
