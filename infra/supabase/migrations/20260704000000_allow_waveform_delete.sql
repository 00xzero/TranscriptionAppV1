-- The waveforms bucket intentionally has no INSERT/UPDATE policies for end
-- users (see 20260510010000_add_waveforms_bucket.sql) — waveform artifacts
-- are server-generated only. But without a DELETE policy, deleting a
-- transcript from the client silently leaves its waveform.json orphaned:
-- Postgres RLS makes the delete match zero rows rather than erroring, so
-- storage.objects.remove() reports success while removing nothing.
--
-- Add DELETE only, scoped to the user's own folder, mirroring the media
-- bucket's delete policy. This lets users clean up their own already-
-- generated waveform file without granting any ability to create or
-- modify one.
CREATE POLICY "Users can delete own waveforms"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'waveforms' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );
