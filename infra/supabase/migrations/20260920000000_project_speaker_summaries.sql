-- Speaker avatar summaries for the Library project cards and the project header.
--
-- Both surfaces render up to p_preview_limit speaker avatars plus a "+N" badge.
-- The colours must match the transcript editor exactly, so palette_index here is
-- the speaker's 0-based position among ALL speakers of its transcript ordered
-- (created_at, id) -- the ordering fetchSpeakers() uses -- computed BEFORE
-- speakers with no segments are filtered out. That is what makes the summary
-- agree with the editor: an unused speaker occupies its palette slot in both.
--
-- Scope:
--   p_include_descendants = true  -> the project's active branch (self +
--       descendants). A project with deleting_at set is pruned together with its
--       whole subtree, matching activeBranchIds() in core/projects/tree.ts.
--   p_include_descendants = false -> that project's direct transcripts only.
--
-- A "speaker" is a distinct speakers.id referenced by at least one
-- segments.speaker_id. Unused speaker rows and segments with a NULL speaker_id
-- do not count; several segments from one speaker count once. Speakers are never
-- de-duplicated by label: the same person in two transcripts is two speakers,
-- because the schema cannot currently tell that they are one person.
--
-- One row per requested, RLS-visible, non-deleting project id -- including
-- projects with no speakers (speaker_count 0, preview '[]'). Requested ids the
-- caller does not own are simply absent: SECURITY INVOKER means the projects RLS
-- policy (user_id = auth.uid()) already filters them out, so no explicit
-- ownership predicate is needed here.

