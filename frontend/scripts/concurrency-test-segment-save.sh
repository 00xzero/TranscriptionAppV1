#!/usr/bin/env bash
# Two-connection coverage for the segment save guard
# (20261103000000_segment_save_guard.sql, audit finding pipeline-3): what a
# save does when completion, another save or a new attempt holds the same job.
#
# LOCAL DATABASE ONLY. It commits a throwaway account (and its transcripts and
# jobs) and deletes it again on exit. Session A opens a transaction, acts, and
# sleeps before committing; session B starts while A still holds its locks.
# Exits non-zero on the first wrong result. Single-session cases (a mismatched
# or unknown job, the editor's edit surviving) are in
# smoke-test-segment-save-guard.sql.
set -euo pipefail

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_transcription-app-local}"
USER_ID='d9000000-0000-4000-8000-0000000000c1'
SUB='user_d90000000000400080000000000000c1'
HOLD=2      # seconds session A keeps its transaction open
START=0.7   # seconds before session B starts

transcript() { echo "d9100000-0000-4000-8000-0000000000c$1"; }
job() { echo "d9200000-0000-4000-8000-0000000000c$1"; }

psql_run() {
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose "$@"
}

# A two-segment payload whose first segment says `text`, with fresh ids.
payload() {
  echo "jsonb_build_object('speakers', '[{\"num\": 0}]'::jsonb, 'segments', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'speaker_num', 0, 'start_ms', 0, 'end_ms', 900,
      'text', '$1', 'is_filler', false, 'algo_version', 'race', 'words', '[]'::jsonb),
    jsonb_build_object('id', gen_random_uuid(), 'speaker_num', 0, 'start_ms', 1000, 'end_ms', 1900,
      'text', 'Second line.', 'is_filler', false, 'algo_version', 'race', 'words', '[]'::jsonb)))"
}
save() { echo "SELECT public.save_transcript_segments('$(transcript "$1")', '$(job "$2")', $(payload "$3"))->>'segment_count';"; }
complete() { echo "SELECT public.transition_job_status('$(job "$1")', 'completed', '{}'::jsonb, '{}'::jsonb, 'race');"; }

# Runs SQL as the service role (the pipeline) in one transaction. Prints the
# result, or "ERROR <sqlstate>" when the statement fails.
as_pipeline() {
  local out
  if out=$(psql_run 2>&1 <<SQL
\set VERBOSITY verbose
BEGIN;
SET LOCAL ROLE service_role;
$1
COMMIT;
SQL
  ); then
    echo "$out" | sed '/^$/d' | tail -1
  else
    echo "ERROR $(echo "$out" | sed -n 's/^ERROR: *\([0-9A-Z]\{5\}\):.*/\1/p' | head -1)"
  fi
}

# Session A: runs `sql` as the service role, holds it for HOLD seconds, commits.
hold_as_pipeline() {
  psql_run >/dev/null <<SQL
BEGIN;
SET LOCAL client_min_messages = warning;
SET LOCAL ROLE service_role;
$1
RESET ROLE;
SELECT pg_sleep($HOLD);
COMMIT;
SQL
}

query() { psql_run -c "$1" | sed '/^$/d' | tail -1; }
first_text() { query "SELECT text FROM public.segments WHERE transcript_id = '$(transcript "$1")' ORDER BY start_ms LIMIT 1;"; }
segment_ids() { query "SELECT string_agg(id::text, ',' ORDER BY start_ms) FROM public.segments WHERE transcript_id = '$(transcript "$1")';"; }

expect() {
  local name="$1" got="$2" want="$3"
  if [[ "$got" != "$want" ]]; then
    echo "FAIL: $name: expected [$want], got [$got]" >&2
    exit 1
  fi
  echo "ok: $name"
}

cleanup() { psql_run -c "DELETE FROM public.app_users WHERE id = '$USER_ID';" >/dev/null; }
trap cleanup EXIT
cleanup
psql_run >/dev/null <<SQL
INSERT INTO public.app_users (id, workos_user_id) VALUES ('$USER_ID', '$SUB');
INSERT INTO public.transcripts (id, user_id, title, status) VALUES
  ('$(transcript 1)', '$USER_ID', 'Completion first', 'processing'),
  ('$(transcript 2)', '$USER_ID', 'Save first', 'processing'),
  ('$(transcript 3)', '$USER_ID', 'Two saves', 'processing'),
  ('$(transcript 4)', '$USER_ID', 'New attempt', 'processing');
INSERT INTO public.jobs (id, transcript_id, type, status) VALUES
  ('$(job 1)', '$(transcript 1)', 'transcription', 'processing'),
  ('$(job 2)', '$(transcript 2)', 'transcription', 'processing'),
  ('$(job 3)', '$(transcript 3)', 'transcription', 'processing'),
  ('$(job 4)', '$(transcript 4)', 'transcription', 'processing');
SQL

# 1. Completion commits first: the late save waits on the job, then finds it
#    completed and is refused; the first save's segments stay as they were.
expect "completion first: the first save" "$(as_pipeline "$(save 1 1 'First run.')")" "2"
before=$(segment_ids 1)
hold_as_pipeline "$(complete 1)" &
sleep "$START"
got=$(as_pipeline "$(save 1 1 'Late duplicate.')")
wait
expect "completion first: the late save is refused" "$got" "ERROR SP005"
expect "completion first: segments untouched" "$(segment_ids 1)" "$before"
expect "completion first: transcript completed" \
  "$(query "SELECT status FROM public.transcripts WHERE id = '$(transcript 1)';")" "completed"

# 2. The save commits first: completion waits for it, then completes. The
#    save landed before completion, so it is the transcript's content.
hold_as_pipeline "$(save 2 2 'Saved first.')" &
sleep "$START"
got=$(as_pipeline "$(complete 2)")
wait
expect "save first: completion goes through after it" \
  "$(query "SELECT status FROM public.jobs WHERE id = '$(job 2)';")" "completed"
expect "save first: its segments are kept" "$(first_text 2)" "Saved first."

# 3. Two saves of the running attempt (the save step's own retry): the second
#    waits, then replaces the first. No duplicate rows.
hold_as_pipeline "$(save 3 3 'Attempt one.')" &
sleep "$START"
got=$(as_pipeline "$(save 3 3 'Attempt two.')")
wait
expect "two saves: the second goes through" "$got" "2"
expect "two saves: the second replaced the first" "$(first_text 3)" "Attempt two."
expect "two saves: no duplicate rows" \
  "$(query "SELECT count(*) FROM public.segments WHERE transcript_id = '$(transcript 3)';")" "2"

# 4. A new attempt starts (the old job fails, a new job runs) while a late save
#    of the old job arrives: refused. The new attempt then saves.
expect "new attempt: the old job's first save" "$(as_pipeline "$(save 4 4 'Old attempt.')")" "2"
hold_as_pipeline "SELECT public.transition_job_status('$(job 4)', 'error', '{}'::jsonb, '{}'::jsonb, 'race');
  INSERT INTO public.jobs (id, transcript_id, type, status) VALUES ('$(job 5)', '$(transcript 4)', 'transcription', 'processing');" &
sleep "$START"
got=$(as_pipeline "$(save 4 4 'Old attempt, late.')")
wait
expect "new attempt: the old job's late save is refused" "$got" "ERROR SP005"
expect "new attempt: the new job saves" "$(as_pipeline "$(save 4 5 'New attempt.')")" "2"
expect "new attempt: its segments are the transcript's" "$(first_text 4)" "New attempt."

echo "segment save concurrency test passed"
