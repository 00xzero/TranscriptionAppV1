-- Allow browser MediaRecorder WebM audio uploads.
--
-- Older environments may have already received audio/webm through edited
-- bootstrap migrations, but deployed databases need a forward migration
-- because already-applied migration versions are not replayed.

UPDATE storage.buckets AS b
SET allowed_mime_types = (
    SELECT array_agg(DISTINCT mime_type ORDER BY mime_type)
    FROM unnest(
        COALESCE(b.allowed_mime_types, ARRAY[]::text[]) ||
        ARRAY['audio/webm']::text[]
    ) AS mime_type
)
WHERE b.id = 'media'
  AND b.allowed_mime_types IS NOT NULL;
