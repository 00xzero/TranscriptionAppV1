-- =========================================================================
-- Rename the "project" entity to "transcript" across the entire schema.
-- =========================================================================
--
-- Append-only, run-once migration. The "project" vocabulary was a misnomer:
-- the entity has always been a single transcript (one media file + its
-- transcription). This renames the table, every project_id foreign key, and
-- all dependent objects (functions, triggers, indexes, constraints, policies).
--
-- Notes on Postgres rename semantics relied upon here:
--   * ALTER TABLE ... RENAME updates dependent objects that reference the
--     table/column by internal id: RLS policy expressions, index definitions,
--     triggers, FK constraints, and publication membership all keep working.
--     Only their *names* stay stale, which we fix cosmetically below.
--   * plpgsql function BODIES are stored as text and are NOT rewritten by a
--     rename, so any function that references projects/project_id by name must
--     be recreated. Those are: transition_job_status, derive_project_status,
--     save_transcript_segments. (log_job_insert, update_updated_at_column and
--     protect_project_waveform_columns reference only NEW.* / job_events and
--     keep working — they are renamed cosmetically, not recreated.)
--
-- Each step is guarded so the migration is idempotent and tolerant of minor
-- environment drift.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Rename the table: projects -> transcripts
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'projects'
  ) THEN
    ALTER TABLE public.projects RENAME TO transcripts;
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 2. Rename the project_id foreign key column on every child table
-- -------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'speakers', 'segments', 'watchlist', 'jobs', 'failed_events', 'webhook_receipts'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'project_id'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I RENAME COLUMN project_id TO transcript_id', t);
    END IF;
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 3a. Recreate transition_job_status (body references jobs.project_id +
--     projects). Signature is unchanged, so CREATE OR REPLACE preserves grants.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transition_job_status(
  p_job_id UUID,
  p_to_status TEXT,
  p_extra_fields JSONB DEFAULT '{}',
  p_metadata JSONB DEFAULT '{}',
  p_context TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status TEXT;
  v_transcript_id UUID;
  v_valid_targets TEXT[];
  v_rows_updated INT;
  v_caller_uid UUID;
BEGIN
  SELECT status, transcript_id INTO v_current_status, v_transcript_id
  FROM public.jobs WHERE id = p_job_id FOR UPDATE;

  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid', 'error', 'Job not found');
  END IF;

  v_caller_uid := auth.uid();
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

  UPDATE public.jobs SET
    status = p_to_status,
    finished_at = COALESCE((p_extra_fields->>'finished_at')::timestamptz, finished_at),
    started_at = COALESCE((p_extra_fields->>'started_at')::timestamptz, started_at),
    inngest_event_id = COALESCE(p_extra_fields->>'inngest_event_id', inngest_event_id),
    payload = CASE
      WHEN p_extra_fields ? 'payload' THEN (p_extra_fields->'payload')
      ELSE payload
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
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) TO service_role;

-- -------------------------------------------------------------------------
-- 3b. Replace derive_project_status with derive_transcript_status, repoint
--     its two triggers, then drop the old function.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_transcript_status()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_transcript_id UUID;
  v_new_status TEXT;
BEGIN
  v_transcript_id := COALESCE(NEW.transcript_id, OLD.transcript_id);

  SELECT
    CASE
      WHEN bool_or(status = 'processing') THEN 'processing'
      WHEN bool_or(status = 'queued') THEN 'queued'
      ELSE (
        SELECT status FROM public.jobs
        WHERE transcript_id = v_transcript_id AND type = 'transcription'
        ORDER BY created_at DESC LIMIT 1
      )
    END
  INTO v_new_status
  FROM public.jobs
  WHERE transcript_id = v_transcript_id AND type = 'transcription';

  IF v_new_status IS NULL THEN
    UPDATE public.transcripts SET status = 'created'
    WHERE id = v_transcript_id AND status IS DISTINCT FROM 'created';
  ELSE
    UPDATE public.transcripts SET status = v_new_status
    WHERE id = v_transcript_id AND status IS DISTINCT FROM v_new_status;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_derive_project_status ON public.jobs;
