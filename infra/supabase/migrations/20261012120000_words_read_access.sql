-- Words read access.
--
-- The words table is the fixed record of what Deepgram heard: each word's
-- text and timing, written once by save_transcript_segments. The editor reads
-- it to line edited segment text up against those timings, so signed-in users
-- need SELECT on their own transcripts' words, and nothing more.
--
-- 20260814000000_explicit_data_api_grants revoked every authenticated
-- privilege on words and restored them only for service_role, which left the
-- original FOR ALL policy with no grant behind it.

GRANT SELECT ON TABLE public.words TO authenticated;

-- Defensive: words are written only by save_transcript_segments (service
-- role) and removed only by the segments foreign-key cascade.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.words FROM authenticated;

DROP POLICY "Users can access own transcript words" ON public.words;
CREATE POLICY "Users can read own transcript words"
  ON public.words FOR SELECT TO authenticated
  USING (segment_id IN (
    SELECT s.id
    FROM public.segments AS s
    JOIN public.transcripts AS t ON t.id = s.transcript_id
    WHERE t.user_id = (SELECT auth.uid())
  ));
