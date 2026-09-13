-- Projects v1: recursive transcript organization and guarded branch deletion.
-- Project workflow SQLSTATEs:
-- PJ001 not found; PJ002 being deleted; PJ003 branch not marked; PJ004 branch changed.

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id uuid,
  name text NOT NULL,
  deleting_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT projects_name_trimmed CHECK (name = btrim(name)),
  CONSTRAINT projects_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT projects_parent_fk
    FOREIGN KEY (parent_id, user_id)
    REFERENCES public.projects (id, user_id)
    ON DELETE NO ACTION
);

CREATE UNIQUE INDEX projects_sibling_name_unique
  ON public.projects (user_id, parent_id, lower(name))
  NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION public.projects_before_insert()
RETURNS trigger
SECURITY INVOKER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleting_at timestamptz;
BEGIN
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'project cannot be its own parent' USING ERRCODE = '23514';
  END IF;

  IF NEW.deleting_at IS NOT NULL THEN
    RAISE EXCEPTION 'new projects cannot be marked for deletion' USING ERRCODE = '42501';
  END IF;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT p.deleting_at
      INTO v_deleting_at
      FROM public.projects AS p
      WHERE p.id = NEW.parent_id
        AND p.user_id = NEW.user_id
      FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'parent project not found' USING ERRCODE = 'PJ001';
    END IF;
    IF v_deleting_at IS NOT NULL THEN
      RAISE EXCEPTION 'project is being deleted' USING ERRCODE = 'PJ002';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.projects_before_update()
RETURNS trigger
SECURITY INVOKER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    RAISE EXCEPTION 'project parent cannot be changed' USING ERRCODE = '23514';
  END IF;

  IF NEW.deleting_at IS DISTINCT FROM OLD.deleting_at
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'project deletion mark is server-managed' USING ERRCODE = '42501';
  END IF;

  IF OLD.deleting_at IS NOT NULL AND NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'project is being deleted' USING ERRCODE = 'PJ002';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.projects_before_delete()
RETURNS trigger
SECURITY INVOKER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.deleting_at IS NOT NULL
     AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'project is being deleted' USING ERRCODE = 'PJ002';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER projects_validate_insert
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_before_insert();

CREATE TRIGGER projects_validate_update
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_before_update();

CREATE TRIGGER projects_validate_delete
  BEFORE DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_before_delete();

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.transcripts
  ADD COLUMN project_id uuid;

ALTER TABLE public.transcripts
  ADD CONSTRAINT transcripts_project_fk
  FOREIGN KEY (project_id, user_id)
  REFERENCES public.projects (id, user_id)
  ON DELETE SET NULL (project_id);

-- Partial: most transcripts are unfiled, and every lookup filters on a project id.
CREATE INDEX transcripts_project_id_idx
  ON public.transcripts (project_id)
  WHERE project_id IS NOT NULL;

-- Project lookups take FOR SHARE, which conflicts with the marking UPDATE in
-- begin_project_delete (the FOR KEY SHARE of a plain foreign-key check does not).
CREATE OR REPLACE FUNCTION public.transcripts_project_guard()
RETURNS trigger
SECURITY INVOKER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleting_at timestamptz;
BEGIN
  -- Leaving a project: deleting the transcript or moving it out.
  IF TG_OP <> 'INSERT' AND OLD.project_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
    SELECT p.deleting_at
      INTO v_deleting_at
      FROM public.projects AS p
      WHERE p.id = OLD.project_id
        AND p.user_id = OLD.user_id
      FOR SHARE;

    -- Only finish_project_delete (owned by postgres) may delete rows in a marked branch.
    IF v_deleting_at IS NOT NULL
       AND NOT (TG_OP = 'DELETE' AND current_user IN ('postgres', 'supabase_admin')) THEN
      RAISE EXCEPTION 'project is being deleted' USING ERRCODE = 'PJ002';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- Entering a project, or linking a file to a transcript inside one.
  IF NEW.project_id IS NOT NULL AND (
    TG_OP = 'INSERT' OR
    NEW.project_id IS DISTINCT FROM OLD.project_id OR
    NEW.source_object_key IS DISTINCT FROM OLD.source_object_key OR
    NEW.waveform_object_key IS DISTINCT FROM OLD.waveform_object_key
  ) THEN
    SELECT p.deleting_at
      INTO v_deleting_at
      FROM public.projects AS p
      WHERE p.id = NEW.project_id
        AND p.user_id = NEW.user_id
      FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'project not found' USING ERRCODE = 'PJ001';
    END IF;
    IF v_deleting_at IS NOT NULL THEN
      RAISE EXCEPTION 'project is being deleted' USING ERRCODE = 'PJ002';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER transcripts_project_guard_trigger
  BEFORE INSERT OR DELETE OR UPDATE OF project_id, source_object_key, waveform_object_key
  ON public.transcripts
  FOR EACH ROW EXECUTE FUNCTION public.transcripts_project_guard();

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own projects"
  ON public.projects FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own projects"
  ON public.projects FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own projects"
  ON public.projects FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own projects"
  ON public.projects FOR DELETE
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.projects
  TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'projects'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.project_branch_ids(p_user uuid, p_id uuid)