DROP TRIGGER IF EXISTS trg_derive_transcript_status ON public.jobs;
CREATE TRIGGER trg_derive_transcript_status
  AFTER INSERT OR DELETE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.derive_transcript_status();

DROP TRIGGER IF EXISTS trg_derive_project_status_update ON public.jobs;
DROP TRIGGER IF EXISTS trg_derive_transcript_status_update ON public.jobs;
CREATE TRIGGER trg_derive_transcript_status_update
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.derive_transcript_status();

DROP FUNCTION IF EXISTS public.derive_project_status();

-- -------------------------------------------------------------------------
-- 3c. Recreate save_transcript_segments. The param is renamed
--     p_project_id -> p_transcript_id, which CREATE OR REPLACE cannot do, so
--     drop then create. The matching .rpc() arg key is updated app-side.
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.save_transcript_segments(UUID, JSONB);

CREATE FUNCTION public.save_transcript_segments(
    p_transcript_id UUID,
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
    -- 1. Delete existing transcript content for this transcript.
    --    words.segment_id FK has ON DELETE CASCADE, so word rows go with them.
    DELETE FROM segments WHERE transcript_id = p_transcript_id;

    -- 2. Build the speaker mapping table.
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
        INSERT INTO speakers (transcript_id, label)
        SELECT p_transcript_id, label FROM src
        ON CONFLICT (transcript_id, label) DO UPDATE SET label = EXCLUDED.label
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
        LEFT JOIN tmp_speaker_mapping m ON m.speaker_num = s.speaker_num
        RETURNING id, end_ms
    )
    SELECT COUNT(*)::INT, COALESCE(MAX(end_ms), 0)::INT
    INTO v_segment_count, v_max_end_ms
    FROM inserted_segments;

    -- 4. Insert words for all segments in a single statement.
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

REVOKE ALL ON FUNCTION public.save_transcript_segments(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_transcript_segments(UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.save_transcript_segments(UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.save_transcript_segments(UUID, JSONB) TO service_role;

COMMENT ON FUNCTION public.save_transcript_segments IS
'Atomically replaces the transcript content (segments + words + speaker
upserts) for a transcript from a JSONB payload built by the Inngest webhook
handler. All operations run in one transaction so partial-write states are
impossible.';

-- -------------------------------------------------------------------------
-- 4. Cosmetic rename: protect_project_waveform_columns function + its trigger.
--    The body references only NEW.* columns, so it keeps working; we just
--    bring the names in line.
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'protect_project_waveform_columns'
  ) THEN
    ALTER FUNCTION public.protect_project_waveform_columns()
      RENAME TO protect_transcript_waveform_columns;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'protect_project_waveform_columns_trigger'
      AND tgrelid = 'public.transcripts'::regclass
  ) THEN
    ALTER TRIGGER protect_project_waveform_columns_trigger ON public.transcripts
      RENAME TO protect_transcript_waveform_columns_trigger;
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 5. Cosmetic rename: updated_at trigger on the renamed table.
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_projects_updated_at'
      AND tgrelid = 'public.transcripts'::regclass
  ) THEN
    ALTER TRIGGER update_projects_updated_at ON public.transcripts
      RENAME TO update_transcripts_updated_at;
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 6. Cosmetic rename: indexes that carry "project" in their name.
-- -------------------------------------------------------------------------
ALTER INDEX IF EXISTS public.idx_projects_user_id RENAME TO idx_transcripts_user_id;
ALTER INDEX IF EXISTS public.idx_projects_status RENAME TO idx_transcripts_status;
ALTER INDEX IF EXISTS public.idx_projects_user_id_upload_intent_id
  RENAME TO idx_transcripts_user_id_upload_intent_id;
ALTER INDEX IF EXISTS public.idx_speakers_project_id RENAME TO idx_speakers_transcript_id;
ALTER INDEX IF EXISTS public.idx_segments_project_id RENAME TO idx_segments_transcript_id;
ALTER INDEX IF EXISTS public.idx_watchlist_project_id RENAME TO idx_watchlist_transcript_id;
ALTER INDEX IF EXISTS public.idx_jobs_project_id RENAME TO idx_jobs_transcript_id;
ALTER INDEX IF EXISTS public.idx_jobs_one_active_per_project
  RENAME TO idx_jobs_one_active_per_transcript;