CREATE INDEX IF NOT EXISTS idx_segments_transcript_speaker
  ON public.segments (transcript_id, speaker_id)
  WHERE speaker_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.project_speaker_summaries(
  p_project_ids uuid[],
  p_include_descendants boolean,
  p_preview_limit integer DEFAULT 4
)
RETURNS TABLE (
  project_id uuid,
  speaker_count integer,
  preview jsonb
)
STABLE
SECURITY INVOKER
SET search_path = public
LANGUAGE sql
AS $$
  WITH RECURSIVE
  -- DISTINCT so a caller passing the same id twice gets one row, and a NULL or
  -- empty array yields no rows at all rather than an error.
  requested AS (
    SELECT DISTINCT r.id
    FROM unnest(COALESCE(p_project_ids, '{}'::uuid[])) AS r(id)
    WHERE r.id IS NOT NULL
  ),
  -- RLS on public.projects restricts this to the caller's own rows. A project
  -- marked for deletion is dropped here, so it is absent from the result
  -- entirely rather than reported with a zero count.
  emitted AS (
    SELECT p.id
    FROM public.projects AS p
    JOIN requested AS q ON q.id = p.id
    WHERE p.deleting_at IS NULL
  ),
  -- Fresh recursion rather than public.project_branch_ids(): that function is
  -- REVOKEd from PUBLIC and never granted to authenticated, so a SECURITY
  -- INVOKER caller cannot execute it, and it deliberately does not prune
  -- deleting_at. Pruning happens DURING recursion, so a deleting project takes
  -- its whole subtree with it -- post-filtering would keep its grandchildren.
  branch AS (
    SELECT e.id AS root_id, e.id AS scope_project_id
    FROM emitted AS e
    UNION ALL
    SELECT b.root_id, c.id
    FROM branch AS b
    JOIN public.projects AS c ON c.parent_id = b.scope_project_id
    WHERE c.deleting_at IS NULL
      AND COALESCE(p_include_descendants, false)
  ) CYCLE scope_project_id SET is_cycle USING path,
  -- This DISTINCT is not cosmetic: count(*) below is a distinct-speaker count
  -- only because (root_id, scope_project_id) is unique here and a transcript has
  -- exactly one project_id. Drop it and both counts and avatars duplicate.
  scope AS (
    SELECT DISTINCT b.root_id, b.scope_project_id
    FROM branch AS b
    WHERE NOT b.is_cycle
  ),
  scope_transcripts AS (
    SELECT s.root_id, t.id AS transcript_id, t.updated_at
    FROM scope AS s
    JOIN public.transcripts AS t ON t.project_id = s.scope_project_id
  ),
  -- Palette index over EVERY speaker of the transcript, before the "referenced
  -- by a segment" filter below. The IN () de-duplicates, so a transcript
  -- reachable from two requested roots is ranked exactly once.
  ranked_speakers AS (
    SELECT
      sp.id,
      sp.transcript_id,
      sp.label,
      sp.color,
      sp.created_at,
      (row_number() OVER (
        PARTITION BY sp.transcript_id
        ORDER BY sp.created_at, sp.id
      ) - 1)::integer AS palette_index
    FROM public.speakers AS sp
    WHERE sp.transcript_id IN (SELECT st.transcript_id FROM scope_transcripts AS st)
  ),
  -- EXISTS rather than a DISTINCT pre-aggregation over segments: this is a
  -- semi-join that stops at the first matching segment per speaker, and
  -- idx_segments_transcript_speaker covers both correlation columns.
  used_speakers AS (
    SELECT rs.*
    FROM ranked_speakers AS rs
    WHERE EXISTS (
      SELECT 1
      FROM public.segments AS sg
      WHERE sg.transcript_id = rs.transcript_id
        AND sg.speaker_id = rs.id
    )
  ),
  ordered AS (
    SELECT
      st.root_id,
      us.id,
      us.transcript_id,
      us.label,
      us.color,
      us.palette_index,
      row_number() OVER (
        PARTITION BY st.root_id
        ORDER BY st.updated_at DESC, st.transcript_id, us.created_at, us.id
      ) AS rn
    FROM scope_transcripts AS st
    JOIN used_speakers AS us ON us.transcript_id = st.transcript_id
  ),
  aggregated AS (
    SELECT
      o.root_id,
      count(*)::integer AS speaker_count,
      -- ORDER BY belongs inside the aggregate; an ordering in an upstream CTE is
      -- not binding on jsonb_agg. COALESCE because jsonb_agg returns NULL for an
      -- empty group, which a preview limit of 0 produces.
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id',           o.id,
            'transcriptId', o.transcript_id,
            'label',        o.label,
            'color',        o.color,
            'paletteIndex', o.palette_index
          )
          ORDER BY o.rn
        ) FILTER (WHERE o.rn <= LEAST(GREATEST(COALESCE(p_preview_limit, 4), 0), 4)),
        '[]'::jsonb
      ) AS preview
    FROM ordered AS o
    GROUP BY o.root_id
  )
  -- Positional output: RETURNS TABLE makes project_id / speaker_count / preview
  -- visible as parameters inside this body, so every column reference above is
  -- qualified and none are aliased here.
  SELECT
    e.id,
    COALESCE(a.speaker_count, 0),
    COALESCE(a.preview, '[]'::jsonb)
  FROM emitted AS e
  LEFT JOIN aggregated AS a ON a.root_id = e.id;
$$;

COMMENT ON FUNCTION public.project_speaker_summaries(uuid[], boolean, integer) IS
'Per-project speaker avatar summary: the distinct speakers referenced by segments
in a project''s direct transcripts (or its whole active branch), carrying the
palette index each speaker has in the transcript editor, plus a bounded preview
slice. SECURITY INVOKER -- RLS performs the ownership filtering.';

-- 20260814000000_explicit_data_api_grants.sql already strips the PUBLIC default,
-- so the revokes are belt-and-braces; the grant is mandatory. service_role is
-- deliberately NOT granted: it bypasses RLS and auth.uid() is NULL for it, so a
-- server-side call would return every requested project regardless of owner.
REVOKE ALL ON FUNCTION public.project_speaker_summaries(uuid[], boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.project_speaker_summaries(uuid[], boolean, integer) FROM anon;
REVOKE ALL ON FUNCTION public.project_speaker_summaries(uuid[], boolean, integer) FROM service_role;
GRANT EXECUTE ON FUNCTION public.project_speaker_summaries(uuid[], boolean, integer) TO authenticated;
