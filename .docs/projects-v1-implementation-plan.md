# Projects v1 Implementation Plan

Companion to the Projects v1 functional spec (draft for implementation, September 2026) and the decisions recorded in the spec-review sessions. The spec defines **what**; this plan defines **how we ship it**: PR sequencing, the files each PR touches, and the ship criteria per slice.

Revision 2 incorporated the first external review: the transcript foreign key nulls only `project_id`; the insert trigger requires the parent to already exist, closing the multi-row cycle hole; per-project realtime filters are dropped in favour of one user-scoped transcript subscription with derived lists and a shared provider; branch deletion becomes a two-phase workflow that marks the branch before touching storage; every list read paginates; storage removal is batched; and the confirm dialog gains a pending/error interface.

Revision 3 incorporated the second review, which was entirely about making the deletion guarantees real. The changes: the project triggers are split so marking a branch cannot trip its own guard; the transcript guard covers inserts and object-key links, not just moves; every membership-changing write takes a row lock that conflicts with the marking update, so the inventory is stable under concurrency rather than merely checked afterwards; the mark is protected by a role check, the RPCs become `security definer` with explicit ownership checks, and the cancel RPC is removed; the waveform worker gains compensation for a late upload; and a two-connection concurrency test is added.

Revision 5 incorporates the fourth review and is the implementation-ready revision. The deletion prerequisites (capture and waveform affected-row checks, waveform reconciliation before compensation, the orphan cleanup tool repair) move from PR 6 into PR 3 so they land before deletion is exposed. The orphan cleanup script, which still queries the pre-rename table name and is therefore broken today, is repaired, extended to both buckets, and given an age threshold. `finish_project_delete` receives the inventory keys so its key assertion is real. The single-transcript delete distinguishes failure before the row is gone from cleanup failure after it, and tolerates an already-deleted row. The waveform worker reconciles the row before compensating on an ambiguous error.

Revision 4 incorporated the third review. All trigger functions are now `security invoker`, because a `current_user` role check inside a `security definer` function sees the owner and would have let any client clear the mark. Ordinary transcript deletes inside a marked branch are rejected, so the branch workflow alone owns row deletion once marked and no cleanup key can be lost between retries. `begin_project_delete` marks to a fixed point so a child created during discovery cannot escape the mark. The capture path gains the same affected-row assertion as the waveform worker. Compensation is described as an attempt with a named recovery path, not a guarantee. A pre-existing race in single-transcript deletion is fixed in passing.

## Decisions this plan implements

| # | Decision |
|---|---|
| 1 | `parent_id` is set at creation and immutable. The insert trigger requires the parent row to already exist, which makes a cycle impossible even in a multi-row insert. Same-user ownership for parent and transcript links is enforced by pair foreign keys. Recursive queries carry a `CYCLE` guard as defence in depth. |
| 2 | `transcripts.project_id` is `ON DELETE SET NULL (project_id)`. `projects.parent_id` is `ON DELETE RESTRICT`, forcing branch deletion through the workflow. |
| 3 | The new `projects` table is added to the realtime publication. |
| 4 | The client loads the user's full project list once, paginated, and builds the tree in memory with pure helpers in `core/`. |
| 5 | One user-scoped realtime subscription per table, owned by a provider at the layout boundary. Per-project and Unfiled lists are derived from the shared transcript list, never from per-project filtered subscriptions. |
| 6 | Recent Projects activity is computed on the client as the latest of a project's own `updated_at` and its direct transcripts' `updated_at`. Three cards. |
| 7 | Create, rename, move, and add go browser to Supabase under RLS. Add Transcripts is one batched update. |
| 8 | Deletion is a Next.js route running a two-phase workflow: an RPC marks the branch as deleting to a fixed point and returns the affected transcript ids and object keys; the route removes storage objects in bounded batches; a second RPC deletes the rows in one transaction. While a branch is marked, the database rejects creating transcripts or projects in it, moving transcripts in or out, linking new object keys to its transcripts, and deleting its transcripts by any path other than the finishing RPC. Membership writes and the marking update take conflicting row locks, so a write already in flight when marking begins either commits before the inventory is taken or fails after it. The mark can only be changed by privileged roles. Storage first. The response never claims success on partial failure and describes what remains. |
| 9 | Delete-confirmation counts: nested projects from the in-memory tree, transcripts from one count RPC over the branch. |
| 10 | The capture modal intent, the create body, and the persisted recording session carry `projectId`. If the project is gone or marked for deletion at insert time, the create logic retries once with `project_id: null` inside the same idempotent path and returns a warning. |
| 11 | Unfiled is a section on `/projects`, not a route. |
| 12 | In the Move dialog, the selected node is the parent for inline New Project; the new project becomes the selected destination. |
| 13 | One shared transcript actions menu (Move to Project, Delete) across Library, Transcripts page, editor header, and project pages. The menu renders items only; each surface owns one Move dialog and one Delete dialog and keeps its own post-delete behaviour. |
| 14 | Add Transcripts lists everything except transcripts already directly in the project, with location paths. |
| 15 | After deleting the viewed project or an ancestor, navigate to the nearest surviving ancestor. Not-found is reserved for ids that never load. |
| 16 | Breadcrumbs collapse the middle into an ellipsis menu: up to five crumbs on desktop, root plus last two on narrow screens. |
| 17 | Unit tests for tree helpers, a mocked route test, migration text assertions, a self-asserting SQL smoke script run as `authenticated` with two user identities, a two-connection concurrency script for the marking interleavings, and a short manual acceptance checklist for cross-tab behaviour. |

Settled by the code rather than by discussion: the sidebar entry sits between Library and the Drafts placeholder; `/projects` joins the proxy's protected routes; sibling uniqueness uses `NULLS NOT DISTINCT`; name rules are one Zod schema that both the client and the DB check constraint mirror; create and rename are dialogs sharing one component.

## Sizing summary

| | Estimate |
|---|---|
| PRs | 6, landing sequentially on `main` |
| Migration | 1 file |
| New API route | 1 (`POST /api/projects/[id]/delete`) |
| New pages | 2 (`/projects`, `/projects/[projectId]`) |
| New shared components | ~9 |
| Modified subsystems | capture upload, waveform worker, orphan cleanup tool, single-transcript delete, recording session, Library, sidebar, proxy, editor header, confirm dialog |

Each PR leaves `main` shippable. The sidebar entry and the `/projects` routes stay unreachable until PR 5, so nothing half-wired is exposed.

## Branch strategy

```text
main
 ├── PR 1: schema + contracts + storage helper extraction
 ├── PR 2: core tree helpers + queries + provider
 ├── PR 3: delete route (two-phase) + writer fixes + cleanup tool repair
 ├── PR 4: pages + breadcrumbs (routes exist, not yet linked from the sidebar)
 ├── PR 5: dialogs + shared actions menu + sidebar entry   ← feature becomes reachable
 └── PR 6: creation inside a project + Library integration
```

