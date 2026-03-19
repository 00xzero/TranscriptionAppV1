-- =========================================================================
-- Reconcile transition_job_status after partial/manual state-machine rollout
-- =========================================================================

-- Some environments already have 20260318000000 objects without the updated
-- ownership check and restricted grants. This follow-up migration is
-- intentionally idempotent and only patches the RPC + permissions.

CREATE OR REPLACE FUNCTION transition_job_status(
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
  v_project_id UUID;
  v_valid_targets TEXT[];
  v_rows_updated INT;
  v_caller_uid UUID;
BEGIN
  -- Read current status with row lock
  SELECT status, project_id INTO v_current_status, v_project_id
  FROM jobs WHERE id = p_job_id FOR UPDATE;

  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid', 'error', 'Job not found');
  END IF;

  -- Ownership check: if called by an authenticated user (not service_role),
  -- verify the caller owns the project associated with this job.
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM projects WHERE id = v_project_id AND user_id = v_caller_uid
    ) THEN
      RETURN jsonb_build_object('outcome', 'invalid', 'error', 'Not authorized');
    END IF;
  END IF;

  -- Idempotent: already at target
  IF v_current_status = p_to_status THEN
    RETURN jsonb_build_object('outcome', 'noop', 'previous_status', v_current_status);
  END IF;

  -- Validate transition
  v_valid_targets := CASE v_current_status
    WHEN 'queued' THEN ARRAY['processing', 'error']
    WHEN 'processing' THEN ARRAY['completed', 'error']
    ELSE ARRAY[]::TEXT[]
  END;

  IF NOT (p_to_status = ANY(v_valid_targets)) THEN
    RETURN jsonb_build_object(
      'outcome', 'invalid',
      'error', format('Invalid transition: %s -> %s', v_current_status, p_to_status),
      'previous_status', v_current_status
    );
  END IF;

  -- Perform update with optimistic lock
  UPDATE jobs SET
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

  -- Write audit event
  INSERT INTO job_events (job_id, from_status, to_status, metadata)
  VALUES (p_job_id, v_current_status, p_to_status,
    p_metadata || jsonb_build_object('context', COALESCE(p_context, 'unknown'))
  );

  RETURN jsonb_build_object('outcome', 'applied', 'previous_status', v_current_status);
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) FROM anon;
REVOKE ALL ON FUNCTION transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION transition_job_status(UUID, TEXT, JSONB, JSONB, TEXT) TO service_role;
