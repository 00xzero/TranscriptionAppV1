# Library, Projects, People & Tags (organisation features) + transcript deletion

**Scope reviewed:** `frontend/components/{LibraryView,FilterChips,RowActionsMenu,TranscriptActionsMenu,TranscriptActionDialogs,DeleteTranscriptDialog,ColourPicker}.tsx`, `components/Projects|People|Tags/**` (~5.4k lines with the top-level files), `lib/{projects,people,tags,transcripts}/**`, `core/{projects,people}/**`, `core/transcripts/title.ts`, `app/(app)/{page,transcripts,projects,people}`, `app/api/projects/[id]/delete`, `app/api/transcripts/[id]/delete`. Also read `lib/supabase/{hooks,queries}.ts` and `lib/supabase/realtime/*` where they feed this domain, plus the delete/summary SQL. About 11k lines read.

**Scorecard**

| Lens | Score | Why |
|---|---|---|
| Maintainability | 3 | Tags and delete routes are well factored and tested. Three pending-edit patterns, People writes inline in 450-line dialogs, duplicated dialogs, and a very heavy ProjectPeopleDialog mini-router hurt. |
| Scalability | 2 | The whole model is "fetch everything, hold it in context, filter in JS". Nothing in this domain is paginated or virtualised, and the tag links resync in full on every window focus. |
| Reliability | 4 | Delete ordering (files, then row, then sweep) is correct and tested. Tag writes are idempotent with rollback. Weak spots: the `/transcripts` error-info loop and flattened delete errors. |
| Performance | 2 | Every list row mounts Radix wrappers and subscribes to the whole tags store. Tag counts are O(tags x links) per render, and the Library RPC re-runs on any transcript tick. |

**Summary:** Correctness-critical paths (delete, tag writes, project tree) are careful and well tested. The domain was built for tens of items, though. At 5k transcripts the app fetches the whole index sequentially, renders every row, and re-renders all rows on any realtime or tag change. At that size the biggest risk is the tags layer: every link is refetched on each window focus and counted with a nested scan. Organisation state is also managed three different ways, so the next feature will pick one at random.

## Findings

### [P1] Tag links are fully resynced on every window focus, and counted with O(tags x links) scans
- Lens: scalability / performance
- Evidence: `frontend/lib/tags/TagsProvider.tsx:108` (fetches all tags and all links), `:144` (reload on every `focus`), `:221-222` (`countFor` filters every link per call). Callers: `frontend/components/Tags/TagFilter.tsx:60` (once per tag per render), `TagPicker.tsx:226` and `TranscriptTagPicker.tsx:21` (once per tag per keystroke). `frontend/lib/supabase/queries.ts:90-109,997` fetches 1000 rows per page, one page at a time. The provider is mounted for every page at `frontend/app/(app)/layout.tsx:49`.
- Why it matters: 10k transcripts x 3 tags is about 30 sequential requests and about 2.7 MB each time the window regains focus, even on the editor or recording page. With 300 tags and 30k links, each render of the filter bar or an open picker costs about 9M comparisons. The store object changes identity on every pending edit or snapshot, so every `useTags()` consumer re-renders (including every `TranscriptRow`, `components/Projects/TranscriptRow.tsx:44`).
- Recommendation: Precompute `Map<tagId, Set<transcriptId>>` and per-tag counts once in the store `useMemo`, making `countFor` O(1) or O(listed). Throttle focus reloads (30 s minimum) or compare a cheap version stamp first. Mount the provider only under list and editor routes, or load links lazily per visible transcript ids. Expose row-level selectors, e.g. via `useSyncExternalStore`, so a row only re-renders when its own tags change.
- Effort: M
- Confidence: high