RETURNS uuid[]
STABLE
SECURITY INVOKER
SET search_path = public
LANGUAGE sql
AS $$
  WITH RECURSIVE branch(id) AS (
    SELECT p.id
    FROM public.projects AS p
    WHERE p.id = p_id AND p.user_id = p_user
    UNION ALL
    SELECT p.id
    FROM public.projects AS p
    JOIN branch ON p.parent_id = branch.id
    WHERE p.user_id = p_user
  ) CYCLE id SET is_cycle USING path
  SELECT COALESCE(
    array_agg(id ORDER BY id) FILTER (WHERE NOT is_cycle),
    '{}'::uuid[]
  )
  FROM branch;
$$;

-- Set normalization shared by the branch inventory and the finish-time comparison.
CREATE OR REPLACE FUNCTION public.sorted_distinct(p_values anyarray)
RETURNS anyarray
IMMUTABLE
SET search_path = public
LANGUAGE sql
AS $$
  SELECT ARRAY(SELECT DISTINCT v FROM unnest(p_values) AS v WHERE v IS NOT NULL ORDER BY v);
$$;

CREATE OR REPLACE FUNCTION public.project_branch_inventory(p_user uuid, p_project_ids uuid[])
RETURNS TABLE (transcript_ids uuid[], media_keys text[], waveform_keys text[])
STABLE
SECURITY INVOKER
SET search_path = public
LANGUAGE sql
AS $$
  SELECT
    public.sorted_distinct(array_agg(t.id)),
    public.sorted_distinct(array_agg(t.source_object_key)),
    public.sorted_distinct(array_agg(t.waveform_object_key))
  FROM public.transcripts AS t
  WHERE t.user_id = p_user AND t.project_id = ANY(p_project_ids);
$$;

CREATE OR REPLACE FUNCTION public.project_branch_transcript_count(p_id uuid)
RETURNS integer
STABLE
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_ids uuid[];
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  v_ids := public.project_branch_ids(v_user, p_id);
  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'PJ001';
  END IF;
  SELECT count(*)::integer INTO v_count
  FROM public.transcripts
  WHERE user_id = v_user AND project_id = ANY(v_ids);
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_project_delete(p_id uuid)
RETURNS TABLE (
  project_ids uuid[],
  transcript_ids uuid[],
  media_keys text[],
  waveform_keys text[]
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
  SELECT v_ids, i.transcript_ids, i.media_keys, i.waveform_keys
  FROM public.project_branch_inventory(v_user, v_ids) AS i;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_project_delete(
  p_id uuid,
  p_transcript_ids uuid[],
  p_media_keys text[],
  p_waveform_keys text[]
)
RETURNS TABLE (deleted_projects integer, deleted_transcripts integer)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_ids uuid[];
  v_transcript_ids uuid[];
  v_media_keys text[];
  v_waveform_keys text[];
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

  SELECT i.transcript_ids, i.media_keys, i.waveform_keys
    INTO v_transcript_ids, v_media_keys, v_waveform_keys
  FROM public.project_branch_inventory(v_user, v_ids) AS i;

  -- Unreachable while the guards and locks hold; kept so a regression fails loudly.
  IF (public.sorted_distinct(p_transcript_ids),
      public.sorted_distinct(p_media_keys),
      public.sorted_distinct(p_waveform_keys))
     IS DISTINCT FROM (v_transcript_ids, v_media_keys, v_waveform_keys) THEN
    RAISE EXCEPTION 'project branch changed after deletion began' USING ERRCODE = 'PJ004';
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

REVOKE ALL ON FUNCTION public.projects_before_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.projects_before_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.projects_before_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transcripts_project_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.project_branch_ids(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sorted_distinct(anyarray) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.project_branch_inventory(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.project_branch_transcript_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_project_delete(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_project_delete(uuid, uuid[], text[], text[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.project_branch_transcript_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.begin_project_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_project_delete(uuid, uuid[], text[], text[]) TO authenticated;
