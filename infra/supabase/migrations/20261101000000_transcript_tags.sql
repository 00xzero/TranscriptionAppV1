-- Tags on transcripts: each account's own named, coloured labels, any number
-- per transcript.
--
-- Both tables stay read-only to signed-in users. Every write goes through a
-- definer function below that checks the caller with current_user_id(). Each
-- write is phrased as "make it so": a resend whose first attempt already
-- succeeded finds that result and answers as if it had just made it.
--
-- Locking order, everywhere: tag rows first (two at once in ascending id
-- order), then the transcript, then links. Adding a link takes the tag FOR
-- SHARE; changing or removing a tag takes it FOR UPDATE.
--
-- SQLSTATEs follow the people migrations: SP001 not found (or not the
-- caller's), SP002 changed since it was read, SP003 invalid input.

CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tags_id_user_unique UNIQUE (id, user_id),
  -- Mirrors TEXT_LIMITS.tagName in frontend/contracts/limits.ts.
  CONSTRAINT tags_name_valid CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 50),
  CONSTRAINT tags_color_valid CHECK (color = ANY (public.speaker_palette()))
);
CREATE UNIQUE INDEX tags_user_name_unique ON public.tags (user_id, lower(name));
CREATE TRIGGER update_tags_updated_at BEFORE UPDATE ON public.tags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Deleting a transcript or a tag takes its links with it, so delete_transcript
-- and finish_project_delete need no change.
CREATE TABLE public.transcript_tags (
  transcript_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transcript_tags_pkey PRIMARY KEY (transcript_id, tag_id),
  CONSTRAINT transcript_tags_transcript_owner_fk FOREIGN KEY (transcript_id, user_id)
    REFERENCES public.transcripts (id, user_id) ON DELETE CASCADE,
  CONSTRAINT transcript_tags_tag_owner_fk FOREIGN KEY (tag_id, user_id)
    REFERENCES public.tags (id, user_id) ON DELETE CASCADE
);
CREATE INDEX transcript_tags_tag_id_idx ON public.transcript_tags (tag_id);
CREATE INDEX transcript_tags_user_id_idx ON public.transcript_tags (user_id);

REVOKE ALL ON TABLE public.tags FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.transcript_tags FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tags, public.transcript_tags TO authenticated;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tags" ON public.tags FOR SELECT TO authenticated
  USING (user_id = (SELECT public.current_user_id()));
CREATE POLICY "Users can view own transcript tags" ON public.transcript_tags FOR SELECT TO authenticated
  USING (user_id = (SELECT public.current_user_id()));

-- -------------------------------------------------------------------------
-- Links on one transcript
-- -------------------------------------------------------------------------

