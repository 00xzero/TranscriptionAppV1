-- The transcription engine a transcript is made with, chosen with the other
-- transcription options (contracts/transcription-options.ts, whose engine list
-- this CHECK repeats). Like them it is set when the transcript is created and
-- never changed afterwards: it is granted for INSERT only.
--
-- Every existing transcript was made with Deepgram, so the default is a true
-- record for all of them.

ALTER TABLE public.transcripts
  ADD COLUMN engine TEXT NOT NULL DEFAULT 'deepgram'
    CONSTRAINT transcripts_engine_check
    CHECK (engine IN ('deepgram'));

GRANT INSERT (engine) ON TABLE public.transcripts TO authenticated;
