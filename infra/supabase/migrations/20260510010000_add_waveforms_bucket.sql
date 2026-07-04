-- Separate bucket for precomputed waveform peak artifacts (JSON files).
-- Lives alongside the media bucket but with its own MIME allowlist —
-- mixing JSON into the audio/video media bucket would force a permanent
-- relaxation of that bucket's content-type constraints.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'waveforms',
    'waveforms',
    false,
    1048576,  -- 1MB; real artifacts are ~20KB
    ARRAY['application/json']
)
ON CONFLICT (id) DO NOTHING;

-- Users can read their own waveform files via signed URLs.
-- Path convention: {user_id}/{project_id}/waveform.json — first folder = user_id.
CREATE POLICY "Users can read own waveforms"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'waveforms' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

-- No INSERT/UPDATE policies for end users. Writes happen via the admin
-- client (service_role bypasses RLS); the BEFORE UPDATE trigger on projects
-- enforces that waveform_object_key is server-owned.
--
-- A user-scoped DELETE policy is added later in
-- 20260704000000_allow_waveform_delete.sql so clients can clean up their own
-- waveform artifact when deleting a transcript.