-- Puts a tag on a transcript. Already there counts as done.
CREATE FUNCTION public.add_transcript_tag(p_transcript_id uuid, p_tag_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.tags WHERE id = p_tag_id AND user_id = v_user FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tag not found' USING ERRCODE = 'SP001'; END IF;
  PERFORM 1 FROM public.transcripts WHERE id = p_transcript_id AND user_id = v_user FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transcript not found' USING ERRCODE = 'SP001'; END IF;
  INSERT INTO public.transcript_tags (transcript_id, tag_id, user_id)
  VALUES (p_transcript_id, p_tag_id, v_user)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Takes a tag off a transcript. Not there (or gone with its tag) counts as done.
CREATE FUNCTION public.remove_transcript_tag(p_transcript_id uuid, p_tag_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.tags WHERE id = p_tag_id AND user_id = v_user FOR SHARE;
  DELETE FROM public.transcript_tags
  WHERE transcript_id = p_transcript_id AND tag_id = p_tag_id AND user_id = v_user;
END;
$$;

-- Creates a tag under the id the client chose and puts it on the transcript.
-- outcome:
--   own      a tag already has this id: a resend (even one overlapping the
--            first attempt), or the redo of a kept tag
--   adopted  another tag already has this name (ignoring case); it is used
--   created  the tag is new
-- A tag renamed or deleted between the insert and the name lookup (READ
-- COMMITTED) sends it round again; three misses refuse with SP002.
CREATE FUNCTION public.create_transcript_tag(p_transcript_id uuid, p_tag_id uuid, p_name text, p_color text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_name text := regexp_replace(p_name, '^\s+|\s+$', '', 'g');
  v_tag public.tags;
  v_outcome text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF p_tag_id IS NULL THEN RAISE EXCEPTION 'choose a tag id' USING ERRCODE = 'SP003'; END IF;
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'tag names must be 1 to 50 characters' USING ERRCODE = 'SP003';
  END IF;
  IF p_color IS NULL OR NOT (p_color = ANY (public.speaker_palette())) THEN
    RAISE EXCEPTION 'choose a palette colour' USING ERRCODE = 'SP003';
  END IF;
  PERFORM 1 FROM public.transcripts WHERE id = p_transcript_id AND user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'transcript not found' USING ERRCODE = 'SP001'; END IF;

  FOR v_try IN 1..3 LOOP
    SELECT * INTO v_tag FROM public.tags WHERE id = p_tag_id FOR SHARE;
    IF FOUND THEN
      IF v_tag.user_id <> v_user THEN RAISE EXCEPTION 'tag id in use' USING ERRCODE = 'SP003'; END IF;
      v_outcome := 'own';
      EXIT;
    END IF;
    INSERT INTO public.tags (id, user_id, name, color)
    VALUES (p_tag_id, v_user, v_name, p_color)
    ON CONFLICT DO NOTHING
    RETURNING * INTO v_tag;
    IF FOUND THEN
      v_outcome := 'created';
      EXIT;
    END IF;
    SELECT * INTO v_tag FROM public.tags
    WHERE user_id = v_user AND lower(name) = lower(v_name)
    FOR SHARE;
    IF FOUND THEN
      -- An overlapping resend of this same create committed it while this
      -- one waited at the insert: still this step's own tag.
      v_outcome := CASE WHEN v_tag.id = p_tag_id THEN 'own' ELSE 'adopted' END;
      EXIT;
    END IF;
  END LOOP;
  IF v_outcome IS NULL THEN
    RAISE EXCEPTION 'tags changed while this one was created' USING ERRCODE = 'SP002';
  END IF;

  PERFORM 1 FROM public.transcripts WHERE id = p_transcript_id AND user_id = v_user FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transcript not found' USING ERRCODE = 'SP001'; END IF;
  INSERT INTO public.transcript_tags (transcript_id, tag_id, user_id)
  VALUES (p_transcript_id, v_tag.id, v_user)
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('tag', to_jsonb(v_tag), 'outcome', v_outcome);
END;
$$;

-- Undoes creating a tag on a transcript.
--   gone     the tag no longer exists: nothing to do
--   kept     another transcript uses it now: it comes off this one only
--   deleted  the tag is deleted
CREATE FUNCTION public.undo_created_tag(p_transcript_id uuid, p_tag_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.tags WHERE id = p_tag_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RETURN 'gone'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.transcript_tags
    WHERE tag_id = p_tag_id AND transcript_id IS DISTINCT FROM p_transcript_id
  ) THEN
    DELETE FROM public.transcript_tags WHERE transcript_id = p_transcript_id AND tag_id = p_tag_id;
    RETURN 'kept';
  END IF;
  DELETE FROM public.tags WHERE id = p_tag_id;
  RETURN 'deleted';
END;
$$;

-- -------------------------------------------------------------------------
-- The tag itself: every transcript that has it
-- -------------------------------------------------------------------------

-- Renames a tag read as p_expected_name. Already named p_name counts as done;
-- any other name refuses with SP002. A name another tag has fails with 23505.
CREATE FUNCTION public.rename_tag(p_tag_id uuid, p_expected_name text, p_name text)
RETURNS public.tags
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_name text := regexp_replace(p_name, '^\s+|\s+$', '', 'g');
  v_tag public.tags;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'tag names must be 1 to 50 characters' USING ERRCODE = 'SP003';
  END IF;
  SELECT * INTO v_tag FROM public.tags WHERE id = p_tag_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tag not found' USING ERRCODE = 'SP001'; END IF;
  IF v_tag.name = v_name THEN RETURN v_tag; END IF;
  IF v_tag.name IS DISTINCT FROM p_expected_name THEN
    RAISE EXCEPTION 'tag name changed since it was read' USING ERRCODE = 'SP002';
  END IF;
  UPDATE public.tags SET name = v_name WHERE id = p_tag_id RETURNING * INTO v_tag;
  RETURN v_tag;
END;
$$;

-- Recolours a tag read as p_expected_color, as rename_tag renames.
CREATE FUNCTION public.set_tag_color(p_tag_id uuid, p_expected_color text, p_color text)
RETURNS public.tags
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_tag public.tags;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF p_color IS NULL OR NOT (p_color = ANY (public.speaker_palette())) THEN
    RAISE EXCEPTION 'choose a palette colour' USING ERRCODE = 'SP003';
  END IF;
  SELECT * INTO v_tag FROM public.tags WHERE id = p_tag_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tag not found' USING ERRCODE = 'SP001'; END IF;
  IF v_tag.color = p_color THEN RETURN v_tag; END IF;
  IF v_tag.color IS DISTINCT FROM p_expected_color THEN
    RAISE EXCEPTION 'tag colour changed since it was read' USING ERRCODE = 'SP002';
  END IF;
  UPDATE public.tags SET color = p_color WHERE id = p_tag_id RETURNING * INTO v_tag;
  RETURN v_tag;
END;
$$;

-- Deletes a tag and takes it off every transcript. Whether it still existed:
-- already gone counts as done.
CREATE FUNCTION public.delete_tag(p_tag_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.tags WHERE id = p_tag_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  DELETE FROM public.tags WHERE id = p_tag_id;
  RETURN true;
END;
$$;

-- Folds p_from into p_into: every transcript tagged p_from is tagged p_into
-- instead, and p_from is deleted. merged is false when p_from was already
-- gone (a resend, or deleted elsewhere); the caller then reloads.
CREATE FUNCTION public.merge_tags(p_from uuid, p_into uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := (SELECT public.current_user_id());
  v_id uuid;
  v_into public.tags;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_into IS NULL OR p_from = p_into THEN
    RAISE EXCEPTION 'choose two different tags' USING ERRCODE = 'SP003';
  END IF;
  FOR v_id IN SELECT unnest(ARRAY[p_from, p_into]) ORDER BY 1 LOOP
    PERFORM 1 FROM public.tags WHERE id = v_id AND user_id = v_user FOR UPDATE;
  END LOOP;
  SELECT * INTO v_into FROM public.tags WHERE id = p_into AND user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'tag not found' USING ERRCODE = 'SP001'; END IF;
  PERFORM 1 FROM public.tags WHERE id = p_from AND user_id = v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('tag', to_jsonb(v_into), 'merged', false);
  END IF;
  INSERT INTO public.transcript_tags (transcript_id, tag_id, user_id, created_at)
  SELECT transcript_id, p_into, user_id, created_at
  FROM public.transcript_tags
  WHERE tag_id = p_from
  ON CONFLICT DO NOTHING;
  DELETE FROM public.tags WHERE id = p_from;
  RETURN jsonb_build_object('tag', to_jsonb(v_into), 'merged', true);
END;
$$;

-- service_role gets nothing: current_user_id() is NULL for it.
REVOKE ALL ON FUNCTION public.add_transcript_tag(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.add_transcript_tag(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_transcript_tag(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.remove_transcript_tag(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_transcript_tag(uuid, uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_transcript_tag(uuid, uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.undo_created_tag(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.undo_created_tag(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.rename_tag(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rename_tag(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.set_tag_color(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_tag_color(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_tag(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_tag(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.merge_tags(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.merge_tags(uuid, uuid) TO authenticated;
