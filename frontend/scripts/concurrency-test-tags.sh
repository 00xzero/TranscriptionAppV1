#!/usr/bin/env bash
# Two-connection coverage for transcript tags (20261101000000_transcript_tags.sql):
# what each tag function does when another transaction holds the same rows.
#
# LOCAL DATABASE ONLY. It commits a throwaway account (and its transcripts and
# tags) and deletes it again on exit. Session A opens a transaction, acts, and
# sleeps before committing; session B starts while A still holds its locks.
# Exits non-zero on the first wrong result.
set -euo pipefail

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_transcription-app-local}"
USER_ID='c0000000-0000-4000-8000-00000000000a'
SUB='user_c000000000004000800000000000000a'
T1='c2000000-0000-4000-8000-000000000001'
T2='c2000000-0000-4000-8000-000000000002'
HOLD=2      # seconds session A keeps its transaction open
START=0.7   # seconds before session B starts

psql_run() {
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose "$@"
}

# Runs SQL as the throwaway account inside one transaction. Prints the result,
# or "ERROR <sqlstate>" when the statement fails.
as_user() {
  local out
  if out=$(psql_run 2>&1 <<SQL
\set VERBOSITY verbose
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"$SUB","role":"authenticated"}';
$1
COMMIT;
SQL
  ); then
    echo "$out" | sed '/^$/d' | tail -1
  else
    echo "ERROR $(echo "$out" | sed -n 's/^ERROR: *\([0-9A-Z]\{5\}\):.*/\1/p' | head -1)"
  fi
}

# Session A: holds `lock_sql` (run as postgres, may be empty) and `user_sql`
# (run as the account) for HOLD seconds before committing.
hold_as_user() {
  psql_run >/dev/null <<SQL
BEGIN;
$1
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"$SUB","role":"authenticated"}';
$2
RESET ROLE;
SELECT pg_sleep($HOLD);
COMMIT;
SQL
}

# Session A that takes a row lock as postgres, sleeps, and only then runs the
# account's statement: B arrives while the row is locked but still unchanged.
lock_then_user() {
  psql_run >/dev/null <<SQL
BEGIN;
$1
SELECT pg_sleep($HOLD);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"$SUB","role":"authenticated"}';
$2
COMMIT;
SQL
}

query() { psql_run -c "$1" | sed '/^$/d' | tail -1; }

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
  ('$T1', '$USER_ID', 'One', 'completed'),
  ('$T2', '$USER_ID', 'Two', 'completed');
SQL

tag() { echo "c1000000-0000-4000-8000-0000000000$1"; }

# 1. Two creates of the same name: one creates, the other adopts it.
hold_as_user "" "SELECT public.create_transcript_tag('$T1', '$(tag 01)', 'Same', '#4F638C');" &
sleep "$START"
got=$(as_user "SELECT public.create_transcript_tag('$T2', '$(tag 02)', 'same', '#C73E1D')->>'outcome';")
wait
expect "same-name creates: the second adopts" "$got" "adopted"
expect "same-name creates: one tag" "$(query "SELECT count(*) FROM public.tags WHERE user_id = '$USER_ID' AND lower(name) = 'same';")" "1"
expect "same-name creates: both transcripts carry it" \
  "$(query "SELECT count(*) FROM public.transcript_tags WHERE tag_id = '$(tag 01)';")" "2"

# 2. Create while the same-named tag is being renamed away: B's insert hits the
#    committed name, then its lookup waits on A and finds the name gone, so it
#    goes round again and creates its own tag.
as_user "SELECT public.create_transcript_tag('$T1', '$(tag 03)', 'Race', '#4F638C');" >/dev/null
lock_then_user "SELECT 1 FROM public.tags WHERE id = '$(tag 03)' FOR UPDATE;" \
  "SELECT public.rename_tag('$(tag 03)', 'Race', 'Renamed');" &
sleep "$START"
got=$(as_user "SELECT (r->>'outcome') || ' ' || (r->'tag'->>'id') FROM public.create_transcript_tag('$T2', '$(tag 04)', 'Race', '#C73E1D') AS r;")
wait
expect "create during a rename of the namesake: creates its own" "$got" "created $(tag 04)"
expect "create during a rename: the renamed tag kept its new name" \
  "$(query "SELECT name FROM public.tags WHERE id = '$(tag 03)';")" "Renamed"

# 3. Create while the same-named tag is being deleted.
as_user "SELECT public.create_transcript_tag('$T1', '$(tag 05)', 'Doomed', '#4F638C');" >/dev/null
lock_then_user "SELECT 1 FROM public.tags WHERE id = '$(tag 05)' FOR UPDATE;" \
  "SELECT public.delete_tag('$(tag 05)');" &