ALTER INDEX IF EXISTS public.idx_failed_events_project RENAME TO idx_failed_events_transcript;
ALTER INDEX IF EXISTS public.idx_webhook_receipts_project RENAME TO idx_webhook_receipts_transcript;

-- -------------------------------------------------------------------------
-- 7. Cosmetic rename: constraints (check, unique, and foreign keys).
-- -------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  -- old constraint name -> new constraint name, paired with its table.
  renames CONSTANT TEXT[][] := ARRAY[
    ['transcripts', 'projects_pkey', 'transcripts_pkey'],
    ['transcripts', 'projects_user_id_fkey', 'transcripts_user_id_fkey'],
    ['transcripts', 'chk_projects_status', 'chk_transcripts_status'],
    ['transcripts', 'projects_waveform_status_check', 'transcripts_waveform_status_check'],
    ['transcripts', 'projects_waveform_points_per_second_positive', 'transcripts_waveform_points_per_second_positive'],
    ['transcripts', 'projects_waveform_version_positive', 'transcripts_waveform_version_positive'],
    ['speakers', 'speakers_project_id_label_unique', 'speakers_transcript_id_label_unique'],
    ['speakers', 'speakers_project_id_fkey', 'speakers_transcript_id_fkey'],
    ['segments', 'segments_project_id_fkey', 'segments_transcript_id_fkey'],
    ['watchlist', 'watchlist_project_id_fkey', 'watchlist_transcript_id_fkey'],
    ['jobs', 'jobs_project_id_fkey', 'jobs_transcript_id_fkey'],
    ['failed_events', 'failed_events_project_id_fkey', 'failed_events_transcript_id_fkey'],
    ['webhook_receipts', 'webhook_receipts_project_id_fkey', 'webhook_receipts_transcript_id_fkey']
  ];
BEGIN
  FOR r IN SELECT renames[i][1] AS tbl, renames[i][2] AS old_name, renames[i][3] AS new_name
           FROM generate_subscripts(renames, 1) AS i
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = r.old_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I',
        r.tbl, r.old_name, r.new_name
      );
    END IF;
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 8. Cosmetic rename: RLS policy names (their USING/WITH CHECK expressions
--    already track the table/column rename automatically).
-- -------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  -- table, old policy name, new policy name
  renames CONSTANT TEXT[][] := ARRAY[
    ['transcripts', 'Users can view own projects', 'Users can view own transcripts'],
    ['transcripts', 'Users can create own projects', 'Users can create own transcripts'],
    ['transcripts', 'Users can update own projects', 'Users can update own transcripts'],
    ['transcripts', 'Users can delete own projects', 'Users can delete own transcripts'],
    ['speakers', 'Users can access own project speakers', 'Users can access own transcript speakers'],
    ['segments', 'Users can access own project segments', 'Users can access own transcript segments'],
    ['words', 'Users can access own project words', 'Users can access own transcript words'],
    ['watchlist', 'Users can access own project watchlist', 'Users can access own transcript watchlist'],
    ['jobs', 'Users can access own project jobs', 'Users can access own transcript jobs']
  ];
BEGIN
  FOR r IN SELECT renames[i][1] AS tbl, renames[i][2] AS old_name, renames[i][3] AS new_name
           FROM generate_subscripts(renames, 1) AS i
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = r.tbl AND policyname = r.old_name
    ) THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I RENAME TO %I',
        r.old_name, r.tbl, r.new_name
      );
    END IF;
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 9. Realtime publication: membership is tracked by table id, so the renamed
--    table stays in supabase_realtime automatically. We still re-assert it
--    explicitly (idempotent) so the 'transcripts' membership is greppable and
--    survives environments that never ran the original publication migration.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['transcripts', 'jobs', 'speakers']
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = target_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', target_table);
    END IF;
  END LOOP;
END
$$;
