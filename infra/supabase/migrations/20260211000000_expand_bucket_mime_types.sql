-- ============================================================================
-- Expand media bucket allowed_mime_types with browser MIME aliases
-- 
-- Browsers report non-canonical MIME types for certain file formats:
--   macOS/Safari:  .m4a → audio/x-m4a
--   Some browsers: .m4a → audio/m4a  
--   Some browsers: .wav → audio/x-wav
--   Some browsers: .mp3 → audio/mp3
--   Some browsers: .flac → audio/x-flac
--   Some browsers: .m4v → video/x-m4v
--
-- Supabase storage validates uploads against allowed_mime_types independently
-- of the contentType header, so both canonical types AND browser aliases must
-- be in the allowlist.
--
-- The frontend getMimeType() normalizer in useCapture.ts also maps these
-- aliases to canonical types as defense-in-depth.
-- ============================================================================

UPDATE storage.buckets AS b
SET allowed_mime_types = (
    SELECT ARRAY(
        SELECT DISTINCT mime_type
        FROM unnest(
            COALESCE(b.allowed_mime_types, ARRAY[]::text[]) ||
            ARRAY[
                'audio/x-m4a', 'audio/m4a', 'audio/x-wav', 'audio/mp3', 'audio/x-flac',
                'video/x-m4v'
            ]::text[]
        ) AS mime_type
        ORDER BY mime_type
    )
)
WHERE b.id = 'media';
