-- Job results in Storage.
--
-- 1. Deepgram's response is kept as a gzipped file in the server-only
--    transcription-results bucket, at {user_id}/{transcript_id}/{job_id}.json.gz,
--    instead of in jobs.payload. The job names its file in result_object_key.
-- 2. Job errors get their own columns.
-- 3. transition_job_status writes those columns and refuses fields it does not
--    know, so a write meant for the old payload column fails loudly.
-- 4. The transcript folder inventory covers the new bucket, so deleting a
--    transcript or a project removes its results with its other files.
--
-- jobs.payload stays until scripts/move-job-payloads-to-storage.ts has moved
-- the stored responses; 20261016010000_drop_job_payload.sql drops it.

-- ---------------------------------------------------------------------------
-- 1. Bucket. No policies: only the service role reads, writes or removes, so
--    a user can neither read nor plant a response. The delete routes remove
--    these files with the admin client, using the user's own folder inventory.
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'transcription-results',
    'transcription-results',
    false,
    10485760,  -- 10MB; webhook bodies are capped at 4.5MB before compression
    ARRAY['application/gzip']
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Columns.
-- ---------------------------------------------------------------------------

ALTER TABLE public.jobs
  ADD COLUMN result_object_key text,
  ADD COLUMN error_message text,
  ADD COLUMN error_type text,
  ADD COLUMN error_detail text,
  ADD CONSTRAINT jobs_result_object_key_in_folder CHECK (
    result_object_key IS NULL
    OR result_object_key ~ (
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      || transcript_id::text || '/' || id::text || '\.json\.gz$'
    )
  ),
  ADD CONSTRAINT jobs_error_detail_length CHECK (char_length(error_detail) <= 500);

UPDATE public.jobs
SET error_message = payload->>'error',
    error_type = payload->>'error_type',
    error_detail = left(payload->>'raw_error', 500)
WHERE payload ? 'error';

-- ---------------------------------------------------------------------------
-- 3. Job transitions. Signature is unchanged, so CREATE OR REPLACE keeps the
--    service_role-only grants.
-- ---------------------------------------------------------------------------

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
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 4. Folder inventory covers transcription-results.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.transcript_folder_objects(p_user uuid, p_transcript_ids uuid[])
RETURNS TABLE (bucket_id text, name text)
STABLE
SECURITY DEFINER
SET search_path = ''
LANGUAGE sql
AS $$
  SELECT o.bucket_id, o.name
  FROM unnest(p_transcript_ids) AS t(id)
  CROSS JOIN LATERAL (SELECT p_user::text || '/' || t.id::text || '/' AS prefix) AS f
  JOIN storage.objects AS o
    ON o.bucket_id IN ('media', 'waveforms', 'transcription-results')
    -- starts_with(name, prefix) as a range ('/' + 1 = '0'), so the
    -- (bucket_id, name COLLATE "C") index serves it.
    AND o.name COLLATE "C" >= f.prefix
    AND o.name COLLATE "C" < left(f.prefix, -1) || '0';
$$;

DROP FUNCTION public.transcript_delete_inventory(uuid[]);

CREATE FUNCTION public.transcript_delete_inventory(p_ids uuid[])
RETURNS TABLE (media_keys text[], waveform_keys text[], result_keys text[])
STABLE
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;

DROP FUNCTION public.begin_project_delete(uuid);
DROP FUNCTION public.project_branch_inventory(uuid, uuid[]);

CREATE FUNCTION public.project_branch_inventory(p_user uuid, p_project_ids uuid[])
RETURNS TABLE (transcript_ids uuid[], media_keys text[], waveform_keys text[], result_keys text[])
STABLE
SECURITY INVOKER
SET search_path = public
LANGUAGE sql
AS $$
  WITH branch AS (
    SELECT public.sorted_distinct(array_agg(t.id)) AS ids
    FROM public.transcripts AS t
    WHERE t.user_id = p_user AND t.project_id = ANY(p_project_ids)
  )
  SELECT
    branch.ids,
    public.sorted_distinct(ARRAY(
      SELECT f.name FROM public.transcript_folder_objects(p_user, branch.ids) AS f
      WHERE f.bucket_id = 'media'
    )),
    public.sorted_distinct(ARRAY(
      SELECT f.name FROM public.transcript_folder_objects(p_user, branch.ids) AS f
      WHERE f.bucket_id = 'waveforms'
    )),
    public.sorted_distinct(ARRAY(
      SELECT f.name FROM public.transcript_folder_objects(p_user, branch.ids) AS f
      WHERE f.bucket_id = 'transcription-results'
    ))
  FROM branch;
$$;

CREATE FUNCTION public.begin_project_delete(p_id uuid)
RETURNS TABLE (
  project_ids uuid[],
  transcript_ids uuid[],
  media_keys text[],
  waveform_keys text[],
  result_keys text[]
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid := auth.uid();
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
$$;

-- ---------------------------------------------------------------------------
-- 5. Function grants for the recreated functions.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.transcript_delete_inventory(uuid[]) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.project_branch_inventory(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.begin_project_delete(uuid) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.transcript_delete_inventory(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.begin_project_delete(uuid) TO authenticated;
