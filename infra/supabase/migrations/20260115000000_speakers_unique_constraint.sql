-- Add UNIQUE constraint on speakers(project_id, label) for upsert support
-- This prevents duplicate speakers with the same label within a project

-- Step 1: Create temp table to store duplicate speaker mappings
-- For each (project_id, label) pair, map duplicate speaker IDs to the keeper (oldest)
CREATE TEMP TABLE speaker_dedup_map AS
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
)
SELECT d.id as old_id, k.id as new_id
FROM duplicates d
JOIN keepers k ON d.project_id = k.project_id AND d.label = k.label
WHERE d.rn > 1;

-- Step 2: Update segments to point to the keeper speaker
UPDATE segments s
SET speaker_id = m.new_id
FROM speaker_dedup_map m
WHERE s.speaker_id = m.old_id;

-- Step 3: Update chunks to point to the keeper speaker
UPDATE chunks c
SET speaker_id = m.new_id
FROM speaker_dedup_map m
WHERE c.speaker_id = m.old_id;

-- Step 4: Delete duplicate speakers using the temp table
DELETE FROM speakers
WHERE id IN (SELECT old_id FROM speaker_dedup_map);

-- Step 5: Clean up temp table
DROP TABLE speaker_dedup_map;

-- Step 6: Add the UNIQUE constraint
ALTER TABLE speakers
ADD CONSTRAINT speakers_project_id_label_unique UNIQUE (project_id, label);