PRs 2 and 3 depend only on PR 1 and can be built in parallel. PR 4 needs PR 2. PR 5 needs PR 3 and PR 4. PR 6 needs PR 5.

---

## PR 1: Schema, contracts, and the storage helper

**Goal:** the database holds projects correctly and defends every invariant without application code. The one helper the delete route needs from the query layer is extracted here so PR 3 does not depend on PR 2.

### Migration `infra/supabase/migrations/2026MMDD000000_projects.sql`

Sections, in order:

1. **Table.**
   ```sql
   create table public.projects (
     id          uuid primary key default gen_random_uuid(),
     user_id     uuid not null references auth.users(id) on delete cascade,
     parent_id   uuid,
     name        text not null,
     deleting_at timestamptz,
     created_at  timestamptz not null default now(),
     updated_at  timestamptz not null default now(),
     constraint projects_name_length check (char_length(name) between 1 and 80),
     constraint projects_name_trimmed check (name = btrim(name)),
     constraint projects_id_user_unique unique (id, user_id),
     constraint projects_parent_fk
       foreign key (parent_id, user_id) references public.projects (id, user_id)
       on delete restrict
   );
   ```
   The `(parent_id, user_id)` pair reference enforces same-user parenting declaratively. `deleting_at` is the branch-deletion mark used in PR 3.

2. **Sibling uniqueness.**
   ```sql
   create unique index projects_sibling_name_unique
     on public.projects (user_id, parent_id, lower(name))
     nulls not distinct;
   ```
   Without `nulls not distinct`, two root projects named "Work" would both be allowed.

3. **Project triggers.** Two separate trigger functions so that marking a branch never trips its own guard. Both are `security invoker` with `set search_path = public`. This is not optional: inside a `security definer` function, `current_user` reports the function's owner, so a role check there would always pass and any client could clear the mark. Invoker triggers see the real caller. Parent lookups work under invoker because the caller either owns the parent (visible under RLS, and `for share` needs the table-wide `UPDATE` privilege `authenticated` holds) or does not, in which case the row is invisible and the trigger raises not-found, which the pair foreign key would also have done. When the definer RPCs run, the triggers see `current_user = postgres` and the privileged paths open.

   `projects_before_insert` (`BEFORE INSERT`):
   - raise if `new.parent_id = new.id`;
   - raise if `new.deleting_at is not null` (nothing is born marked);
   - with a non-null parent: `select deleting_at into v from projects where id = new.parent_id for share`; raise `P0002` if no row, raise `P0005` ("project is being deleted") if `v is not null`. Row-level `BEFORE` triggers see rows processed earlier in the same statement, so a two-row insert of A→B and B→A fails on whichever row is processed first, because its parent is not there yet. This is what makes cycles impossible; the foreign key alone is checked at statement end and would pass. The `for share` lock is part of the locking protocol in section 5 below.

   `projects_before_update` (`BEFORE UPDATE`):
   - raise if `new.parent_id is distinct from old.parent_id`;
   - if `new.deleting_at is distinct from old.deleting_at` and `current_user not in ('service_role', 'postgres', 'supabase_admin')`: raise `42501`. This is the same role check the existing `protect_project_waveform_columns` trigger uses, and it is what makes the mark unreachable from the public API. Table-wide `UPDATE` for `authenticated` stays, because the trigger, not the grant, is the boundary;
   - if `old.deleting_at is not null` and `new.name is distinct from old.name`: raise `P0005` (no ordinary edits to a marked project).
   - No parent lookup on update. `begin_project_delete` updates every row in a branch in one statement and must succeed regardless of order and on retry when rows are already marked.
   - Reuse the existing `update_updated_at_column` trigger for `updated_at`.

4. **Transcripts link.**
   ```sql
   alter table public.transcripts add column project_id uuid;
   alter table public.transcripts
     add constraint transcripts_project_fk
     foreign key (project_id, user_id) references public.projects (id, user_id)
     on delete set null (project_id);
   create index transcripts_project_id_idx on public.transcripts (project_id);
   ```
   The column list on `set null` is required: without it Postgres would try to null `user_id` too, and the delete would fail against the not-null constraint. Postgres 15 (the configured `major_version`) supports the syntax.

5. **Transcript guard and the locking protocol.** One trigger function `transcripts_project_guard`, `security invoker`, `set search_path = public`, fired `BEFORE INSERT OR DELETE OR UPDATE OF project_id, source_object_key, waveform_object_key` on `transcripts`:
   - on insert with a non-null `project_id`, and on update when `project_id` changes: for each of `old.project_id` and `new.project_id` that is non-null, `select deleting_at from projects where id = $1 for share`; raise `P0005` if the row is marked. Raise `P0002` if `new.project_id` names no row (defensive; the pair FK also catches it at statement end);
   - on update when `source_object_key` or `waveform_object_key` changes and `new.project_id` is non-null: same lookup on `new.project_id`, raise `P0005` if marked. A file cannot be linked to a transcript in a marked branch, whatever role is writing, including `service_role`;
   - on delete with a non-null `old.project_id`: same lookup on `old.project_id`; if marked and `current_user not in ('postgres', 'supabase_admin')`, raise `P0005`. Once a branch is marked, only `finish_project_delete` (a definer function owned by `postgres`) may remove its transcript rows. This closes the residue case where an ordinary delete captured its file inventory before a late link, then removed the row after the branch inventory was taken, leaving a key that no retry could rediscover. Keeping the row keeps the keys. Storage objects the ordinary delete already removed are harmless: the branch retry treats missing objects as no-ops. Note `service_role` is deliberately excluded from the privileged list here; no server path other than `finish` should delete rows in a marked branch.

   Why `for share`: `begin_project_delete` marks the branch with an `UPDATE` on `projects`, which takes a `FOR NO KEY UPDATE` row lock. `FOR SHARE` conflicts with that lock, `FOR KEY SHARE` (what a plain foreign-key check takes) does not. So under the default read-committed isolation:
   - if a move or insert or link is already in flight when marking begins, its transaction holds `FOR SHARE` on the target project rows; the marking `UPDATE` waits until that transaction commits or aborts, and the inventory taken afterwards in the same marking transaction sees the committed result;
   - if marking is already in flight when a move begins, the guard's `FOR SHARE` waits for the marking transaction, then re-reads the row in its committed state, sees the mark, and raises.

   Neither side can observe "not marked" and then commit after the inventory was taken. The set comparison in `finish_project_delete` therefore never fires in practice; it stays as a cheap assertion. The same `for share` applies to the delete path: an ordinary delete already in flight when marking begins holds the lock, the marking update waits, the delete commits, and the inventory taken afterwards does not include it. The row is gone, but its deleter removed the objects it knew about; the only keys such a deleter can miss are ones linked after it read them, which is the pre-existing single-transcript race fixed in the storage helper section below.

   The capture path's link update runs as the user; the waveform worker's runs as `service_role`. Both hit this guard. PR 6 covers what each does when it fires.

