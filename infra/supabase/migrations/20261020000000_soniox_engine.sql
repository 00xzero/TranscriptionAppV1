-- Soniox becomes the second transcription engine (contracts/transcription-options.ts,
-- whose engine list this CHECK repeats).
--
-- Soniox keeps no "um" or "uh" and masks no profanity, so a transcript made
-- with it can never record either as on. The browser inserts transcripts too,
-- so the database refuses those combinations rather than trusting the dialog.
-- Every existing row is a Deepgram one and already satisfies the new checks.

ALTER TABLE public.transcripts
  DROP CONSTRAINT transcripts_engine_check,
  ADD CONSTRAINT transcripts_engine_check
    CHECK (engine IN ('deepgram', 'soniox')),
  -- Only Deepgram keeps filler words, and only in English.
  DROP CONSTRAINT transcripts_filler_words_english_only,
  ADD CONSTRAINT transcripts_filler_words_supported
    CHECK (keep_filler_words IS NOT TRUE OR (engine = 'deepgram' AND language = 'en')),
  -- Only Deepgram masks profanity.
  ADD CONSTRAINT transcripts_profanity_supported
    CHECK (mask_profanity = false OR engine = 'deepgram');
