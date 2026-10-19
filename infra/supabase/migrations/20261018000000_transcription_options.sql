-- Transcription options: how a transcript is made, chosen in the capture
-- dialog (contracts/transcription-options.ts). The browser sets them when it
-- creates the transcript and can never change them afterwards: they are
-- granted for INSERT only.
--
-- Existing rows keep a true record. Before this migration no language was sent
-- (Deepgram used English), speakers were always detected and profanity was
-- never masked, so those defaults hold for every row. Filler words were kept
-- only from 2026-10-10 (commit 2834a9e); a completed transcript may predate
-- that, so its keep_filler_words is NULL, meaning not recorded. A transcript
-- not yet completed will keep them when it starts, so it gets true.

ALTER TABLE public.transcripts
  ADD COLUMN language TEXT NOT NULL DEFAULT 'en'
    CONSTRAINT transcripts_language_check
    CHECK (language IN ('en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'ja', 'hi', 'ru', 'multi')),
  ADD COLUMN detect_speakers BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN keep_filler_words BOOLEAN DEFAULT true,
  ADD COLUMN mask_profanity BOOLEAN NOT NULL DEFAULT false,
  -- Deepgram keeps "um" and "uh" only in English, so no other language can
  -- record them kept.
  ADD CONSTRAINT transcripts_filler_words_english_only
    CHECK (keep_filler_words IS NOT TRUE OR language = 'en');

-- A backfill, not an edit: updated_at and the column guards stay out of it.
ALTER TABLE public.transcripts DISABLE TRIGGER USER;
UPDATE public.transcripts SET keep_filler_words = NULL WHERE status = 'completed';
ALTER TABLE public.transcripts ENABLE TRIGGER USER;

GRANT INSERT (language, detect_speakers, keep_filler_words, mask_profanity)
  ON TABLE public.transcripts TO authenticated;
