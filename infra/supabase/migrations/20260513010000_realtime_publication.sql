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
-- Scope of this fix is INSERT and UPDATE only. Per the Supabase docs
-- (https://supabase.com/docs/guides/realtime/postgres-changes), filters
-- are not applied to DELETE events, and with RLS enabled the DELETE
-- payload's `old` record is restricted to primary keys regardless of
-- REPLICA IDENTITY. The client compensates by handling deletions
-- optimistically in `useProjectsRealtime.deleteProject` and
-- `useSpeakersRealtime.deleteSpeaker`, so the publication add is enough
-- to restore live updates for the two reported symptoms (project INSERT
-- not appearing in the list; project `status` UPDATE not flipping the
-- processing badge).
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