6. **RLS.** Enable, then four policies mirroring the `transcripts` policies in the initial schema (`user_id = auth.uid()` on select, insert with check, update, delete).

7. **Grants.** The August 2026 grants migration revoked default privileges, so a new table gets nothing by default. Grant `SELECT, INSERT, UPDATE, DELETE` on `public.projects` to `authenticated` and `service_role`. For the functions below: `revoke execute ... from public`, then grant `EXECUTE` to `authenticated` on `project_branch_transcript_count`, `begin_project_delete`, and `finish_project_delete` only. The trigger functions and `project_branch_ids` are not granted to anyone; triggers run regardless, and the branch helper is called only from inside the definer RPCs.

8. **Realtime.** Add `public.projects` to `supabase_realtime` using the idempotent `DO` block pattern from the May 2026 publication migration.

9. **Branch helper.** An internal SQL function `project_branch_ids(p_id uuid) returns uuid[]`:
   ```sql
   with recursive b as (
     select id, 0 as depth from projects where id = p_id
     union all
     select p.id, b.depth + 1 from projects p join b on p.parent_id = b.id
   ) cycle id set is_cycle using path
   select array_agg(id order by depth desc) from b where not is_cycle;
   ```
   `project_branch_ids(p_user uuid, p_id uuid)` takes the owner explicitly and adds `and user_id = p_user` to the anchor, because its callers are `security definer` and cannot rely on RLS. The `CYCLE` clause is defence in depth; the trigger makes cycles unreachable.

10. **Two-phase delete RPCs.** Both are `security definer` (owned by `postgres`, so their `UPDATE` of `deleting_at` passes the role check in the update trigger), `set search_path = public`, and both begin with `v_user := auth.uid(); if v_user is null then raise 42501`. Every statement inside filters on `user_id = v_user`; there is no path by which a definer function touches another user's rows. Both are idempotent so a retry can re-run phase one.

    `begin_project_delete(p_id uuid)` returns one row `(project_ids uuid[], transcript_ids uuid[], media_keys text[], waveform_keys text[])`:
    - `v_ids := project_branch_ids(v_user, p_id)`; raise `P0002` if null;
    - mark to a fixed point:
      ```sql
      loop
        update projects set deleting_at = coalesce(deleting_at, now())
          where id = any(v_ids) and user_id = v_user;
        v_next := project_branch_ids(v_user, p_id);
        exit when v_next <@ v_ids;      -- nothing new discovered
        v_ids := v_next;
      end loop;
      ```
      Discovery does not lock rows, so a child created under a branch project can commit between one discovery and the marking update. The loop closes that window: each marking update takes the row locks, so from that point a child insert under any marked project blocks on its `for share` and then fails; a child that committed just before its parent was locked is found by the next discovery and marked on the next pass. The loop exits only when a discovery after a marking update finds nothing new, which means every project in the branch is both marked and locked. It succeeds on already-marked rows because the update trigger no longer looks at parents;
    - in the same transaction, after the loop: select the transcripts with `project_id = any(v_ids) and user_id = v_user` and return their ids and non-null object keys as arrays. Because every in-flight membership write has by now either committed or will fail, this inventory is the final one.

    Returning arrays on a single row sidesteps the PostgREST `max_rows` cap, so the inventory is complete regardless of branch size.

    `finish_project_delete(p_id uuid, p_transcript_ids uuid[], p_media_keys text[], p_waveform_keys text[])` returns `(deleted_projects int, deleted_transcripts int)`. The route passes back exactly the arrays `begin` returned, so the function has the inventory to compare against without persisting it:
    - resolve the branch again; raise `P0002` if null; raise `P0003` ("branch not marked") if any project in it has `deleting_at is null`;
    - raise `P0004` ("branch changed") if the set of transcripts currently in the branch differs from `p_transcript_ids`, or if the set of non-null `source_object_key` values on those rows differs from `p_media_keys`, or likewise for waveform keys. Compared as sets, not arrays. All three are unreachable given the guard, the delete guard, and the locks; they stay as assertions that make a guard regression loud instead of silent;
    - `delete from transcripts where id = any(p_transcript_ids) and user_id = v_user`; `delete from projects where id = any(v_ids) and user_id = v_user`; return counts.

    Transcript deletion cascades to segments, words, speakers, watchlist, and jobs through existing foreign keys; `job_events`, `failed_events`, and `webhook_receipts` set null, all confirmed in current migrations. Postgres runs referential checks at statement end, so deleting parents and children in one `DELETE` does not trip `RESTRICT`; the smoke script asserts this.

    There is no cancel RPC in v1. Once a branch is marked it can only proceed to deletion. A branch whose owner never retries stays marked and visible as "Deleting…"; a database operator can clear `deleting_at` by hand as `postgres` if that ever matters before an admin path exists.

11. **Count helper.** `project_branch_transcript_count(p_id uuid) returns int`, `stable`, `security definer` with the same `auth.uid()` preamble, calling `project_branch_ids(v_user, p_id)`. Used by the delete confirmation dialog.

### Contracts

- `contracts/db.ts`: `ProjectSchema` (id, user_id, parent_id nullable, name, deleting_at nullable, created_at, updated_at) and `Project` type. Add `project_id: UuidSchema.nullable()` to `TranscriptSchema`. Add `ProjectInsertSchema` and `ProjectUpdateSchema` (name only).
- `contracts/api.ts`: `ProjectNameSchema = z.string().trim().min(1).max(80)`. This is the single source of the name rule; the DB check constraint and the client validator both mirror it. Add `project_id: UuidSchema.optional()` to `CreateTranscriptBodySchema`. Add `DeleteProjectResponseSchema` (`deleted_projects`, `deleted_transcripts`) and `DeleteProjectErrorSchema` (`error`, `stage: 'begin' | 'storage' | 'finish'`, `removed_media`, `removed_waveforms`, `remaining_transcripts`).

### Storage helper extraction

Move `isMissingStorageObjectError` and `removeStorageObjectIfPresent` from `lib/supabase/queries.ts` into `lib/supabase/storage-objects.ts`, and add `removeStorageObjectsBatched(supabase, bucket, keys, batchSize = 100)` which chunks the key list, tolerates missing objects, and returns `{ removed: number, failed: string[] }`. The batch size follows the repo's existing orphaned-media cleanup script.

