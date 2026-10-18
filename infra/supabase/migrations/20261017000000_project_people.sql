-- The project page's people dialog: who speaks in a project and every project
-- nested in it. Read-only; no table changes shape and no row is rewritten.
--
-- It counts exactly as project_speaker_summaries does with the whole branch in
-- scope, so the header's "N speakers" and the dialog list the same identities:
-- a linked person once, however many transcripts and voices carry them, and
-- every unlinked voice on its own. A speaker counts once a segment references
-- it. A person's transcripts are read with list_person_appearances, unchanged.
--
-- SQLSTATEs follow the earlier speaker migrations: SP001 not found (or not the
-- caller's).

-- One JSON result avoids row-limit truncation. Definer rights, as the other
-- People reads have; every query filters on the caller explicitly.
--
--   people: each linked person with their transcripts in the branch, speaking
--           time there (summed segment length) and the created_at of the newest
--           such transcript. Most transcripts first, then most speaking time.
--           Hidden people are listed: hiding only affects suggestions.
--   voices: each transcript with unlinked voices, newest first, with those
--           voices and the transcript's identities in order of first appearance
--           (the summary's peers), so the client labels a voice as the editor
--           does.
CREATE FUNCTION public.project_people(p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = p_project_id AND user_id = v_user AND deleting_at IS NULL
  ) THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'SP001';
  END IF;

  RETURN (
    WITH RECURSIVE
    -- The active branch: a project being deleted takes its whole subtree out,
    -- as in the summaries.
    branch AS (
      SELECT p_project_id AS id
      UNION ALL
      SELECT c.id
      FROM public.projects AS c
      JOIN branch AS b ON c.parent_id = b.id
      WHERE c.user_id = v_user AND c.deleting_at IS NULL
    ) CYCLE id SET is_cycle USING path,
    scope_transcripts AS (
      SELECT t.id, t.title, t.project_id, t.created_at
      FROM public.transcripts AS t
      WHERE t.user_id = v_user
        AND t.project_id IN (SELECT b.id FROM branch AS b WHERE NOT b.is_cycle)
    ),
    -- Each transcript speaker a segment references, read once: its speaking
    -- time and its first segment in transcript order (start_ms, then id, as
    -- the editor sorts segments).
    speaker_talk AS (
      SELECT sg.transcript_id, sg.speaker_id,
        sum(greatest(sg.end_ms - sg.start_ms, 0))::bigint AS talk_ms,
        min(sg.start_ms) AS first_start_ms,
        (array_agg(sg.id ORDER BY sg.start_ms, sg.id))[1] AS first_segment_id
      FROM public.segments AS sg
      WHERE sg.transcript_id IN (SELECT st.id FROM scope_transcripts AS st)
        AND sg.speaker_id IS NOT NULL
      GROUP BY sg.transcript_id, sg.speaker_id
    ),
    used_speakers AS (
      SELECT talk.transcript_id, talk.speaker_id, talk.talk_ms,
        talk.first_start_ms, talk.first_segment_id,
        sp.ordinal, sp.custom_label, sp.person_id
      FROM speaker_talk AS talk
      JOIN public.speakers AS sp ON sp.id = talk.speaker_id AND sp.transcript_id = talk.transcript_id
    ),
    listed_people AS (
      SELECT us.person_id,
        count(DISTINCT us.transcript_id)::integer AS transcript_count,
        sum(us.talk_ms)::bigint AS talk_ms,
        max(st.created_at) AS last_seen_at
      FROM used_speakers AS us
      JOIN scope_transcripts AS st ON st.id = us.transcript_id
      WHERE us.person_id IS NOT NULL
      GROUP BY us.person_id
    ),
    transcript_peers AS (
      SELECT us.transcript_id,
        jsonb_agg(jsonb_build_object(
            'id',               us.speaker_id,
            'ordinal',          us.ordinal,
            'customLabel',      us.custom_label,
            'personId',         us.person_id,
            'personName',       pe.name,
            'organisationName', og.name
          ) ORDER BY us.first_start_ms, us.first_segment_id) AS peers,
        jsonb_agg(us.speaker_id ORDER BY us.first_start_ms, us.first_segment_id)
          FILTER (WHERE us.person_id IS NULL) AS voice_ids
      FROM used_speakers AS us
      LEFT JOIN public.people AS pe ON pe.id = us.person_id
      LEFT JOIN public.organisations AS og ON og.id = pe.organisation_id
      GROUP BY us.transcript_id
    )
    SELECT jsonb_build_object(
      'people', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', pe.id, 'name', pe.name, 'preferred_color', pe.preferred_color,
            'organisation_name', og.name, 'hidden', pe.hidden,
            'transcript_count', lp.transcript_count, 'talk_ms', lp.talk_ms,
            'last_seen_at', lp.last_seen_at)
          ORDER BY lp.transcript_count DESC, lp.talk_ms DESC, lower(pe.name), pe.id)
        FROM listed_people AS lp
        JOIN public.people AS pe ON pe.id = lp.person_id AND pe.user_id = v_user
        LEFT JOIN public.organisations AS og ON og.id = pe.organisation_id
      ), '[]'::jsonb),
      'voices', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'transcript_id', st.id, 'title', st.title, 'project_id', st.project_id,
            'created_at', st.created_at, 'voice_ids', tp.voice_ids, 'peers', tp.peers)
          ORDER BY st.created_at DESC, st.id)
        FROM transcript_peers AS tp
        JOIN scope_transcripts AS st ON st.id = tp.transcript_id
        WHERE tp.voice_ids IS NOT NULL
      ), '[]'::jsonb)
    )
  );
END;
$$;

COMMENT ON FUNCTION public.project_people(uuid) IS
'The people and unlinked voices in a project''s active branch, counted as
project_speaker_summaries counts them, for the project page''s people dialog.';

-- Only signed-in users; service_role gets nothing because auth.uid() is NULL for it.
REVOKE ALL ON FUNCTION public.project_people(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.project_people(uuid) TO authenticated;
