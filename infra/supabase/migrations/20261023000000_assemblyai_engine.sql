-- AssemblyAI becomes the third transcription engine (contracts/transcription-options.ts,
-- whose engine list this CHECK repeats; what it can do is in
-- core/transcription/engines/capabilities.ts).
--
-- AssemblyAI keeps "um" and "uh" in every language whatever it is asked
-- (Universal-3.5 Pro), and is asked to for Russian (Universal-2), so its
-- transcripts always record them kept. It masks profanity in every language but
-- Russian, which it refuses. The browser inserts transcripts too, so the
-- database holds these rather than trusting the dialog. Every existing row is a
-- Deepgram or Soniox one and already satisfies the new checks.

ALTER TABLE public.transcripts
  DROP CONSTRAINT transcripts_engine_check,
  ADD CONSTRAINT transcripts_engine_check
    CHECK (engine IN ('deepgram', 'soniox', 'assemblyai')),
  -- Kept only by Deepgram in English, and by AssemblyAI.
  DROP CONSTRAINT transcripts_filler_words_supported,
  ADD CONSTRAINT transcripts_filler_words_supported
    CHECK (keep_filler_words IS NOT TRUE OR (engine = 'deepgram' AND language = 'en') OR engine = 'assemblyai'),
  -- AssemblyAI can't leave them out: neither false nor unrecorded.
  ADD CONSTRAINT transcripts_filler_words_always_kept
    CHECK (engine <> 'assemblyai' OR keep_filler_words IS TRUE),
  -- Masked by Deepgram, and by AssemblyAI except in Russian.
  DROP CONSTRAINT transcripts_profanity_supported,
  ADD CONSTRAINT transcripts_profanity_supported
    CHECK (mask_profanity = false OR engine = 'deepgram' OR (engine = 'assemblyai' AND language <> 'ru')),
  -- The model that really made the transcript, when the engine says
  -- (AssemblyAI falls back from Universal-3.5 Pro to Universal-2 for Russian).
  -- Written by the pipeline only: authenticated gets no INSERT or UPDATE on it,
  -- and reads it with the rest of the row.
  ADD COLUMN engine_model TEXT;
