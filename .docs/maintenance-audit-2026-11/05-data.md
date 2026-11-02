# Data layer: schema, RLS, RPCs, storage policies, queries and realtime

**Scope reviewed:** `infra/supabase/migrations/*` (45 files, 10,415 lines), `config.toml`, `seed.sql`; `frontend/contracts/{db,primitives,api}.ts` (~660 lines); `frontend/lib/supabase/**` (~3,020); `frontend/infra/supabase/*.ts` (~550); the smoke-test and orphan-cleanup scripts (~3,470). About 18k lines in all.

**Scorecard:**

| Lens | Score | Why |
|---|---|---|
| Maintainability | 2 | The schema only exists as 45 layered migrations, some with DDL that depends on the environment. Types are written by hand. Tests check migration text, not the database. |
| Scalability | 3 | Writes are set-based. Read costs grow with the whole library: the words RLS check, people totals worked out on every read, full-list refetches. |
| Reliability | 4 | Composite owner FKs, CHECKs, idempotent guarded RPCs, and definer functions with tight grants. Gaps: guards that hold only by convention, storage orphans, single-statement deletes. |
| Performance | 3 | `current_user_id()` runs as an initPlan and FK columns are fully indexed. Costs: the words policy subplan, repeated aggregates, redundant segment indexes. |

**Summary:** The final schema is sound and defensive. I worked out the grants by replaying every migration in order.
- All 44 live SECURITY DEFINER functions pin `search_path`.
- Every one that can be called directly is executable only by `authenticated` or by nobody. Three definer trigger functions keep the old PUBLIC grant, which does nothing because a trigger function can't be called directly.
- The helpers that take a caller-supplied `p_user` are never granted to `authenticated` (`server_owned_writes.sql:315`, `job_results_storage.sql:290`).
- Policies use `(SELECT public.current_user_id())`, which is a STABLE unique-index lookup on `app_users.workos_user_id` (`workos_auth.sql:48-56`), evaluated once per statement.