### [P1] No list in this domain is paginated or virtualised, and the whole index is the client model
- Lens: scalability / performance
- Evidence: `frontend/app/(app)/transcripts/page.tsx:313-393` maps every transcript to a row with a button, a `TranscriptActionsMenu` and a `TagChipList`. `TranscriptActionsMenu.tsx:49-52` wraps each row in a Popover plus a dropdown. `AddTranscriptsDialog.tsx:84-107` renders every candidate checkbox. `PeopleListView.tsx:82-84,164` runs filter and sort on every render with no memo and renders all people. `react-virtuoso` is used only in the editor. `fetchTranscriptSummaries` (`queries.ts:125-135`) pulls all rows via sequential offset pages. `hooks.ts:326,356,412,425` refetches the full index after every delete, move and add.
- Why it matters: at 5k transcripts the first load is 5 sequential round trips, then about 5k rows and 10k Radix instances mount. Every realtime status flip or 5 s polling tick (`useTranscriptsRealtime`, `hooks.ts:301-308`) produces a new array and re-renders all of them. Offset paging while rows are deleted can also skip a row (a deletion between page 1 and 2 shifts the next row into the gap), which only the next refetch repairs.
- Recommendation: Virtualise `/transcripts`, Unfiled, Add-Transcripts and People (the editor already has a virtuoso setup). Render one shared menu and popover per list instead of one per row. Switch the index fetch to keyset pagination on `(created_at, id)` and run the later pages in parallel or lazily. Make `TranscriptRow` a memoised component with stable props.
- Effort: M-L
- Confidence: high

### [P1] `/transcripts` re-fires one job-error query per errored transcript on every list update, and swallows failures
- Lens: reliability / performance
- Evidence: `frontend/app/(app)/transcripts/page.tsx:122-128` (effect depends on `transcripts`; fetches for every `error` row with no `transcriptErrors[id]`). `frontend/lib/supabase/queries.ts:330-332` returns `null` for a query error, for no row, and for an empty message, so no entry is ever stored.
- Why it matters: an errored transcript whose result is `null` is re-queried on every realtime event or 5 s poll, with no in-flight guard. N errored rows means N+1 queries on first load and N state updates re-rendering the whole page. A real DB or RLS error is shown as nothing, not as the "Failed to load error details" state the page was built to show.
- Recommendation: Return the errors with the list (a join or one `in()` query) or load lazily when a row is expanded. Keep an in-flight and attempted set. Let `fetchJobError` throw on query errors and return `null` only for "no row".
- Effort: S
- Confidence: high

### [P2] Library home re-runs the heaviest RPC whenever any transcript changes
- Lens: scalability / performance
- Evidence: `frontend/components/LibraryView.tsx:69-74` passes `transcriptRevision(transcripts)` (count plus newest `updated_at`) as the refetch key. `frontend/lib/projects/useProjectSpeakerSummaries.ts:103-110` re-runs with no debounce, and again on focus (`:116-122`). The SQL, `infra/supabase/migrations/20260926000000_people_directory.sql:426-582`, does `DISTINCT ON (speaker_id)` over every segment of every transcript in six branch roots.
- Why it matters: the landing page does a segment-proportional scan each time a transcript changes status during processing, and again on every focus. Cost is unmeasured, but it grows with total segments.
- Recommendation: Key the refetch on completed-transcript changes only, and debounce it (about 2 s). Longer term, store each speaker's first-segment position on the speaker row when a transcript completes, so the RPC reads speakers only.
- Effort: S (client) / M (schema)
- Confidence: medium

### [P2] Three different pending-edit patterns, and People has no store at all
- Lens: maintainability
- Evidence:
  - Tags: pending-edit overlay over a snapshot, with an answered counter, per-tag queues and read-back (`TagsProvider.tsx:76-195`), plus a separate `lib/tags/actions.ts`.
  - Projects and transcripts: `mutateOptimistically` fencing plus hand-written equality-guarded reverts for each of delete, move, add, create and rename (`hooks.ts:311-570`).
  - People: `useReloadingQuery`, where `update()` patches and the caller reloads (`usePeopleData.ts:28-79`). `update` does not bump the generation, so an in-flight reload can overwrite a patch. Write logic and the `guarded` and `refreshAfterConflict` handling live inline in components (`PersonDialog.tsx:209-260`, `PeopleListView.tsx:194-251`).
  - Related: `DeleteProjectDialog.tsx:44-47` mutates two provider lists itself with the raw setters. Error mappers are split (`people/errors.ts:10`, `supabase/project-errors.ts:11`, `errorCode` and `getProjectErrorCode` duplicated), and `lib/tags/*` imports from `lib/people/*`.
