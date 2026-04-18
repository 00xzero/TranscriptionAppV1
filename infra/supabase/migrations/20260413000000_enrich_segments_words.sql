-- Enrich segments and words for canonical segment ingestion

ALTER TABLE segments ADD COLUMN is_edited BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE segments ADD COLUMN is_filler BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE segments ADD COLUMN algo_version TEXT NOT NULL DEFAULT 'v1.0';

ALTER TABLE words ADD COLUMN speaker INTEGER;
ALTER TABLE words ADD COLUMN speaker_confidence REAL;
ALTER TABLE words ADD COLUMN punctuated_text TEXT;
ALTER TABLE words ADD COLUMN paragraph_index INTEGER;
ALTER TABLE words ADD COLUMN sentence_end BOOLEAN NOT NULL DEFAULT false;