The weak points are maintainability (the history can't be read as a schema, and there are no generated types) and read paths that grow with account size. **Biggest risk:** the `words` RLS policy checks every word against all of the account's segments, so opening one transcript gets slower as the library grows. Words is by far the largest table.

**Findings**

### [P1] Words RLS checks against the whole account, not the transcript
- Lens: performance
- Evidence: `workos_auth.sql:1846-1854` checks `segment_id IN (SELECT s.id FROM segments s JOIN transcripts t … WHERE t.user_id = (SELECT current_user_id()))`. `words` has no owner or transcript column (`initial_schema.sql:57-69`, `enrich_segments_words.sql:7-11`, nothing later). The editor reads words embedded under segments, 1,000 segments per page (`queries.ts:473-483`).
- Why it matters: the uncorrelated `IN` becomes a SubPlan over every segment the person owns, rebuilt on each page request. At 300 transcripts × 1,000 segments, that is a 300k-row subplan per page. If it doesn't fit in `work_mem`, Postgres falls back to a per-row SubPlan costing words × segments. There are about 9k words per hour of audio.
- Recommendation: add `user_id` (and `transcript_id`) to `words` with a composite FK, and use the policy `user_id = (SELECT current_user_id())`. At minimum, switch to a correlated `EXISTS` on `s.id = words.segment_id`. In the same rebuild, drop columns nothing reads: `confidence`, `speaker*`, `paragraph_index`, `sentence_end`. Only `STORED_WORD_COLUMNS` is read (`queries.ts:467`), and the raw result is kept in `transcription-results`. Also drop the timestamps and their trigger (`initial_schema.sql:167`). Confirm with EXPLAIN ANALYZE on a seeded heavy account.
- Effort: M
- Confidence: medium (plan inferred, not run)

### [P1] The migration history can't be read as a schema, and the tests check text
- Lens: maintainability
- Evidence:
  - There are 140 `CREATE FUNCTION`s for about 65 live functions; `transition_job_status` is defined 7 times.
  - DDL depends on the environment (`IF EXISTS` renames in `failed_events_schema_reconcile.sql:5-40,63-80`).
  - `workos_auth.sql` is 1,932 lines and re-emits about 40 functions "generated from the live catalogue" (`:14-17`).
  - 11 `*Migration.test.ts` files (~1,040 lines) regex-match single historical files. For example, `serverOwnedWritesMigration.test.ts:47-49` asserts policies that `workos_auth.sql:1779-1798` later replaced.
  - There is no CI (no `.github/`), and the smoke SQL is run by hand.
- Why it matters: to learn what a function does today you have to find its last definition. A later migration can undo a guarantee while the tests stay green.
- Recommendation: squash into one baseline built from `supabase db reset` plus `db dump` (public schema plus the storage/realtime policies and grants), arranged in sections. Run `supabase migration repair` on the remote. Delete `move-job-payloads-to-storage.ts` and the `'transcribe'` leftovers. Replace the text tests with CI against a live database: the smoke scripts or pgTAP after a reset, plus catalogue checks (definer functions have `search_path`, no EXECUTE for anon, policies wrap `current_user_id()` in `SELECT`). Risks: resetting the remote history, losing backfills (they don't matter pre-MVP), and every text test breaking, which is intended.
- Effort: L
- Confidence: high

### [P2] Row types are written by hand and unchecked; the clients are untyped
- Lens: maintainability
- Evidence: there is no `supabase gen types`. Clients are a bare `SupabaseClient` (`client.ts:14-25`, `admin.ts:12`). Results are cast or passed through unparsed: `as unknown as PromiseLike<PageResult<T>>` (`queries.ts:403,482`), `return data` (`queries.ts:310`), `transcript as Transcript` (`export-data.ts:129`). There is already some drift: `WordSchema` marks always-present columns `.optional()` (`db.ts:168-172`), there is no schema for `app_users`, `job_events` or `failed_events`, and the comment at `db.ts:17` is stale. `queries.ts` (1,094 lines) repeats the same rpc/throw/parse code about 35 times.
- Why it matters: renaming a column, or misspelling an RPC argument, compiles and only fails at runtime.
- Recommendation: generate `database.types.ts`. Type the factories as `SupabaseClient<Database>`. Add a type-level test that each zod row schema has the same keys as `Tables<'x'>`. Split `queries.ts` by area (transcripts, projects, segments, speakers, people, tags) around one `callRpc(name, args, schema)` helper.
- Effort: M
- Confidence: high

### [P2] The revision and title guards only hold by convention
- Lens: reliability
- Evidence: `authenticated` keeps `UPDATE(text, is_edited)` on segments (`speaker_identity_foundations.sql:189-190`) and an UPDATE policy (`workos_auth.sql:1779-1789`). That is only because `set_segment_texts_guarded` is SECURITY INVOKER (`workos_auth.sql:1310-1314`). Titles work the same way: `UPDATE(title)` (`server_owned_writes.sql:23`) plus an invoker `update_transcript_title_guarded` (`workos_auth.sql:1703-1707`). An unused, unguarded `updateTranscript` is still exported (`queries.ts:343-357`).
- Why it matters: any future `.from('segments').update({text})` skips the revision check and brings back the duplicated-text-after-split bug. This goes against "guarantees belong in the database".
- Recommendation: make both functions DEFINER with `search_path = ''`. Revoke segments UPDATE and drop its policy, revoke `UPDATE(title)`, and delete `updateTranscript`.
- Effort: S
- Confidence: high

### [P2] People totals are worked out from segments on every read, and one subquery has no account filter
- Lens: performance
- Evidence: in `people_directory`, `person_count` filters `WHERE p.organisation_id = o.id` with no `user_id` (`workos_auth.sql:755`). The only index is `(user_id, organisation_id)` (`people_editor.sql:50`), so each organisation scans every account's people. `editor_people_context` aggregates the `person_appearances` view (speakers⋈segments GROUP BY, `people_editor.sql:354-359`) for every person in the account (`workos_auth.sql:481-492`), on every editor load and speaker refresh (`useEditorData.ts:185`, `useSpeakerAssignments.ts:120-122`). `people_directory` does the same (`:742-748`).
- Why it matters: the cost grows with every linked segment in the account, and the editor pays it repeatedly.
- Recommendation: add `AND p.user_id = v_user` now. Later, keep a per-(person, transcript) appearance row (talk_ms, segment_count) that the speaker-write functions already holding the lock update.
- Effort: S, then M
- Confidence: high

### [P2] Large deletes run as one statement under the user's role
- Lens: scalability
- Evidence: `delete_transcript` (`workos_auth.sql:452`) and `finish_project_delete` (`:549-550`) each delete in one statement. That cascades to segments and words (`initial_schema.sql:42,59`), and the speaker FK first sets `speaker_id` to NULL on segments that are about to be deleted (`speaker_identity_foundations.sql:158-161`). Nothing sets `statement_timeout`.
- Why it matters: Supabase's default `authenticated` timeout is 8 s. A project with dozens of 10-hour transcripts (~150k words each) will likely time out, after the routes have already swept the files.
- Recommendation: delete per transcript, or delete rows in batches from an Inngest step using the admin client. Measure with seeded data.
- Effort: M
- Confidence: medium

### [P2] The storage folder scheme isn't enforced at upload, and cleanup is manual
- Lens: reliability
- Evidence: the media INSERT policy only checks `foldername[1]` (`workos_auth.sql:1898-1903`). Deletion sweeps only the folders of existing transcripts (`job_results_storage.sql:168-184`). The cleanup script needs Inngest stopped and no uploads running (`cleanup-orphaned-media.mjs:4-6`), and holds every key in memory while listing every object (`cleanup-orphaned-media-core.js:50-80`). There is no quota.
- Why it matters: uploads into folders with no transcript row, plus late uploads after the folder check, pile up as files of up to 500 MB with no automated cleanup.
- Recommendation: make the INSERT policy require that `foldername[2]` is one of the caller's transcripts with `source_object_key IS NULL`. Add an Inngest cron that anti-joins `storage.objects` by folder against `transcripts` and removes folders whose row is gone, older than N hours. This is safe while workers run, because nothing can link into a deleted transcript.
- Effort: M
- Confidence: high

### [P2] Realtime refetches everything on every event, and keeps tables nobody subscribes to
- Lens: scalability
- Evidence:
  - 3 channels per tab (`hooks.ts:198,301-309,472-478`).
  - Each SUBSCRIBED (`subscription.ts:172-180`, `hooks.ts:223-231`) and each delete broadcast (`hooks.ts:215-221`) refetches both full lists.
  - While a channel is down, both lists are polled in full every 5 s (`hooks.ts:305-306`, `subscription.ts:81-83`).
  - `jobs` and `speakers` are published (`rename_projects_to_transcripts.sql:489`) but have no subscriber.
  - About 1,130 lines of realtime code serve two lists.
- Why it matters: every tab pays ⌈N/1000⌉ sequential OFFSET queries per list on each event. WAL is decoded for every table in the publication, and `speakers` is rewritten on every save.
- Recommendation: drop `jobs` and `speakers` from the publication now. Then use one private topic per user, fed by statement triggers like `broadcast_projects_v1_deletes` (`projects.sql:418-448`) and carrying `{table, op, ids}`. The client then refetches only those ids, which retires `postgres_changes` and most of `reconciliation.ts`.
- Effort: M–L
- Confidence: high

### [P2] `jobs` columns carry misleading and legacy meanings
- Lens: maintainability
- Evidence:
  - `inngest_event_id` actually holds the engine's request id (`handle-transcription-requested.ts:135`, `engine-callback-state.ts:53`), and its index is not unique (`initial_schema.sql:138`).
  - `type` has no CHECK, yet the reaper still matches `'transcribe'` (`handle-transcription-timeouts.ts:32`), while the active-job index and status derivation only cover `'transcription'` (`state_machine_followups.sql:39-41`, `rename_projects_to_transcripts.sql:166,172`).
  - `webhook_receipts` is effectively one row per job attempt but has no `job_id` (`webhook_receipts.sql:1-14`).
- Recommendation: rename to `engine_request_id` with a unique partial index. Drop `type`. Move the receipt status and lease into `jobs` and drop `webhook_receipts`.
- Effort: M
- Confidence: high

### [P3] Index set: FKs are covered; some indexes are redundant and one ordering index is missing
- Lens: performance
- Evidence: every FK and owner column is indexed: `words.segment_id`, `jobs.transcript_id`, the `transcript_tags` primary key and `tag_id`, the partial `speakers.person_id` and `transcripts.project_id`, and the owners via the `(user_id, …)` uniques. Redundant:
  - `idx_segments_transcript_id` (`initial_schema.sql:51`), a prefix of `idx_segments_transcript_order` (`segment_split.sql:32`) and `idx_segments_transcript_speaker` (`project_speaker_summaries.sql:28-30`);
  - `idx_segments_speaker_id` (`:52`);
  - the unused `idx_transcripts_status` (`:21`).

  The Library sorts by `created_at desc, id` over a plain `(user_id)` index and pages by OFFSET (`queries.ts:90-136`). The editor reads segments twice when it loads (`useEditorData.ts:217,242`).
- Recommendation: drop the three; add `(user_id, created_at DESC, id)` and keyset pagination; load segments once.
- Effort: S
- Confidence: high

### [P3] Key terms (`watchlist`) have no database guarantees
- Lens: reliability
- Evidence: they are inserted separately, and a failure is only logged (`core/transcripts/create.ts:156-171`). There is no unique or length CHECK (`initial_schema.sql:110-119`), and the browser may INSERT at any time (`workos_auth.sql:1828-1835`). The limits exist only in `api.ts:6-17`, and `canonical` is never read (`start.ts:124-126`).
- Recommendation: replace the table with `transcripts.key_terms text[]` CHECKed for count and length, written in the row INSERT.
- Effort: S
- Confidence: high

**Quick wins:**
- Add the `user_id` filter to `people_directory`'s `person_count`.
- Remove `jobs` and `speakers` from `supabase_realtime`.
- Drop the 3 redundant indexes; add `(user_id, created_at DESC, id)`.
- Make the two guarded writes DEFINER, revoke the direct UPDATEs, and delete `updateTranscript`.
- Add a cron that purges old `webhook_receipts` / `failed_events`. Today they never expire and survive transcript deletion through `ON DELETE SET NULL` (`webhook_receipts.sql:5`, `jobs_idempotency_and_failed_events.sql:27-28`).

**Zero-in candidates:**
1. **Words/segments redesign (RLS, footprint) with a "heavy account" seed.** `seed.sql` has no words, so the plans can't be measured today.
2. **Baseline squash plus database tests in CI.** This is what makes every later schema change safe.
3. **Realtime on per-user broadcast.** It removes most of the reconciliation code and the full-list refetches.

**Test coverage notes:**
- What exists:
  - Mocked-client tests: `supabaseRealtime.test.tsx` (1,204 lines), `supabaseHooks.test.tsx`, `projects/queries.test.ts`, `editor/fetchSegmentWords.test.ts`, `cleanupOrphanedMedia.test.ts`.
  - 11 migration-text tests.
  - 9 smoke SQL scripts plus `smoke-test-projects-concurrency.ts` and `concurrency-test-tags.sh`. They run against a real database, are up to date for WorkOS, and are run by hand, locally only.
- Gaps:
  - No smoke script calls `split_segment`, `rejoin_segments`, `set_segment_texts_guarded` or `update_transcript_title_guarded`.
  - No query-plan or RLS-cost checks.
  - Nothing runs automatically.

**Cross-domain notes:**
- `core/` runs Supabase queries directly (`core/transcripts/create.ts`, `core/transcription/{webhook,start,transition}.ts`), against the layering rule.
- `transcripts.status` has two writers: the `derive_transcript_status` trigger (`rename_projects_to_transcripts.sql:152-184`) and direct writes (`core/transcription/webhook.ts:176-179`).
- `save_transcript_segments` sends the whole transcript as one JSONB RPC (`handle-transcription-webhook.ts:174-180`). This belongs to the pipeline domain.

**Open questions:**
- Does Supabase's gateway accept a ~30 MB RPC body for a 10-hour transcript?
- `save_transcript_segments` holds the per-account advisory lock for its whole transaction (`speaker_identity_review_guards.sql:336`). Can a long save push a split or speaker write on another transcript past the 8 s timeout?
- Does `transcript_folder_objects`' `COLLATE "C"` range use a storage index on hosted Supabase?
- After the app's 5 retries (`subscription.ts:184-200`), does supabase-js rejoin the channel, or does the tab poll forever?

**What's good:**
- Composite `(id, user_id)` owner FKs make cross-account links impossible at the schema level.
- The guarded RPCs recognise their own earlier success, use consistent SP001–SP004 SQLSTATEs, and take locks in a fixed order.
- Definer-function discipline, including a catalogue check that fails the migration if anything still uses `auth.uid()` (`workos_auth.sql:1911-1932`).
- `save_transcript_segments` is set-based (`speaker_identity_review_guards.sql:403-485`), and pagination always breaks ties on `id`.