`deleteTranscript` imports the helpers and gains one fix for a race that predates this feature: it reads the object keys, removes them, then deletes the row, so a key linked between the read and the row delete (the waveform worker finishing at the wrong moment) is orphaned. The row delete becomes `delete().eq('id', id).select('source_object_key, waveform_object_key').maybeSingle()`, and any returned key not already removed is removed afterwards. Storage-first ordering is preserved for the keys known up front; the returned keys are a sweep for anything linked in the gap.

The function's failure contract is now explicit, because the two halves mean different things to the caller:

- **Failure before the row is deleted** (initial key read, initial object removal, or the row delete itself): throw as today. The transcript still exists; the hook's optimistic rollback restoring it is correct.
- **Row deleted, sweep removal failed**: throw `TranscriptCleanupPendingError` carrying the keys that could not be removed. The transcript is gone and must stay gone in the UI. The hook does not roll back for this error type; the surface shows "Deleted. Some files could not be removed and will be cleaned up later." The recovery path is the orphan cleanup tool.
- **`maybeSingle` returns null**: another tab already deleted the row. That is a successful end state, not an error; return normally.

`useTranscriptsRealtime.deleteTranscript` in `lib/supabase/hooks.ts` is updated to match: roll back on anything except `TranscriptCleanupPendingError`, and rethrow that one after leaving the optimistic removal in place. `__tests__/deleteTranscript.test.ts` gains cases for a key that appears between read and delete, sweep failure producing the pending error, and an already-deleted row returning normally. `__tests__/supabaseHooks.test.tsx` gains the no-rollback case.

### SQL smoke script `frontend/scripts/smoke-test-projects.sql`

Self-asserting, runs inside `begin; ... rollback;` against the local stack via `psql`. It creates two users and runs each case with `set local role authenticated` and `set local request.jwt.claims` so RLS is exercised as the API would exercise it, not as the database owner. Cases:

- create root and nested projects; duplicate sibling name rejected case-insensitively; same name under different parents allowed;
- parent change rejected; self-parent rejected; **two-row insert forming A→B→A rejected**; insert under a non-existent parent rejected;
- cross-user parent rejected via pair FK; transcript with cross-user project rejected; user B cannot see, rename, or delete user A's projects;
- direct `delete from projects` on a parent rejected by `RESTRICT`; direct delete of a leaf nulls only `project_id` on its transcripts and leaves `user_id` intact;
- `begin_project_delete` marks a three-level branch and returns complete arrays; calling it again on the already-marked branch succeeds and returns the same arrays; moving a transcript into or out of the marked branch is rejected with `P0005`; inserting a transcript with `project_id` in the branch is rejected; creating a project under it is rejected; renaming a marked project is rejected; updating `source_object_key` or `waveform_object_key` on a transcript in the branch is rejected, both as `authenticated` and as `service_role`; `finish_project_delete` removes all projects and transcripts and returns correct counts; `finish` with a stale id list raises `P0004`; `finish` without `begin` raises `P0003`; both RPCs on a foreign id raise `P0002`;
- as `authenticated`, `update projects set deleting_at = null` and `... = now()` both raise `42501`; the same as `postgres` succeeds; a direct `delete from transcripts` on a transcript in a marked branch raises `P0005` as `authenticated` and as `service_role`, and `finish_project_delete` still succeeds afterwards;
- inserting a transcript whose `project_id` names no row raises `P0002` (not `23503`); inserting into a marked project raises `P0005`. These two assertions pin the codes `isProjectGoneError` depends on;
- `finish_project_delete` with a key array that omits one inventoried key raises `P0004`;
- `project_branch_ids` on a branch of a thousand-plus transcripts returns them all.

Document the run command at the top of the file.

### Concurrency script `frontend/scripts/smoke-test-projects-concurrency.ts`

The single-session smoke script cannot exercise two transactions at once, and the locking protocol is only proven by overlap. Add `pg` as a dev dependency and drive two connections against the local database, each authenticated as the same user via `set local role authenticated` and the JWT claims setting. Three interleavings, each asserted:

1. Connection A begins a transaction and moves a transcript into project P (guard takes `for share` on P, transaction left open). Connection B calls `begin_project_delete(P)`. Assert B blocks. A commits. Assert B returns and its `transcript_ids` includes the moved transcript.
2. Connection B calls `begin_project_delete(P)` inside an open transaction (rows locked, uncommitted). Connection A attempts a move into P. Assert A blocks. B commits. Assert A fails with `P0005`.
3. Connection A begins a transaction and updates `source_object_key` on a transcript in P as `service_role` (open). Connection B calls `begin_project_delete(P)`. Assert B blocks until A commits, and B's `media_keys` contains the new key.
4. Connection A begins a transaction and inserts a child project under a leaf of P (guard takes `for share` on the leaf, open). Connection B calls `begin_project_delete(P)`. Assert B blocks. A commits. Assert B's `project_ids` includes the new child and the child row is marked. This exercises the fixed-point loop: the child was not in B's first discovery.
5. Connection A begins a transaction and deletes a transcript in P (open). Connection B calls `begin_project_delete(P)`. Assert B blocks. A commits. Assert B's `transcript_ids` excludes it. Then, with P marked, a fresh delete of another transcript in P on connection A fails with `P0005`.

Run it alongside the smoke script whenever the triggers or RPCs change. Blocking is asserted with a short timeout race, not by sleeping.

### Tests

- `__tests__/projectsMigration.test.ts`: text assertions in the style of `realtimePublication.test.ts`. Assert `nulls not distinct`, the pair foreign keys, `on delete restrict`, `on delete set null (project_id)`, the parent-exists check and `for share` in the insert trigger, the role check on `deleting_at` in the update trigger, that every trigger function is `security invoker` and none is `security definer`, the transcript guard's event list including `delete`, `security definer` plus `auth.uid()` in each RPC, the fixed-point loop in `begin_project_delete`, the `cycle` clause, that only the three public functions are granted to `authenticated`, that no cancel function exists, and the publication add.
- `__tests__/schemas.test.ts`: extend for `ProjectSchema`, the new `project_id` field, and the delete response and error schemas.
- `__tests__/storageObjects.test.ts`: batching, missing-object tolerance, partial-failure reporting.

### Ship criteria

`supabase db reset` applies cleanly. Smoke script passes. `npm run typecheck` passes with the new `project_id` column on `Transcript` (this surfaces any exhaustive object literals that need the field).

---

## PR 2: Core tree helpers, queries, and the provider

**Goal:** everything the UI needs to reason about the hierarchy, as pure functions and a single owner of live data. No pages yet.

### `core/projects/tree.ts`

Pure functions over `Project[]`, each unit-tested:

