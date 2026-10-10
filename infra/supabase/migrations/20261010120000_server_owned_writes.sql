-- Server-owned writes.
--
-- 1. The authenticated role (the browser, and routes using the server client)
--    keeps only the writes the app makes: pipeline state (jobs, transcript
--    status, duration, waveform fields) and transcript content (segments) are
--    written by the server alone.
-- 2. A transcript owns every object under {user_id}/{transcript_id}/ in the
--    media and waveforms buckets. Deleting a transcript, alone or in a project,
--    requires that folder to be empty, so a row can never be removed while its
--    files are still visible to the check. The check is point-in-time: an
--    upload that commits after it is cleaned by its writer's compensation, a
--    post-delete sweep, or the orphan cleanup script.

-- ---------------------------------------------------------------------------
-- 1. Table grants. A table-level REVOKE also drops that privilege's column
--    grants, so revoke first and then grant the columns the app writes.
-- ---------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON TABLE public.jobs FROM authenticated;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.transcripts FROM authenticated;
GRANT INSERT (user_id, title, project_id, upload_intent_id) ON TABLE public.transcripts TO authenticated;
GRANT UPDATE (title, project_id, source_object_key) ON TABLE public.transcripts TO authenticated;

REVOKE INSERT, DELETE ON TABLE public.segments FROM authenticated;

REVOKE UPDATE, DELETE ON TABLE public.watchlist FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2. Policies name only the commands that are still granted.
-- ---------------------------------------------------------------------------

DROP POLICY "Users can access own transcript jobs" ON public.jobs;
CREATE POLICY "Users can read own transcript jobs"
  ON public.jobs FOR SELECT TO authenticated
  USING (transcript_id IN (SELECT t.id FROM public.transcripts AS t WHERE t.user_id = (SELECT auth.uid())));

DROP POLICY "Users can access own transcript segments" ON public.segments;
CREATE POLICY "Users can read own transcript segments"
  ON public.segments FOR SELECT TO authenticated
  USING (transcript_id IN (SELECT t.id FROM public.transcripts AS t WHERE t.user_id = (SELECT auth.uid())));
CREATE POLICY "Users can edit own transcript segments"
  ON public.segments FOR UPDATE TO authenticated
  USING (transcript_id IN (SELECT t.id FROM public.transcripts AS t WHERE t.user_id = (SELECT auth.uid())))
  WITH CHECK (transcript_id IN (SELECT t.id FROM public.transcripts AS t WHERE t.user_id = (SELECT auth.uid())));

DROP POLICY "Users can access own transcript watchlist" ON public.watchlist;
CREATE POLICY "Users can read own transcript watchlist"
  ON public.watchlist FOR SELECT TO authenticated
  USING (transcript_id IN (SELECT t.id FROM public.transcripts AS t WHERE t.user_id = (SELECT auth.uid())));
CREATE POLICY "Users can add own transcript watchlist terms"
  ON public.watchlist FOR INSERT TO authenticated
  WITH CHECK (transcript_id IN (SELECT t.id FROM public.transcripts AS t WHERE t.user_id = (SELECT auth.uid())));

-- Transcripts are deleted through delete_transcript() and finish_project_delete().
DROP POLICY "Users can delete own transcripts" ON public.transcripts;

-- ---------------------------------------------------------------------------
-- 3. A transcript's files live in its own folder.
-- ---------------------------------------------------------------------------

ALTER TABLE public.transcripts
  ADD CONSTRAINT transcripts_source_object_key_in_folder CHECK (
    source_object_key IS NULL
    OR starts_with(source_object_key, user_id::text || '/' || id::text || '/')
  ),
  ADD CONSTRAINT transcripts_waveform_object_key_in_folder CHECK (
    waveform_object_key IS NULL
    OR waveform_object_key = user_id::text || '/' || id::text || '/waveform.json'
  );

-- ---------------------------------------------------------------------------
-- 4. Server-managed transcript columns. Waveform fields stay server-only, and
--    media is linked once: the browser may set the key from NULL, never clear
--    or replace it, so it cannot drop the reference to a stored file.
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.protect_transcript_waveform_columns()
  RENAME TO protect_transcript_server_columns;
ALTER TRIGGER protect_transcript_waveform_columns_trigger ON public.transcripts
  RENAME TO protect_transcript_server_columns_trigger;

CREATE OR REPLACE FUNCTION public.protect_transcript_server_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' AND (
        NEW.waveform_object_key IS NOT NULL OR
        NEW.waveform_status IS DISTINCT FROM 'skipped' OR
        NEW.waveform_points_per_second IS NOT NULL OR
        NEW.waveform_version IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Waveform fields are server-managed and cannot be inserted by role %', current_user
            USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'UPDATE' AND (
        NEW.waveform_object_key IS DISTINCT FROM OLD.waveform_object_key OR
        NEW.waveform_status IS DISTINCT FROM OLD.waveform_status OR
        NEW.waveform_points_per_second IS DISTINCT FROM OLD.waveform_points_per_second OR
        NEW.waveform_version IS DISTINCT FROM OLD.waveform_version
    ) THEN
        RAISE EXCEPTION 'Waveform fields are server-managed and cannot be updated by role %', current_user
            USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.source_object_key IS NOT NULL
       AND NEW.source_object_key IS DISTINCT FROM OLD.source_object_key THEN
        RAISE EXCEPTION 'Media is already linked to this transcript'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 5. Folder inventory, read from Storage's own metadata so unlinked uploads
