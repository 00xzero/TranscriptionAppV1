-- =========================================================================
-- Realtime publication setup
-- =========================================================================
--
-- Supabase's `supabase_realtime` publication is created empty by default;
-- tables must opt in explicitly before logical replication emits any
-- INSERT/UPDATE/DELETE events for them. Without this, client subscriptions
-- to `postgres_changes` reach the `SUBSCRIBED` state but never receive any
-- payloads, so the Library/Projects UI never sees newly-created projects
-- or status transitions until the user manually refreshes.
--
-- Realtime row-level filters (e.g. `user_id=eq.<uuid>` on projects,
-- `project_id=eq.<uuid>` on jobs/speakers) are evaluated against the row
-- data in each WAL record. For INSERT and UPDATE this is the new row, which
-- always carries every column. For DELETE only the old row is available,
-- and with REPLICA IDENTITY DEFAULT that record contains only the primary
-- key — so any filter on a non-PK column silently fails to match. The
-- filters on `projects`, `jobs`, and `speakers` are all non-PK columns, so
-- they need REPLICA IDENTITY FULL for delete events to reach the right
-- channels.
-- =========================================================================

ALTER TABLE public.projects REPLICA IDENTITY FULL;
ALTER TABLE public.jobs REPLICA IDENTITY FULL;
ALTER TABLE public.speakers REPLICA IDENTITY FULL;

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['projects', 'jobs', 'speakers']
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = target_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', target_table);
    END IF;
  END LOOP;
END
$$;