- `buildProjectTree(projects)`: returns `{ byId, childrenOf, roots }` with children sorted by `name` using `localeCompare` with `sensitivity: 'base'`. Tolerates an orphan (parent missing from the list) by treating it as a root, and never loops on malformed input.
- `ancestorsOf(tree, id)`: root-first path, excluding the node. `null` if unknown.
- `branchIds(tree, id)`: the node and every descendant.
- `descendantCount(tree, id)`.
- `siblingNameTaken(tree, parentId, name, excludeId?)`: case-insensitive, trimmed.
- `pathLabel(tree, id)`: `"Work / Client A"`.
- `collapseBreadcrumbs(crumbs, maxVisible)`: returns `{ leading, collapsed, trailing }` per decision 16.
- `transcriptsInProject(transcripts, projectId | null)`: filter by `project_id`, sorted by `updated_at` desc. This is the derived-list selector every page uses.
- `transcriptCountsByProject(transcripts)`: `Map<projectId, count>` for row badges.

### `core/projects/activity.ts`

- `rankProjectsByActivity(projects, transcripts, limit)`: per decision 6. Excludes projects with `deleting_at` set.

### `core/projects/validate.ts`

- `validateProjectName(name)`: calls `ProjectNameSchema.safeParse` from `contracts/api.ts` and maps the first issue to a user-facing message. No independent rule copy.

### `lib/supabase/project-errors.ts`