--    and in-flight artifacts are included.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.transcript_folder_objects(p_user uuid, p_transcript_ids uuid[])
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
    ON o.bucket_id IN ('media', 'waveforms')
    -- starts_with(name, prefix) as a range ('/' + 1 = '0'), so the
    -- (bucket_id, name COLLATE "C") index serves it.
    AND o.name COLLATE "C" >= f.prefix
    AND o.name COLLATE "C" < left(f.prefix, -1) || '0';
$$;

-- Works when the rows are gone: the folders are the caller's own, so a retry,
-- an upload rollback or a post-delete sweep can still find late files.
CREATE FUNCTION public.transcript_delete_inventory(p_ids uuid[])
RETURNS TABLE (media_keys text[], waveform_keys text[])
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
    COALESCE(array_agg(f.name ORDER BY f.name) FILTER (WHERE f.bucket_id = 'waveforms'), '{}'::text[])
  FROM public.transcript_folder_objects(v_user, p_ids) AS f;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Transcript delete: the row goes only once its folder is empty.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.delete_transcript(p_id uuid)
RETURNS void
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_deleting_at timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT t.project_id INTO v_project_id
  FROM public.transcripts AS t
  WHERE t.id = p_id AND t.user_id = v_user
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transcript not found' USING ERRCODE = 'TR001';
  END IF;

  -- transcripts_project_guard lets the function owner delete inside a branch
  -- marked for deletion (finish_project_delete relies on that), so repeat its
  -- check here.
  IF v_project_id IS NOT NULL THEN
    SELECT p.deleting_at INTO v_deleting_at
    FROM public.projects AS p
    WHERE p.id = v_project_id AND p.user_id = v_user
    FOR SHARE;
    IF v_deleting_at IS NOT NULL THEN
      RAISE EXCEPTION 'project is being deleted' USING ERRCODE = 'PJ002';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.transcript_folder_objects(v_user, ARRAY[p_id])) THEN
    RAISE EXCEPTION 'transcript files still exist' USING ERRCODE = 'TR002';
  END IF;

  DELETE FROM public.transcripts WHERE id = p_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Project delete: the inventory comes from the folders, and finishing
--    requires every folder in the branch to be empty.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.project_branch_inventory(p_user uuid, p_project_ids uuid[])
RETURNS TABLE (transcript_ids uuid[], media_keys text[], waveform_keys text[])
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
    ))
  FROM branch;
$$;

-- The storage keys a caller passed back are meaningless once the inventory
-- comes from Storage, so the signature drops them.
DROP FUNCTION public.finish_project_delete(uuid, uuid[], text[], text[]);

CREATE FUNCTION public.finish_project_delete(p_id uuid, p_transcript_ids uuid[])
RETURNS TABLE (deleted_projects integer, deleted_transcripts integer)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_ids uuid[];
  v_transcript_ids uuid[];
  v_deleted_projects integer;
  v_deleted_transcripts integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  v_ids := public.project_branch_ids(v_user, p_id);
  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'PJ001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.projects
    WHERE user_id = v_user AND id = ANY(v_ids) AND deleting_at IS NULL
  ) THEN
    RAISE EXCEPTION 'project branch is not marked for deletion' USING ERRCODE = 'PJ003';
  END IF;

  -- Lock the branch's transcripts before checking what they own, so no link
  -- or move can land between the checks below and the delete.
  PERFORM 1
  FROM public.transcripts
  WHERE user_id = v_user AND project_id = ANY(v_ids)
  ORDER BY id
  FOR UPDATE;

  SELECT public.sorted_distinct(array_agg(t.id)) INTO v_transcript_ids
  FROM public.transcripts AS t
  WHERE t.user_id = v_user AND t.project_id = ANY(v_ids);

  -- Unreachable while the guards and locks hold; kept so a regression fails loudly.
  IF public.sorted_distinct(p_transcript_ids) IS DISTINCT FROM v_transcript_ids THEN
    RAISE EXCEPTION 'project branch changed after deletion began' USING ERRCODE = 'PJ004';
  END IF;

  IF EXISTS (SELECT 1 FROM public.transcript_folder_objects(v_user, v_transcript_ids)) THEN
    RAISE EXCEPTION 'project files still exist' USING ERRCODE = 'PJ005';
  END IF;

  DELETE FROM public.transcripts
  WHERE user_id = v_user AND id = ANY(v_transcript_ids);
  GET DIAGNOSTICS v_deleted_transcripts = ROW_COUNT;

  DELETE FROM public.projects
  WHERE user_id = v_user AND id = ANY(v_ids);
  GET DIAGNOSTICS v_deleted_projects = ROW_COUNT;

  RETURN QUERY SELECT v_deleted_projects, v_deleted_transcripts;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Function grants.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.transcript_folder_objects(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.transcript_delete_inventory(uuid[]) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.delete_transcript(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.finish_project_delete(uuid, uuid[]) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.transcript_delete_inventory(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_transcript(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_project_delete(uuid, uuid[]) TO authenticated;
