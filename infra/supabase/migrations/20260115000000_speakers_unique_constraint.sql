-- Add UNIQUE constraint on speakers(project_id, label) for upsert support
-- This prevents duplicate speakers with the same label within a project

-- Step 1: Deduplicate existing speakers before adding constraint
-- For each (project_id, label) pair, keep the oldest speaker and update segments to point to it
WITH duplicates AS (
    SELECT 
        id,
        project_id,
        label,
        ROW_NUMBER() OVER (PARTITION BY project_id, label ORDER BY created_at ASC, id ASC) as rn
    FROM speakers
),
keepers AS (
    SELECT id, project_id, label FROM duplicates WHERE rn = 1
),
to_delete AS (
    SELECT d.id as old_id, k.id as new_id
    FROM duplicates d
    JOIN keepers k ON d.project_id = k.project_id AND d.label = k.label
    WHERE d.rn > 1
)
-- Update segments to point to the keeper speaker before deleting duplicates
UPDATE segments s
SET speaker_id = td.new_id
FROM to_delete td
WHERE s.speaker_id = td.old_id;

-- Update chunks to point to the keeper speaker before deleting duplicates
UPDATE chunks c
SET speaker_id = td.new_id
FROM to_delete td
WHERE c.speaker_id = td.old_id;

-- Step 2: Delete duplicate speakers (keeping the oldest)
DELETE FROM speakers
WHERE id IN (
    SELECT id FROM (
        SELECT 
            id,
            ROW_NUMBER() OVER (PARTITION BY project_id, label ORDER BY created_at ASC, id ASC) as rn
        FROM speakers
    ) ranked
    WHERE rn > 1
);

-- Step 3: Add the UNIQUE constraint
ALTER TABLE speakers
ADD CONSTRAINT speakers_project_id_label_unique UNIQUE (project_id, label);
