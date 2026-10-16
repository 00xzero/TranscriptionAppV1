-- Uploads may be up to 500 MB. Since media preparation (handle-media-prepare)
-- keeps only the sound of a video and repacks oversized sound, the original's
-- size is no longer what is stored; this bounds the upload itself. Matches
-- NEXT_PUBLIC_MAX_FILE_SIZE_MB=500 and config.toml.
--
-- This UPDATE does not check the project's global upload limit (hosted:
-- Storage Settings), which caps every bucket. On a hosted project, raise that
-- to at least 500 MB too; until then a larger file is refused as its upload
-- starts, and the browser says it is larger than storage accepts.

UPDATE storage.buckets
SET file_size_limit = 524288000
WHERE id = 'media';