sleep "$START"
got=$(as_user "SELECT (r->>'outcome') || ' ' || (r->'tag'->>'id') FROM public.create_transcript_tag('$T2', '$(tag 06)', 'Doomed', '#C73E1D') AS r;")
wait
expect "create during a delete of the namesake: creates its own" "$got" "created $(tag 06)"
expect "create during a delete: linked to a real tag" \
  "$(query "SELECT count(*) FROM public.transcript_tags t JOIN public.tags g ON g.id = t.tag_id WHERE t.transcript_id = '$T2' AND g.id = '$(tag 06)';")" "1"

# 4. Add commits first, then undo-create: the tag is kept.
as_user "SELECT public.create_transcript_tag('$T1', '$(tag 07)', 'Undo kept', '#4F638C');" >/dev/null
hold_as_user "" "SELECT public.add_transcript_tag('$T2', '$(tag 07)');" &
sleep "$START"
got=$(as_user "SELECT public.undo_created_tag('$T1', '$(tag 07)');")
wait
expect "add then undo-create: kept" "$got" "kept"
expect "add then undo-create: still on the other transcript" \
  "$(query "SELECT count(*) FROM public.transcript_tags WHERE tag_id = '$(tag 07)';")" "1"

# 5. Undo-create commits first, then add: the add finds no tag.
as_user "SELECT public.create_transcript_tag('$T1', '$(tag 08)', 'Undo deleted', '#4F638C');" >/dev/null
hold_as_user "" "SELECT public.undo_created_tag('$T1', '$(tag 08)');" &
sleep "$START"
got=$(as_user "SELECT public.add_transcript_tag('$T2', '$(tag 08)');")
wait
expect "undo-create then add: SP001" "$got" "ERROR SP001"
expect "undo-create then add: the tag is gone" "$(query "SELECT count(*) FROM public.tags WHERE id = '$(tag 08)';")" "0"

# 6. Adding the merged-away tag during a merge.
as_user "SELECT public.create_transcript_tag('$T1', '$(tag 09)', 'From', '#4F638C');
         SELECT public.create_transcript_tag('$T1', '$(tag 10)', 'Into', '#C73E1D');" >/dev/null
hold_as_user "" "SELECT public.merge_tags('$(tag 09)', '$(tag 10)');" &
sleep "$START"
got=$(as_user "SELECT public.add_transcript_tag('$T2', '$(tag 09)');")
wait
expect "add to the merged-away tag during a merge: SP001" "$got" "ERROR SP001"

# 7. Delete during an add: the add lands, then the delete takes the tag and its links.
as_user "SELECT public.create_transcript_tag('$T1', '$(tag 11)', 'Short-lived', '#4F638C');" >/dev/null
hold_as_user "" "SELECT public.add_transcript_tag('$T2', '$(tag 11)');" &
sleep "$START"
got=$(as_user "SELECT public.delete_tag('$(tag 11)');")
wait
expect "delete during an add: deleted" "$got" "t"
expect "delete during an add: no links left" \
  "$(query "SELECT count(*) FROM public.transcript_tags WHERE tag_id = '$(tag 11)';")" "0"

# 8. Opposite merges: both lock in id order, so the second waits and finds its
#    target merged away. No deadlock (40P01).
as_user "SELECT public.create_transcript_tag('$T1', '$(tag 12)', 'Left', '#4F638C');
         SELECT public.create_transcript_tag('$T2', '$(tag 13)', 'Right', '#C73E1D');" >/dev/null
hold_as_user "" "SELECT public.merge_tags('$(tag 12)', '$(tag 13)');" &
sleep "$START"
got=$(as_user "SELECT public.merge_tags('$(tag 13)', '$(tag 12)');")
wait
expect "opposite merges: the second finds its target gone" "$got" "ERROR SP001"
expect "opposite merges: the survivor carries both transcripts" \
  "$(query "SELECT count(*) FROM public.transcript_tags WHERE tag_id = '$(tag 13)';")" "2"

# 9. A resend overlapping its own first attempt (same requested id): the
#    second waits at the insert, then finds the tag by name. It is still this
#    create's own tag, so Undo can delete it.
hold_as_user "" "SELECT public.create_transcript_tag('$T1', '$(tag 14)', 'Twin', '#4F638C');" &
sleep "$START"
got=$(as_user "SELECT (r->>'outcome') || ' ' || (r->'tag'->>'id') FROM public.create_transcript_tag('$T1', '$(tag 14)', 'Twin', '#4F638C') AS r;")
wait
expect "overlapping resend of one create: own" "$got" "own $(tag 14)"
expect "overlapping resend of one create: one tag, linked once" \
  "$(query "SELECT count(*) FROM public.transcript_tags WHERE tag_id = '$(tag 14)';")" "1"

echo "tags concurrency test passed"
