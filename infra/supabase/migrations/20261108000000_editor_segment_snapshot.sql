-- A single statement sees one shape even when another tab splits or joins.
-- NULL means the transcript is unavailable to this account; [] means it is empty.
CREATE FUNCTION public.get_editor_segment_snapshot(p_transcript_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.start_ms, s.id)
    FROM public.segments s
    WHERE s.transcript_id = t.id
  ), '[]'::jsonb)
  FROM public.transcripts t
  WHERE t.id = p_transcript_id;
$$;

REVOKE ALL ON FUNCTION public.get_editor_segment_snapshot(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_editor_segment_snapshot(uuid) TO authenticated;
