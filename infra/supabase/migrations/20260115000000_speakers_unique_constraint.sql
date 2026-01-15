-- Add UNIQUE constraint on speakers(project_id, label) for upsert support
-- This prevents duplicate speakers with the same label within a project

ALTER TABLE speakers
ADD CONSTRAINT speakers_project_id_label_unique UNIQUE (project_id, label);