- `mapProjectWriteError(error)`: Postgres `23505` to the duplicate-name message, `23503` to "that project no longer exists", `P0002` to not-found, `P0005` to "that project is being deleted", generic fallback otherwise. Lives in the query layer because it interprets driver errors, which is not domain logic. Exports `isProjectGoneError(error)`, true for `P0002` (the guard's not-found, which fires before the foreign key and is therefore the error a missing project normally produces), `P0005` (marked for deletion), and `23503` (the foreign key, reachable only if the guard is bypassed). The create fallback in PR 6 uses it, and the smoke script proves the actual code each case raises.

### `lib/supabase/queries.ts`

Browser-client queries:

- `fetchProjects()`: paginated with the same range-loop shape as `paginateAllRows`, ordered by `name`, then `id` for a stable cursor. Generalise `paginateAllRows` to accept a query builder rather than a transcript id if that is cleaner than a second loop.
- `fetchTranscripts()` already exists and is not paginated; add pagination to it in this PR too, since the Projects pages derive every list from it and the same cap applies.
- `createProject({ name, parent_id })`: insert, `select().single()`.
- `renameProject(id, name)`.
- `moveTranscriptToProject(transcriptId, projectId | null)`: single update.
- `addTranscriptsToProject(ids, projectId)`: one `update().in('id', ids)`.
- `fetchProjectBranchTranscriptCount(id)`: `rpc('project_branch_transcript_count', …)`.

### `lib/supabase/realtime.ts`

Add `'projects'` to the `TableName` union. Add an `enabled` option (default `true`): when false, the hook performs no initial fetch, opens no channel, starts no polling, and reports `isLoading: false` with empty data. Today the hook fetches unconditionally before it checks `subscriptionEnabled`, so without this option the provider would issue a fetch on auth pages and on every signed-out render.

### `lib/supabase/hooks.ts`

- `useProjectsRealtime()`: same shape as `useTranscriptsRealtime`, filter `user_id=eq.<id>`, returning `{ projects, tree, isLoading, error, createProject, renameProject, mutate, refetch }`. `tree` is memoised via `buildProjectTree`. Create and rename are optimistic with rollback, matching the existing `deleteTranscript` pattern.
- Extend `useTranscriptsRealtime()` with `moveTranscript(id, projectId | null)` and `addTranscripts(ids, projectId)`, both optimistic with rollback. No per-project hook exists: a filtered subscription cannot receive the update that moves a row out of its filter, so derived lists over the user-scoped subscription are the only correct source.

### `lib/projects/ProjectsProvider.tsx`

A context provider mounted once in `app/layout.tsx` inside the existing providers. It reads the current user id and renders an inner component, keyed by that id, which holds one `useProjectsRealtime()` and one `useTranscriptsRealtime()` with `enabled: Boolean(userId)`. Keying by user id means a sign-out or account switch unmounts and remounts the inner component, so no data from one identity survives into another. Exposes `useProjectsData()` returning both hooks' values plus `error` for each. Every Projects page, dialog, the Library, and the sidebar read from this context; none of them call the hooks directly. The Library and Transcripts pages migrate from their own `useTranscriptsRealtime()` call to the context in this PR, so the app holds exactly one transcripts channel and one projects channel per tab.

With `enabled` false and no user, the provider issues no fetch and opens no channel; the provider test asserts that.

### Tests

- `__tests__/projects/tree.test.ts`, `activity.test.ts`, `validate.test.ts`, `projectErrors.test.ts`.
- `__tests__/projects/provider.test.tsx`: exactly one channel per table regardless of how many consumers mount; no fetch and no channel with no user; data resets on user id change; derived lists update when a transcript's `project_id` changes in the shared list; a moved-out transcript leaves the old project's derived list.
- `__tests__/supabaseHooks.test.tsx`: extend for `moveTranscript`, `addTranscripts`, and pagination of `fetchTranscripts`.

### Ship criteria

Tests green. Library and Transcripts pages behave identically to before, now fed by the provider.

---

## PR 3: Delete route and deletion prerequisites

**Goal:** `POST /api/projects/[id]/delete` implements decision 8, with a stable deletion scope and truthful partial-failure reporting. This PR also lands the three fixes that make deleting existing transcripts safe: the capture and waveform affected-row checks, waveform reconciliation before compensation, and the orphan cleanup tool repair. They are needed whether or not a transcript was created inside a project, so they ship before deletion is exposed, not with the creation work in PR 6.

### `app/api/projects/[id]/delete/route.ts`

```text
1. createClient() from infra/supabase/server; getUser(); 401 if none.
2. Validate id with UuidSchema; 400 otherwise.
3. rpc('begin_project_delete', { p_id })
     P0002 -> 404 { stage: 'begin', gone: true }
     other -> 500 { stage: 'begin' }
   Now the branch is marked: no transcript can be created in it, moved in
   or out, or have a file linked; no project can be created under it or
   renamed. Any such write that was already in flight has committed before
   the inventory was taken. The inventory returned is complete and stable.
4. removeStorageObjectsBatched('media', media_keys, 100)
   removeStorageObjectsBatched('waveforms', waveform_keys, 100)
   Missing objects are tolerated. If either reports failures:
     -> 502 { stage: 'storage', removed_media, removed_waveforms,
              remaining_transcripts: transcript_ids.length,
              error: 'Some files could not be removed. The project is still
                      marked for deletion; nothing was deleted from your
                      library. Try again to finish.' }
   The branch stays marked. Retry re-runs from step 3, which is idempotent,
   and already-removed objects are no-ops.
5. rpc('finish_project_delete', { p_id, p_transcript_ids, p_media_keys, p_waveform_keys })
   passing back exactly the arrays begin returned
     P0004 (branch changed) -> 409 { stage: 'finish' }, retry re-runs step 3
     other -> 500 { stage: 'finish', remaining_transcripts,
                    error: 'Files were removed but the records could not be
                            deleted. Try again to finish.' }
6. 200 with DeleteProjectResponseSchema.
```

The route uses only the user-scoped server client and never the admin client. The RPCs are `security definer` but derive the owner from the caller's JWT, so the user-scoped client is the correct and only caller.

**Retry after a lost response.** If `finish` commits but the HTTP response never reaches the browser, the user sees an error and retries. `begin` then raises `P0002` because the branch is gone, and the route returns 404 with `gone: true`. The dialog treats a 404 on a retry (that is, when the project was in the tree when the dialog opened and is no longer) as success: it closes and navigates per decision 15. A 404 on the first attempt is a genuine not-found and is shown as such.

### What the mark means for the rest of the app

A project with `deleting_at` set is one of two things: a delete in progress in another tab, or a delete whose storage step failed and has not been retried. The UI treats both the same way:

- rows for marked projects render with a "Deleting…" badge and a disabled actions menu, except for a Retry Delete action that opens the delete dialog again;
- marked projects are excluded from the Move and Add dialogs' trees and from Recent Projects;
- a marked branch cannot be navigated into; `/projects/[id]` for a marked project renders the "being deleted" state with the retry action;
- the capture button is hidden on a marked project's page.

Because the guards reject writes at the database, none of this is relied on for correctness. It exists so the user understands what they are seeing.

### Tests

`__tests__/projects/deleteRoute.test.ts` in the style of `startRouteIdempotency.test.ts`, with the server client and storage mocked. Assert:

- `begin` runs before any storage call, and storage runs before `finish`;
- a `begin` failure touches neither storage nor `finish`; `P0002` maps to 404 with `gone: true`;
- a storage failure returns 502 with accurate `removed_*` counts and never calls `finish`;
- a `finish` failure returns 500 and the response is not a success shape;
- missing-object storage errors are tolerated;
- keys are batched at 100 per call, null keys filtered;
- `P0004` maps to 409.

### `lib/projects/delete-client.ts`

`deleteProjectRequest(id)` parses the response with the contract schemas and throws a typed error carrying `stage` and the counts, so the dialog can word the message accurately.

### Writers that can add a file after the inventory is taken

Two code paths upload an object and then link its key to the transcript row. Both links hit the transcript guard when the branch is marked, and both can find the row already gone if the branch has been finished. What each does about the already-uploaded object:

- **Capture upload** (`lib/capture/upload.ts`): two cases. If the branch is marked when the link runs, the update fails with `P0005` and the existing `rollbackPartialCapture` attempts to remove the uploaded object and the transcript row. If the branch has already been finished, the transcript row is gone, the update affects zero rows, no trigger fires, and today the code reads that as success because it checks only `error`; it would then set `didLinkMediaToTranscript` and never remove the upload. So the link update gains `.select('id').single()`, which turns zero rows into an error and routes the case into the same rollback. The user sees the capture error. `P0005` maps to a clear message. (The Unfiled fallback for a recording recovered after its project is gone is in PR 6, because it depends on the project id travelling with the session.)

  Compensation is an attempt, not a guarantee. `rollbackPartialCapture` continues to delete the transcript row even when the object removal fails, and it reports that in the returned message. A crash between upload and rollback leaves an object at a key nothing references. The recovery path for both is the orphan cleanup tool below. Until it runs, the residue is a stranded file, never a visible broken transcript.

- **Waveform worker** (`lib/inngest/functions/handle-waveform-requested.ts`): the link update appends `.select('id').single()` so a zero-row update surfaces as an error. What happens next depends on why the link failed, because a link can commit and still lose its response, and removing the object then would leave a live transcript pointing at a missing waveform:
  - `P0005`, or a confirmed zero-row result: the link did not happen. Remove the object just uploaded (the key is deterministic via `buildWaveformObjectKey`, so this is one `remove` call) and throw `NonRetriableError`.
  - Any other error, including transport failures: reconcile first. Re-read the row's `waveform_object_key`. If it equals the key we uploaded, the link committed; treat as success. If the row is missing or carries a different key, the link did not take; remove the object and rethrow (retriable, since the cause was transient). If the re-read itself fails, do nothing to storage and rethrow; a later retry of the step re-runs the whole upload with `upsert: true` and reconciles again, and if retries are exhausted the object is left for the cleanup tool rather than deleted on a guess.
  - `onFailure` already tolerates a missing row.
- `__tests__/inngestHandlers.test.ts`: extend for zero-row detection, removal on `P0005`, reconciliation treating a committed link as success, removal after reconciliation shows a different key, and no storage action when the re-read fails.
- `__tests__/capture/`: extend for the zero-row link case entering rollback.

### Orphan cleanup tool repair

`frontend/scripts/cleanup-orphaned-media.mjs` is the named recovery path for every compensation that fails, and it is broken today: it selects `source_object_key` from a table called `projects`, the pre-rename name of what is now `transcripts`. Once the new `projects` table exists that query fails outright, and until then it has been failing since the rename. In this PR:

- point it at `transcripts`;
- cover both buckets, reading `source_object_key` for `media` and `waveform_object_key` for `waveforms`;
- add an age threshold, default 24 hours, and never treat an object younger than that as orphaned. An upload sits unreferenced between storage completion and its link, so "unreferenced means orphaned" is only safe for objects old enough that no writer can still be about to link them. The threshold is a flag so an operator can lower it deliberately;
- document at the top of the file that destructive runs (`--delete`) should happen with the Inngest worker stopped and no uploads in progress, and that the dry run is safe at any time;
- add `__tests__/cleanupOrphanedMedia.test.ts` with the Supabase client mocked: both buckets, the age threshold, and the dry-run default.

Scheduling remains deferred (open items).

### Ship criteria

Route test green. Writer and cleanup-tool tests green. Manual check against the local stack with a seeded branch of more than a hundred transcripts: objects disappear from both buckets in batches, rows disappear, counts match. A second manual check: begin a delete with a breakpoint after phase one, attempt a move into the branch from another tab, confirm the move is rejected with the "being deleted" message. A third: run the cleanup tool's dry run against the local buckets and confirm it lists nothing for a clean database and lists a hand-planted old object.

---

## PR 4: Pages and breadcrumbs

**Goal:** browse the hierarchy. The routes exist and are protected but are not yet linked from the sidebar, so nothing half-wired is exposed. Buttons that PR 5 wires up are not rendered in this PR.

### Routing and guards

- `proxy.ts`: add `/projects` to `PROTECTED_ROUTES`.
- `components/ContextualHeader.tsx`: recognise `/projects` routes so the header renders the breadcrumb bar in place of the page title.

### Pages

- `app/projects/page.tsx` (client): reads `useProjectsData()`. Renders root project rows, an Unfiled section header with count, then unfiled transcript rows via `transcriptsInProject(transcripts, null)`. Empty state when there are no projects and no unfiled transcripts.
- `app/projects/[projectId]/page.tsx` (client): resolves the project from `tree.byId`. Order of checks matters: while loading, render a skeleton matching row heights; if the provider reports a load error, render a retryable error state (the same treatment the Library gives a failed fetch) and never fall through to not-found, because an id we could not load is not an id that does not exist; only when loaded without error and the id is absent, call `notFound()`. If the id was present and later disappears, navigate to the nearest surviving ancestor (walk the last-known ancestor path from `ancestorsOf`, pick the first still in `byId`, else `/projects`). If the project is marked deleting, render the "being deleted" state. Otherwise renders breadcrumbs, name, child project rows, then direct transcript rows.
- `app/projects/[projectId]/not-found.tsx`: standard not-found copy.

### Components under `components/Projects/`

- `ProjectRow.tsx`: folder icon, name, direct transcript count from `transcriptCountsByProject`, nested project count, last-updated relative time, an actions-menu slot (empty until PR 5), and the deleting badge state.
- `TranscriptRow.tsx`: extracted from the current `LibraryView` row so the Library and project pages share one row. Keeps the status badge logic and takes an actions-menu slot.
- `Breadcrumbs.tsx`: takes `ancestorsOf` output plus the current node; uses `collapseBreadcrumbs` with `maxVisible` 5, and 3 under the `md` breakpoint via a `useMediaQuery` hook (add one under `lib/hooks/` if none exists). The collapsed segment is a `DropdownMenu` listing hidden ancestors as links. Every crumb is a `Link`; the last is `aria-current="page"`.
- `ProjectsEmptyState.tsx`: three variants (no projects yet, empty project, empty unfiled).

### Tests

- `__tests__/projects/breadcrumbs.test.tsx`: collapse behaviour at both widths, links, aria-current.
- `__tests__/projects/projectsPage.ui.test.tsx` and `projectPage.ui.test.tsx`: mocked provider; assert ordering (projects before transcripts, alphabetical then recency), empty states, load error renders the retryable state and not not-found, not-found only after a clean load, deleting state, and the vanish-then-navigate behaviour.
- `__tests__/proxy.test.ts`: extend for `/projects`.

### Ship criteria

Typing the URL with seeded data shows the tree. No entry point in the UI yet.

---

## PR 5: Dialogs, the shared actions menu, and the sidebar entry

**Goal:** every create, rename, move, add, and delete flow in the spec, and the feature becomes reachable.

### `components/ui/confirm-dialog.tsx`

Extend deliberately rather than around: `onConfirm` is awaited; the dialog tracks `pending` and disables both buttons while true; a thrown error from `onConfirm` renders inline beneath the description and keeps the dialog open; the dialog closes itself only when `onConfirm` resolves; the confirm label can switch to a `pendingLabel`.

The callers must change with it. `LibraryView.handleConfirmDelete` and the Transcripts page's equivalent currently catch the error, set a page-level message, and close the dialog in `finally`. Awaiting inside the shared component does not override that. Both handlers are rewritten to let the error propagate and to stop closing the dialog themselves; the page-level error message goes away in favour of the inline one. `DeleteTranscriptDialog` and `DiscardRecordingDialog` gain the pending state and their tests are updated for stay-open-on-failure.

### Components under `components/Projects/`

- `ProjectNameDialog.tsx`: one component for create and rename. Props: `mode`, `parentId`, `initialName`, `onSubmit`. Validates with `validateProjectName` and `siblingNameTaken` before submitting; on failure shows `mapProjectWriteError` output inline and stays open. Built on `components/ui/dialog.tsx`.
- `ProjectActionsMenu.tsx`: Rename and Delete items for a project row and for the page header. Renders items only; the page owns the dialogs.
- `DeleteProjectDialog.tsx`: built on the extended `ConfirmDialog`. On open, computes nested count from the tree and calls `fetchProjectBranchTranscriptCount`. Copy per spec section 9. Confirm calls `deleteProjectRequest`; on success closes and, if the deleted id is the current page or an ancestor, navigates per decision 15; on failure stays open with the stage-specific message and a Retry label. A 404 with `gone: true` on a retry counts as success (the earlier attempt finished; its response was lost).
- `MoveTranscriptDialog.tsx`: transcript title in the heading; a `ProjectTreePicker` with Unfiled at the top; current location highlighted and pre-selected; Move disabled until the selection differs; inline New Project opens `ProjectNameDialog` with `parentId` set to the selected node (or `null` for Unfiled/root) and selects the new project on success. Marked-deleting projects are excluded from the tree.
- `ProjectTreePicker.tsx`: expandable tree with a search field. Search filters by name and auto-expands ancestors of matches. Keyboard: arrows move, right/left expand/collapse, Enter selects. Roles: `tree`, `treeitem`, `aria-expanded`, `aria-selected`.
- `AddTranscriptsDialog.tsx`: searchable list from the provider's transcripts minus those whose `project_id` equals the current project. Each row: title, date, checkbox, and `pathLabel` when filed. Add calls `addTranscripts` once with all selected ids.

### `components/TranscriptActionsMenu.tsx`

Shared menu rendering Move to Project… and Delete. It takes `onMove` and `onDelete` callbacks and renders nothing else. Each surface owns one `MoveTranscriptDialog` and one `DeleteTranscriptDialog` with a `pendingTranscript` state, the way `LibraryView` already does for delete, so a page with two hundred rows mounts two dialogs, not four hundred. Surfaces keep their own post-delete behaviour: the editor continues to `router.replace('/transcripts')`, the lists simply drop the row.

Replace the inline menus in `components/LibraryView.tsx`, `app/transcripts/page.tsx`, and `app/editor/[id]/components/EditorHeader.tsx`, and use the menu in `TranscriptRow`.

### Wiring

- `components/Sidebar.tsx`: add the Projects item (icon `FolderOpen`) between Library and Drafts, in both collapsed and expanded renderings, active when `pathname.startsWith('/projects')`.
- `components/LibraryView.tsx`: change View All to `/projects`.
- `/projects` page: New Project opens `ProjectNameDialog` with `parentId: null`.
- `/projects/[projectId]` page: New Project with `parentId: projectId`; Add Transcripts opens `AddTranscriptsDialog`; header menu is `ProjectActionsMenu`; row menus feed the page's single pair of dialogs.
- Pending states: every dialog disables its primary action during the request. Project rows never optimistically disappear on delete; the route's success response is the only signal, after which the realtime DELETE events and the optimistic `mutate` remove the rows.

### Tests

- `__tests__/confirmDialog.test.tsx`: awaited confirm, pending state, stays open on error, closes on resolve.
- `libraryView.ui.test.tsx` and the Transcripts page test: a failed delete keeps the dialog open with the inline message; a successful delete closes it.
- `__tests__/projects/projectNameDialog.ui.test.tsx`: validation via the shared schema, duplicate message, stays open on error.
- `__tests__/projects/moveTranscriptDialog.ui.test.tsx`: Move disabled until changed, Unfiled selection, inline create selects the new node, deleting projects excluded.
- `__tests__/projects/addTranscriptsDialog.ui.test.tsx`: exclusion rule, search, batched update.
- `__tests__/projects/deleteProjectDialog.ui.test.tsx`: counts in copy, stage-specific failure messages, no success on failure, navigation on success.
- `__tests__/projects/treePicker.test.tsx`: keyboard navigation and aria attributes.
- Update `libraryView.ui.test.tsx`, `editor.test.tsx` (editor still navigates after delete), and the sidebar tests.

### Ship criteria

Acceptance criteria in spec section 15 hold for everything except creation inside a project and the Library cards.

---

## PR 6: Creation inside a project and Library integration

**Goal:** decision 10 and the Recent Projects cards.

### Threading `projectId` through creation

- `lib/ModalContext.tsx`: add `projectId?: string | null` to `CaptureModalIntent`.
- `/projects/[projectId]` page: the header's capture button calls `openCaptureModal({ projectId })`. `ContextualHeader` reads the project id from the route on project pages and passes it.
- `lib/capture/upload.ts`: add `projectId?: string | null` to `CaptureUploadOptions`; include `project_id` in the create body when set.
- `lib/hooks/useCapture.ts`: pass `projectId` from the intent to `runCaptureUpload` on the upload tab.
- Recording path: add `projectId: string | null` to `AttachAndStartParams`, the session snapshot, `PersistedSessionSchema` in `lib/recording/persistence/types.ts` (as `.nullable().default(null)` so sessions persisted before this change still parse), `RecoverableInfo`, and `FinalizedRecording`. `CaptureModal.tsx` passes the intent's `projectId` into `attachAndStart`. `sessionUpload.ts` and `sessionRecovery.ts` pass it to `runCaptureUpload`. Persistence tests under `__tests__/recording/` gain a round-trip case and a legacy-shape case.
- `core/transcripts/create.ts`: accept `project_id`. The insert is wrapped so that an error satisfying `isProjectGoneError` (`P0002` from the guard because the project no longer exists, `P0005` because it is marked for deletion, or `23503` from the foreign key) retries the same insert once with `project_id: null` and sets `warning: 'project_missing'` on the result. The retry goes through the existing insert branch, so a `23505` on `upload_intent_id` during the retry still resolves to the existing row exactly as it does today. `runCaptureUpload` surfaces the warning; the capture modal and recording page show a toast ("Saved to Unfiled: the project is no longer available"). The recording recovery path exercises this end to end: a session persisted with a project id whose project was deleted before recovery lands Unfiled with the warning.
- `__tests__/createTranscript.test.ts`: extend for all three fallback codes and for the fallback-plus-dedupe race. The smoke script in PR 1 is what proves the database actually raises `P0002` and `P0005` on those paths; this unit test proves the code reacts to them.

### Library

- `components/LibraryView.tsx`: replace the three sample cards with `RecentProjectCard` fed by `rankProjectsByActivity(projects, transcripts, 3)` from the provider. Card shows name, `pathLabel` of the parent when nested, relative last-active time, and a footer with transcript count and nested count. Empty state when the user has no projects: a single card inviting them to create one, linking to `/projects`.
- `__tests__/libraryView.ui.test.tsx`: ranking, parent path, empty state, link target.

### Ship criteria

Every acceptance criterion in spec section 15 holds. The manual acceptance checklist below passes.

---

## Manual acceptance checklist

Run once before the final PR merges, against the local stack, with two browser tabs signed in as the same user and a third tab signed in as a second user.

1. Move a transcript from project A to project B in tab one; tab two, sitting on project A, drops it without a refresh, and tab two on project B gains it.
2. Move a transcript to Unfiled in tab one; tab two on `/projects` shows it under Unfiled without a refresh.
3. Begin deleting a branch in tab one with a paused breakpoint after phase one; in tab two, attempt to move a transcript into and out of the branch, create a project under it, and start a capture inside it; all are rejected with the "being deleted" message, and the capture lands Unfiled with the warning toast. Resume; both tabs drop the branch. (Overlap of writes already in flight when marking begins is covered by the concurrency script, not by this manual step.)
4. Delete a branch with the storage bucket made read-only; the dialog reports the accurate counts and stays open; restore the bucket and Retry succeeds.
5. In the second user's tab, request `/projects/[id]` for the first user's project; not-found renders. Attempt the delete route with that id; 404.
6. Start a recording inside a project, kill the tab mid-capture, reopen; recovery uploads into that project. Repeat with the project deleted before recovery; the transcript lands Unfiled with the warning toast and no duplicate row is created.
7. Seed a branch with more than a thousand transcripts; delete it; the buckets and tables are both empty of it afterwards.
8. Start a transcription inside a project and delete the project while the waveform job is still running; afterwards the waveforms bucket holds no object for that transcript and the Inngest run shows a non-retriable failure, not three retries.
10. Delete a single transcript with the waveforms bucket made read-only after its media object is removed; the row is gone, the list does not restore it, and the surface reports cleanup pending. Restore the bucket; the cleanup tool's dry run lists the waveform object once it is older than the threshold.
9. Delete a project, then block the response in devtools before it reaches the page; retry from the still-open dialog; it closes as success and navigates.

## Cross-cutting checks before each merge

```bash
npm run typecheck && npm run lint && npm test
```

Run the SQL smoke script and the concurrency script whenever PR 1's migration, a trigger, or an RPC changes:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f frontend/scripts/smoke-test-projects.sql
```

```bash
cd frontend && npx tsx scripts/smoke-test-projects-concurrency.ts
```

## Open items deliberately left out of v1

Per spec section 14 and the review: drag-and-drop, moving a project branch (would replace the immutability trigger with a recursive cycle check), sharing, multi-project membership, colours and icons, smart projects, trash or undo. A CI database harness that would promote the smoke and concurrency scripts to automated tests is its own piece of work. An admin path to unstick a branch whose owner never retries is deferred; pre-MVP, a database operator can clear `deleting_at` by hand as `postgres`. Scheduling the orphan cleanup script as an Inngest cron is a small follow-up once it covers both buckets.