- Why it matters: each new organisation feature (for example tag filters on projects) requires picking an unwritten convention, and the rollback bugs live in whichever one was copied.
- Recommendation: Lift the TagsProvider core (overlay, stale-read guard, per-key queue, read-back) into a generic `createOverlayStore<Snapshot>`. Move People onto it with a `lib/people/actions.ts` in the shape of `lib/tags/actions.ts`. Add `deleteProject` to the projects provider. Merge the error helpers into one `lib/errors/db-codes.ts`. Leave the realtime-fenced path for projects and transcripts until the first two are done.
- Effort: L
- Confidence: high

### [P2] Delete orchestration is duplicated across two routes and unbounded for large projects
- Lens: reliability / maintainability
- Evidence: the post-delete sweep helpers match in both routes (`app/api/transcripts/[id]/delete/route.ts:65-74`, `app/api/projects/[id]/delete/route.ts:204-225`), as do the admin-client guards (`route.ts:50-56`, `route.ts:94-110`). The transcript route retries TR002 three times (`:18,76-110`); the project route turns PJ005 into a 409 with no retry (`:163-172`). The project route does everything in one request (`maxDuration = 300`, `:21`): begin returns every key and the finish call takes every id, with sequential batches of 100 (`infra/supabase/storage.ts:169`).
- Why it matters: both flows are safe under partial failure (rows outlive files, the project stays marked, retries are idempotent) and well tested (`__tests__/{transcripts,projects}/deleteRoute.test.ts`). But a 5k-transcript project is one long request near the platform limit, and the PJ005 behaviour differs by accident. Separately, the UI throws the server's specific message away: `TranscriptActionDialogs.tsx:28-30` always shows "Failed to delete transcript. Please try again."
- Recommendation: Move the sweep, delete and retry sequence into `lib/transcripts/delete.server.ts` (one function for transcript, one for project), returning a result union. Routes then only authenticate, check the account header and map to HTTP. Let project delete take a bounded number of transcripts per call and loop from the client, as `begin` is already idempotent. Surface `DeleteTranscriptRequestError.message` in the dialog.
- Effort: M
- Confidence: medium (request-time at scale not measured)

### [P2] ProjectPeopleDialog is a mini-router out of proportion to its job
- Lens: maintainability
- Evidence: `components/Projects/ProjectPeopleDialog.tsx` (582 lines), `lib/projects/usePeopleDialogRoute.ts` (274), `core/projects/people-dialog-history.ts` (120), `__tests__/projects/projectPeopleDialog.ui.test.tsx` (778). It keeps a per-history-entry view store in `sessionStorage` (`usePeopleDialogRoute.ts:24-55`), and traversal timing guards (`:28,117-125`).
- Why it matters: about 1,000 lines of production code and 800 of test for a modal that lists a project's speakers. Any change to the page's URL handling or the dialog's layout must reason about history entries, scroll restoration and animation together.
- Recommendation: Keep only `?people[=id]` for open and person, use local state for scroll and filter, and drop the sessionStorage view restore. Restore it if users ask for it.
- Effort: M
- Confidence: high

### [P2] Duplicated surfaces and a 400-line page that is its own row component
- Lens: maintainability
- Evidence: `app/(app)/transcripts/page.tsx` is 401 lines with seven state maps, start-transcription logic and an inline row, and does not use the shared `TranscriptRow`. Library, Projects, Project and Transcripts each repeat the row, menu and dialog wiring. `PersonNameDialog.tsx` and `ProjectNameDialog.tsx` share about 90% of their markup, and `components/Tags/TagFilter.tsx:6` imports the People one for renaming tags. The tag filter appears on two of the four lists; Unfiled (`projects/page.tsx:99-121`) has none.
- Why it matters: each UI fix (a11y, error text, tag chips) has to be repeated four times and tends to drift.
- Recommendation: Extract `useStartTranscript` and one `TranscriptList` taking `rows`, `showProject` and `filter` props. Make a shared `NameDialog` in `components/ui`. Add the tag filter to Unfiled.
- Effort: M
- Confidence: high

