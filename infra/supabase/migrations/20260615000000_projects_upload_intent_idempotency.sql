-- Project-create idempotency for durable-recording recovery.
--
-- A client-generated uploadIntentId (UUID) dedupes repeated create attempts for
-- the SAME recording, so a recovery save after a mid-upload crash returns the
-- canonical project instead of creating a duplicate. Mirrors the jobs idempotency
-- pattern in 20260130000000_jobs_idempotency_and_failed_events.sql.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS upload_intent_id TEXT;

-- Partial unique index scoped to the owner. NULL intent ids (legacy rows and the
-- file-upload path) are excluded, so existing rows and that flow are unaffected.
-- (user_id, upload_intent_id) matches the table's RLS ownership boundary.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_user_id_upload_intent_id
    ON projects(user_id, upload_intent_id)
    WHERE upload_intent_id IS NOT NULL;
