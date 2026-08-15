-- Adopt Supabase's opt-in Data API model for the public schema.
--
-- Grants and RLS are separate layers: these privileges make a table reachable
-- by a Data API role, while the existing RLS policies continue to decide which
-- rows that role may access.

-- New public tables, sequences, and functions must be exposed explicitly in
-- the migration that creates them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES
  FROM anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES
  FROM anon, authenticated, service_role;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC globally by default.
-- The global revoke removes that built-in default; the schema-scoped revoke
-- removes Supabase's direct Data API role grants for public functions.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS
  FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS
  FROM anon, authenticated, service_role;

-- Existing projects retain their historical grants during Supabase's rollout,
-- so remove those grants before applying the intended role/table contract.
REVOKE ALL PRIVILEGES
  ON TABLE
    public.transcripts,
    public.speakers,
    public.segments,
    public.words,
    public.watchlist,
    public.jobs,
    public.failed_events,
    public.job_events,
    public.webhook_receipts
  FROM anon, authenticated, service_role;

-- Signed-in users access only the RLS-protected product tables.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE
    public.transcripts,
    public.speakers,
    public.segments,
    public.watchlist,
    public.jobs
  TO authenticated;

-- Trusted server-side Supabase clients need the product tables plus internal
-- webhook, dead-letter, and job-audit tables.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE
    public.transcripts,
    public.speakers,
    public.segments,
    public.words,
    public.watchlist,
    public.jobs,
    public.failed_events,
    public.job_events,
    public.webhook_receipts
  TO service_role;
