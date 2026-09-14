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
-- Scope of this fix is INSERT and UPDATE delivery. Publication membership is
-- necessary but does not make user_id-filtered DELETE events reliable: without
-- REPLICA IDENTITY FULL the old row contains only its primary key, while RLS
-- cannot authorize a row after it is deleted. Callers that need cross-client
-- deletion delivery must use a separate, authorized reconciliation signal.
-- =========================================================================

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