### [P3] Dead options and unverified prerender mismatch on the Library page
- Lens: maintainability
- Evidence: `LibraryView.tsx:31-39` keeps an `'all'` scope as an "escape hatch" with its own ranking path (`core/projects/activity.ts:50-74,136-146`), and the repo's rule is to delete deprecated paths. `LibraryView.tsx:89-94,106` computes the greeting with `new Date().getHours()` during render.
- Why it matters: the dead branch costs tests and reading time. If the page is prerendered, server and client text can differ.
- Recommendation: Delete the `'all'` scope. Compute the greeting after mount or add `suppressHydrationWarning`.
- Effort: S
- Confidence: medium

## Quick wins
- Make `fetchJobError` throw on query errors and add an in-flight set in the `/transcripts` effect (`queries.ts:330`, `page.tsx:122`).
- Build `Map<tagId, count>` once in `TagsProvider` and drop the per-call filter in `countFor` (`TagsProvider.tsx:221`).
- Move `transcripts.map(t => t.id)` into a `useMemo` in `transcripts/page.tsx:302` so `TagFilter`'s `listed` memo works.
- Show the server's delete message in `TranscriptActionDialogs.tsx:28`.
- Throttle the TagsProvider focus reload and debounce the speaker-summary revision.

## Zero-in candidates
1. **Client data model at scale** (index fetch, tags links, lists, polling fallback). Everything else in this domain sits on top of it. Decide the target (keyset pagination, virtualisation, tag counts) once.
2. **A shared pending-edit primitive** for Tags, People and Projects. Do it before adding more organisation features.
3. **Delete pipeline extraction** into a server module, with a bounded project delete.

## Test coverage notes
- Strong: `__tests__/transcripts/{deleteRoute,deleteClient,folderCleanup}.test.ts`, `projects/{deleteRoute,deleteProjectDialog.ui,provider,providerChannels,tree,activity}`, `tags/{tagsProvider,tagQueries,tagLists.ui,tagPicker.ui}`, `people/{directory,peopleListView.ui,personDialog.ui}`, `libraryView.ui.test.tsx`, `transcriptsPage.ui.test.tsx`.
- Gaps: nothing exercises list size (render or fetch counts at 1k+ rows). `transcriptsPage.ui.test.tsx` does not cover the repeated job-error fetches. There is no test of People `update()` racing an in-flight reload. No test for `addTranscriptsToProject` with many ids.

## Cross-domain notes
- `frontend/lib/supabase/realtime/subscription.ts:81` and `hooks.ts:301-308`: 5 s polling fallback re-downloads the whole transcript index (realtime reviewer).
- `infra/supabase/migrations/20260926000000_people_directory.sql:426-582`: `project_speaker_summaries` scans segments (data reviewer; check indexes).
- `frontend/lib/supabase/queries.ts` is 1,094 lines covering every domain, and `lib/supabase/hooks.ts` holds project and transcript domain logic. Both are better homed in `lib/projects|people|tags` (architecture).
- `frontend/app/(app)/editor/[id]/hooks/useTranscriptTags.ts:135-137` uses the same O(links) `countFor` (editor reviewer).
- `getProjectErrorCode` is used for TR-codes in `app/api/transcripts/[id]/delete/route.ts:95`; the name is misleading.

## Open questions
- `addTranscriptsToProject` (`queries.ts:217`) sends `.in('id', ids)` as a PATCH filter in the URL. A selection of a few hundred ids may exceed gateway URL limits (not tested).
- Is `(app)/page.tsx` actually prerendered? If so, the greeting hydrates differently.
- Does a 5k-transcript project delete finish inside 300 s on the deployed plan?
- Are `transcript_tags(tag_id)` and `(transcript_id, tag_id)` indexed for the paged link reads?

## What's good
- `TagsProvider` + `lib/tags/actions.ts`: the stale-read guard, per-tag write queue, idempotent RPCs and typed failure classes (`failures.ts`) are the model to spread.
- Delete ordering (sweep, delete, sweep) is correctly conservative, and both routes have dense contract tests, including partial-failure paths.
- `core/projects/tree.ts` and `core/people/directory.ts` are pure, cycle-safe and unit-tested, and the archive panel renders only expanded nodes.
- Dialog hosts (`TranscriptActionDialogs`, `ProjectActionDialogs`) mount one dialog per surface, not per row, which keeps context subscriptions off the lists.
