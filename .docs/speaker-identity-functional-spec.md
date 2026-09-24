# Speaker identity and correction overhaul — functional specification

**Status:** Reviewed draft (v2) · **Date:** 24 September 2026

**Scope:** A private People directory with organisations, identity linking across transcripts, speaker correction, a one-off linking of existing named speakers, and all affected displays and exports.

This document defines the speaker overhaul. It supersedes PRD §4.3 for future speaker behaviour where the two differ; the PRD still describes the currently shipped app. The decisions from the 24 September review are folded into the sections below, and §14 records each one with its reason.

## 1. Purpose

A person who appears in several transcripts must be represented by one reusable identity. If the user identifies a transcript's `Speaker 1` as an existing person named Hamza, the app must link that transcript speaker to the *same Hamza identity* already used elsewhere. Matching the text `Hamza` is not enough.

The overhaul must also let the user correct a mistaken passage without changing every occurrence of a transcript speaker. These are separate actions with visibly different scopes.

### Success criteria

- The user can create a person once in a private People directory and reuse that identity in any of their transcripts.
- The directory shows which transcripts contain that person. Project speaker counts and previews recognise that the same linked person appears in multiple transcripts.
- The editor clearly distinguishes **identify this transcript speaker** from **correct this passage**, and shows the scope of every action before it is applied.
- Existing transcripts, speaker assignments and exports survive the migration unchanged, and the account's existing named speakers are linked to people in one reviewed pass.
- No people are silently merged because their names happen to match.

## 2. Current behaviour and the problem

Today each `speakers` row belongs to one transcript. Deepgram's speaker numbers are turned into local `Speaker N` rows, and segments refer to those rows. The editor can rename a local row or move one segment to another local row, but it has no reusable person identity. A project summary deliberately counts two local rows as two speakers even when both rows describe the same person in different transcripts.

The current speaker popover also mixes scopes without saying so:

- **Tag** with a new name creates a local speaker and moves **one segment** to it. It looks like identification but is a passage correction.
- Clicking another speaker moves one segment; clicking the current speaker renames it across the whole transcript.
- **Reset to generic name** renames the speaker to the highest existing number plus one, so a renamed `Speaker 0` comes back as, for example, `Speaker 3`.
- A failed save is reported only to the console.

The account's data shows the consequences. At review time it held 62 transcripts with 83 distinct named labels. One person appears under several spellings (`Sam` / `Sam Porter` / `Sma Porter`), namesakes are told apart by appending a company to the name (`Paul Reid ACME`), and one label is used as a note (`Jo (IGNORE - WHITE NOISE)`). The user cannot open one entry to see all of a person's appearances, and the app cannot deduplicate people in project summaries.

## 3. Concepts and identity rules

| Concept | Meaning | Scope |
|---|---|---|
| **Person** | A user-managed, stable identity such as Hamza Abikar. Its identity is its ID, not its name. | One account, across all its transcripts and projects. |
| **Organisation** | An optional, user-managed company or group a person currently belongs to, such as ACME. | One account. |
| **Transcript speaker** | A local voice in a particular recording. It has an **ordinal** (the N in `Speaker N`), an optional **custom local label**, an optional **diarization index** (Deepgram's speaker number) and an optional link to a person. Segments refer to it. | One transcript. |
| **Link** | The relationship from a transcript speaker to a person. | All segments using that transcript speaker. |
| **Segment** | One persisted unit of transcript text and timing. | One transcript. |
| **Turn** | A maximal, chronological run of adjacent segments with the same **displayed identity**: the linked person if there is one, otherwise the transcript speaker. A run of unassigned segments is also a turn. | One portion of a transcript. |
| **Unassigned** | A segment whose speaker ID is null. This is not a person. | One segment or turn. |

Rules:

1. One transcript speaker links to zero or one person. One person can be linked from many transcript speakers, including more than one within the same transcript.
2. Two people may have the same name. Equal names never establish equal identity; different spellings do not prevent an intentional link to the same identity.
3. A local `Speaker N` is a diarization placeholder, not a person. New transcription does not automatically create a person for any detected voice.
4. **Display label.** A linked transcript speaker shows its person's name. An unlinked one shows its custom local label, or `Speaker {ordinal}` when it has none. An unassigned segment shows `Unknown speaker`. One resolver in `core/` produces this label for the editor, every export and every summary.
5. **Namesakes in one transcript.** If two different identities in one transcript resolve to the same label, the resolver adds the organisation (`Paul (ACME)` / `Paul (Globex)`). If they are still identical, it adds a number (`Paul (2)`).
6. Renaming a person changes the current view and future exports of every linked transcript. Previously downloaded exports are static files and do not change.
7. Linking or unlinking a transcript speaker does not alter the text, timing or segment IDs. Correcting one passage does not relink the other segments that use the same transcript speaker.
8. A person can exist with no linked transcripts. Deleting a transcript does not delete its linked people.
9. A person has at most one organisation: the current one. Changing it updates every place it is shown, including older transcripts; no history is kept.

### Example

| Transcript | Local speaker | Link | Display |
|---|---|---|---|
| Interview A | Speaker 0 | person `hamza-id` (no organisation) | Hamza Abikar |
| Meeting B | Speaker 3 | person `hamza-id` | Hamza Abikar |
| Interview C | Speaker 1 | person `tibo-id` (organisation ACME) | Tibo Sottiaux |
| Interview C | Speaker 2 | none, custom label `Interviewer` | Interviewer |

Interview A and Meeting B contain the same person because they share `hamza-id`. A second person also named Hamza would have a different ID.

## 4. People directory

### Entry points

- A **People** item in the sidebar, after Projects. Routes: `/people` and `/people/[id]`.
- From the editor: a linked person's name in the speaker popover opens their page, and **Manage people** sits at the bottom of the popover. Arriving from the editor adds `?from=<transcriptId>`, and the page shows **← Back to "<transcript title>"**.

### List

- Each row shows the avatar (preferred colour and initials), name, organisation, number of linked transcripts, and **Last seen** (the `created_at` of the newest linked transcript).
- Search matches name and organisation name. It is case-insensitive, ignores leading and trailing whitespace, and matches substrings.
- Default order is most recent appearance; people with no appearances sort by when they were created. A switch changes the order to Name A–Z.
- An organisation filter offers All, each organisation, and No organisation.
- Hidden people are omitted unless **Show hidden** is on.
- The empty state explains the two ways to add a person: identify a speaker in a transcript, or create one here.

### Person page

- A header with name, organisation and colour.
- Actions: **Rename person**, **Change organisation**, **Change colour**, **Hide** / **Unhide**, **Merge people**, and **Delete person**. Delete is available only when the person has no appearances; otherwise it is disabled with "Unlink or merge first".
- Appearances: one row per transcript, newest first, showing title, project path, date, which local voices are linked (`Speaker 0, Speaker 3`) and segment count. Each row opens the transcript and has **Unlink from this transcript**, which unlinks every local speaker of that transcript linked to this person.
- Names are trimmed, non-empty, limited to the existing 50-character speaker-name limit, and may use any Unicode characters. Duplicate names are allowed; §5 describes how a namesake is created deliberately.

### Organisations

- Organisations are created inline wherever a person's organisation is set: in the picker's create form (§5) or on the person page. The field offers type-ahead over existing organisations and creates a new one when nothing matches.
- Names are trimmed, non-empty and limited to 50 characters.
- When the list's organisation filter has one organisation selected, it offers **Rename organisation** and **Delete organisation**. Renaming updates everywhere the organisation is shown. Deleting clears it from its people and never deletes a person.
- There is no separate organisation management screen in this release.

### Hide

- Hiding removes a person from the picker's default suggestions and ordinary search results. When a search matches hidden people, they appear in a collapsed **Hidden (n)** section at the bottom of the results and remain selectable, so the user never creates a duplicate without seeing that a hidden namesake exists.
- Selecting a hidden person in the picker links them but does not unhide them.
- Hiding does not unlink transcripts or change editor labels, exports, counts or the person's page.

### Merge

- **Merge people** starts on the survivor's page. The user picks one or more people to fold into it and sees a preview of every transcript and local voice that will move.
- On confirmation, one transaction moves every link to the survivor and deletes the merged people. Either every link moves or none does.
- The survivor keeps its name, colour and organisation. It takes a merged person's organisation only when it has none of its own.
- Merge has no Undo; its preview and confirmation stand in for it. A wrong name is fixed afterwards with **Rename person**.
- Equal names never trigger an automatic merge.

## 5. The editor speaker control

Clicking any speaker label or avatar opens one popover. A switch at its top sets the scope before anything is selected:

`Whole speaker · 42 segments` | `This passage`

- It opens on **Whole speaker** when the transcript speaker is unlinked and has no custom label, because identifying is almost certainly the intent. It opens on **This passage** when the speaker is linked or has a custom label.
- Both scopes share one picker.
- The confirm button states the exact effect, for example `Identify Speaker 1 as Hamza Abikar · 42 segments` or `Move this turn to Tibo Sottiaux · 3 segments, 0:41`.

### The picker

- **Before typing**, it shows **In this transcript** (the identities present, in order of first appearance), then **Suggested**: people who appear in this transcript's project, most recent first, then the user's most recently seen people overall. Suggested is capped at about six rows.
- **Typing** searches the whole directory by name and organisation, ranked: this transcript, this project, recent, then everyone else. Matching hidden people appear in the collapsed Hidden section.
- Each person row shows a context line: `ACME · last in "Q3 steering", 12 Sep`.
- The last row is **Create new person "X"**. When people with exactly that name already exist (case-insensitive, trimmed), it reads **Create another "X"**. Choosing it expands an inline form with the name (prefilled) and an optional organisation field with type-ahead. Enter confirms and skips the organisation.
- Ranking only orders results; nothing is ever assigned without the user choosing it.

### Whole speaker scope

**Unlinked transcript speaker**

- **Identify this speaker across this transcript.** The user picks or creates a person. Confirming links this transcript speaker, and therefore all of its segments, to the person. Creating a person and linking happen in one operation. No other transcript speaker or transcript is affected.
- **Rename in this transcript only.** This sets the custom local label wherever the speaker occurs and creates no person. If the entered name matches existing people, the UI shows them and offers **Use existing person** as a separate choice. Clearing the label returns the speaker to `Speaker {ordinal}`.

**Linked transcript speaker**

- The popover shows **Linked to Hamza Abikar · ACME**; the name opens the person's page.
- **Change linked person** relinks this transcript speaker and states its transcript-wide scope and segment count.
- **Unlink from directory** removes the link. The speaker falls back to its custom local label or `Speaker {ordinal}`. It does not delete the person or set any segment to Unknown.
- **Rename person everywhere · 26 transcripts** renames the person, with the count of affected transcripts in the label.
- **Rename in this transcript only** is not offered. The user unlinks first, then renames.

Multiple transcript speakers in one transcript can be linked to the same person. This resolves a diarization result that split one person into two voices without rewriting the underlying segments. Because turns follow the displayed identity, adjacent segments from both voices form one continuous turn.

## 6. Correcting a passage

In **This passage** scope the user chooses:

- **This segment**, the default, which changes only the selected segment.
- **This continuous turn**, which changes the whole turn containing the segment, as defined in §3. The UI shows the number of segments and the time span before applying.

The target can be:

- a person, either existing or created inline;
- an existing transcript speaker of this transcript, linked or unlinked; or
- **Unknown speaker**.

A correction cannot create a new local-only label.

**How the target is stored:**

- If the target person is already linked from a transcript speaker in this transcript, that speaker is reused. If several are linked, the one with the most segments is reused, and ties go to the earliest created.
- Otherwise a new transcript speaker is created, linked to the person and given the next free `Speaker N` ordinal with no custom label and no diarization index. If it is later unlinked, it becomes a grey, generic voice.
- The original transcript speaker and its link stay intact for its other segments.
- A transcript speaker left with no segments stays in the database but is hidden from the picker and not counted.

**Remove speaker from this passage** sets the selected segment or turn to unassigned, shown as `Unknown speaker`. It must never be labelled **Reset to generic name**.

**The whole-segment limitation.** Splitting a segment when the speaker changes partway through is out of scope (§12). Until it exists, **This passage** scope shows one hint line: *"Speaker changes partway through a segment? Splitting isn't available yet — assign the segment to whoever says most of it."*

## 7. Saving, undo and conflicts

- Every editor speaker action is one call to an atomic database function. The editor applies it optimistically.
- **Undo.** After identify, change linked person, unlink, local rename, rename person, passage correction and remove speaker, a toast describes the change and offers **Undo** for about 8 seconds. Undo restores only if the affected rows still hold what the action wrote; otherwise it reports "Can't undo — changed since". Merge people has no Undo.
- **Failure.** Only the affected segments or speaker are rolled back in local state. The transcript is not reloaded, so unsaved text edits are never replaced. An error toast names the failed action ("Couldn't identify Speaker 1 as Hamza Abikar") and offers **Retry**. Nothing fails silently to the console.
- **Guarded writes.** Each call carries the values it expects to replace: the expected `person_id` when linking, relinking or unlinking, and the expected `speaker_id` of each segment in a correction. If they do not match, the database refuses the write. The editor then reloads only speaker data and segment assignments, never text, and shows "Changed in another tab — refreshed".
- **Ordering.** Within one tab, speaker actions for a transcript run one at a time through a queue, so they cannot complete out of order.
- **Refresh on focus.** The editor reloads speaker data and segment assignments when the tab regains focus. There is no realtime subscription for speakers, people or segments.

## 8. Behaviour of other app surfaces

### Editor

- Labels come from the resolver in §3, and turn headers follow the displayed identity.
- **Colours:**
  - Each person has a preferred colour. It is assigned at creation as the colour least used among the user's people, and can be changed on the person page.
  - Within a transcript, people claim their preferred colour in order of first appearance. A person whose colour is already taken gets the next free palette colour.
  - Unlinked transcript speakers are neutral grey. A generic one shows `S{ordinal}` on its avatar (`S0`, `S1`); one with a custom label shows its initials.
  - Unknown is neutral.
- The avatar tooltip for a linked person includes their organisation.
- The transcript speaker count is the number of distinct linked people plus the number of distinct unlinked transcript speakers referenced by segments. Unassigned segments do not count.

### Projects and Library

- Counts cover the project scope. Each distinct linked person counts once, however many transcripts they appear in. Each referenced, unlinked transcript speaker counts separately, including generic ones.
- The avatar preview shows people first, ordered by most recent appearance in scope, in their preferred colours. Unlinked voices follow in grey, and their tooltip names the transcript (`Speaker 0 · Q3 steering`).
- The existing rules for direct versus descendant project scope remain in force.
- The positional `palette_index` computation is removed from `project_speaker_summaries`.

### Exports

- DOCX, VTT, TXT and Markdown take every speaker label from the resolver. Paragraphs are grouped into turns by displayed identity.
- DOCX, Markdown and TXT start with a **Participants** block. It lists each identity in the transcript once, in order of first appearance: people with their organisation (`Tibo Sottiaux — ACME`), then unlinked voices by label. Unknown is not listed.
- VTT carries voice names only.
- An unassigned segment is `Unknown speaker` in every format. No export shows a different label merely because it follows a separate data path.

### Transcript lifecycle

- Deleting or moving a transcript updates a person's appearances and project locations, because both are derived from the links.
- A person persists when their last transcript is deleted.

## 9. Existing data

### Migration

- Every existing transcript speaker ID, segment assignment and export path is preserved.
- Each existing label is parsed once. `Speaker N` becomes ordinal N with no custom label. Any other label becomes the custom local label, with the next free ordinal in that transcript.
- Existing rows get no diarization index. The save function never runs again on a completed transcript, so none is needed.
- The unused `speakers.color` column is dropped; no row sets it.
- All existing transcript speakers start unlinked. No name-based merge runs automatically.

### Linking session

The existing named speakers are linked once, in a working session in chat, after the People directory ships (§12, slice 4). There is no in-app review screen, candidate grouping or bulk-link tool.

1. Claude prepares a proposal covering every named label in the user's account. Each row is one proposed person and lists:
   - the label variants merged into it;
   - the organisation taken from a name suffix (`Paul Reid ACME` → `Paul Reid`, organisation ACME);
   - the number of transcripts.
2. Anything uncertain is flagged rather than guessed: possible namesakes, role words inside names, and labels used as notes. For example, a "white noise" label is proposed as Unknown rather than a person.
3. The user corrects the proposal.
4. A script does a dry run that prints every change, then applies the whole proposal on the hosted project in one transaction.
5. The user checks the result on the People pages and fixes anything left with merge or unlink.

Other accounts are migrated but not linked. Newly completed transcripts stay unlinked until the user identifies their voices; project and recency signals only order the picker's suggestions.

## 10. Data integrity and security

- A person and an organisation each belong to one authenticated user. The database enforces these relationships, not just the picker:
  - Transcript speakers carry a `user_id` that must match their transcript's owner, enforced by a composite key.
  - `(person_id, user_id)` references `people (id, user_id)`, so a transcript speaker can link only to a person owned by the same user.
  - A person's organisation must belong to the same user.
  - `(transcript_id, speaker_id)` on segments references `speakers (transcript_id, id)`, so a segment can reference only a transcript speaker from its own transcript.
- New public tables get explicit least-privilege Data API grants, RLS and ownership policies in the same migration that creates them.
- Transcription processing may create transcript speakers but never creates or guesses people.
- **Stable diarization key.** `save_transcript_segments` identifies transcript speakers by `(transcript_id, diarization_index)`, not by label. The `(transcript_id, label)` uniqueness constraint is dropped. It would block two transcript speakers sharing a custom label and would collide with speakers created by corrections.
- **Atomic operations.** Creating a person and linking, changing a link, correcting several segments, merging people and deleting an organisation are each atomic. A partial failure cannot leave a misleading identity or a half-corrected turn.
- **Retranscription** is not a feature. The save function runs only before a transcription completes, and replays of a completed job are skipped. A future retranscription feature would need its own specification, because it would have to preserve identity links, text edits and passage corrections.
- **Rollout.** Migrations are tested against local seed data, then applied to the hosted project with `supabase db push`. Recovery relies on the Pro plan's daily physical backups, which run at about 01:15 UTC and are kept for about a week. Before pushing a migration that touches speakers or segments, confirm with `supabase backups list` that the day's backup has completed.

## 11. Key acceptance scenarios

1. **Reuse across transcripts:** identify `Speaker 0` in transcript A as Hamza, then identify `Speaker 3` in transcript B as that same person. Hamza has one directory entry with two transcripts, and a project containing both counts him once.
2. **Namesake:** create another Hamza through **Create another "Hamza"**. The picker shows each one's organisation and last transcript. No automatic merge occurs.
3. **One person, two diarization IDs:** link two local speakers in one transcript to Hamza. Where their segments are adjacent they form one continuous turn. The transcript and project count him once, and either local speaker can later be unlinked independently.
4. **Wrong segment:** change one Matthew segment to Tibo. Matthew's other segments and link stay intact. Undo restores the original segment.
5. **Unknown turn:** remove one turn's speaker. It displays `Unknown speaker` and does not count as a speaker; neighbouring turns keep their identities. Reassigning it restores a named speaker.
6. **Global rename:** rename Hamza Abikar to Hamza, either on the person page or with **Rename person everywhere** in the editor. All linked editor views, directory entries, project previews and newly generated exports use Hamza. Unlinked speakers with the old name as a custom label stay unchanged.
7. **Merge:** merge two duplicate people into a chosen survivor. Every linked transcript speaker now points to the survivor, counts deduplicate, and text and timing are untouched. A failed merge changes nothing.
8. **Linking session:** after the session, three spelling variants of one person resolve to one person, and projects count them once. Each transcript speaker keeps its original custom label, which returns if it is unlinked.
9. **New transcript:** a fresh `Speaker 1` stays grey and unlinked even though Hamza is in the directory. When the user opens its picker, people from the transcript's project are suggested first, and the user can explicitly identify it as Hamza.
10. **Transcript-only label:** rename an unlinked speaker to `Interviewer` without creating a person. Its segments show that label in this transcript only, and another transcript with `Interviewer` stays unrelated.
11. **Namesakes in one transcript:** two different people named Paul, at different organisations, are linked in one transcript. The editor and every export show `Paul (ACME)` and `Paul (Globex)`.
12. **Colours:** identify a grey `S0` as Hamza, and it takes Hamza's preferred colour. If another person in the transcript already holds that colour, Hamza gets the next free one.
13. **Failure and access control:** a failed write rolls back only the affected rows, shows an error toast with Retry and loses no text edits. A user cannot read or link another user's person or organisation, and a segment cannot point to another transcript's speaker.
14. **Stale tab:** tab A links `Speaker 1` to Hamza, then a stale tab B tries to link it to Tibo. The write is refused, and tab B refreshes and shows Hamza.

## 12. Delivery

The overhaul ships in four slices, each with its own implementation plan and pull request:

1. **Foundations.** The only visible change is a consistent `Unknown speaker` label.
   - The new transcript speaker model: `ordinal`, `custom_label`, `diarization_index` and `user_id`.
   - Constraint changes and composite keys; dropping `color`.
   - `save_transcript_segments` keyed on the diarization index.
   - One label resolver in `core/`, used by the editor and all exports.
   - Atomic, guarded speaker functions in the database.
2. **People in the editor.**
   - `people` and `organisations` tables with grants and RLS.
   - The new speaker popover with both scopes and inline creation.
   - Undo and Retry toasts, the action queue, and refresh on focus.
   - Turns by displayed identity, the colour rules, resolved export labels and the Participants block.
3. **People directory and project summaries.**
   - The list and person pages, with rename, organisation, colour, hide, delete, per-appearance unlink and merge.
   - The rewrite of `project_speaker_summaries`.
4. **Linking session** on the hosted data (§9).

Out of scope for this overhaul:

- automatic voice identification across recordings;
- team-shared directories, contact imports and biometric voice profiles;
- aliases;
- an in-app review or bulk-link tool;
- splitting and merging segments, which will get its own specification together with loading real word timings into the editor;
- retranscription;
- realtime sync;
- organisation history;
- merge suggestions.

## 13. Product language to preserve

| User intention | UI wording | Effect |
|---|---|---|
| This voice throughout this recording is Hamza | **Identify this speaker across this transcript** | Link one transcript speaker to Hamza's identity. |
| This one passage was said by Tibo | **Change speaker for this passage** | Reassign the chosen segment or continuous turn only. |
| I cannot tell who said this passage | **Remove speaker from this passage** | Set the chosen segment or turn to Unknown. |
| This local voice should no longer refer to Hamza | **Unlink from directory** | Remove one transcript speaker's link; keep its segment assignments and local label. |
| Hamza should not be linked anywhere in this transcript | **Unlink from this transcript** (person page) | Remove every link from this transcript to Hamza. |
| I only need a label in this recording | **Rename in this transcript only** | Change one unlinked transcript speaker's local label without creating or linking a person. |
| Hamza's name is wrong everywhere | **Rename person** (person page) · **Rename person everywhere · N transcripts** (editor) | Update the person's name on every linked occurrence. |
| This is a different person who shares a name | **Create another "Hamza"** | Create a separate person with the same name. |
| These two entries are one person | **Merge people** | Move every link to one chosen surviving person. |
| Keep this person out of my suggestions | **Hide** | Remove from default suggestions and ordinary search; nothing else changes. |

These actions must not share an ambiguous **Tag**, **Rename** or **Reset** label when their scopes differ.

## 14. Decision log (review of 24 September 2026)

| # | Decision | Why |
|---|---|---|
| 1 | Existing speakers are linked in a one-off session in chat, not through an in-app review flow. | The data is one user's; an in-app flow would be built for a single use. |
| 2 | Migrations must preserve the hosted data. | It is the user's real data: 62 transcripts and 83 named labels. |
| 3 | Organisation is its own optional table. | Namesakes are currently told apart by company suffixes; a filter by organisation is useful. |
| 4 | A person has one current organisation, with no history. | It is used for disambiguation and filtering, where the current organisation is what matters. |
| 5 | Turn labels show names only; DOCX, MD and TXT get a Participants block with organisations; namesakes in one transcript get the organisation added. | Organisation on every turn is noise, but readers still need it once. |
| 6 | Aliases are out of scope. | Substring search and the linking session cover spelling variants. |
| 7 | Each person has a preferred colour, resolved per transcript by first appearance; unlinked voices are grey. | Identified people are always distinct, grey means "still to identify", and `palette_index` can be deleted. |
| 8 | Rename in this transcript only applies to unlinked speakers only. | A linked speaker always shows its person's name; no override layer. |
| 9 | Correction targets are a person, an existing transcript speaker, or Unknown. | Creating new local labels from a correction is today's confusing Tag. |
| 10 | A speaker created by a correction gets the next free `Speaker N`. | Unlinking should give an honest generic voice, not a stale name. |
| 11 | A turn is defined by displayed identity everywhere. | Corrections are per segment anyway; this matches what the user sees. |
| 12 | One popover with a scope switch that defaults to the likely scope. | The frequent identify path takes one click, and scope is always visible. |
| 13 | People are created inline; namesakes need **Create another**; organisation is optional in the same step. | No dialog for a choice the user has just seen; organisation is set without leaving the editor. |
| 14 | Optimistic changes with an Undo toast for every editor action except merge. | Identifying 42 segments as the wrong person is the costliest slip in the editor. |
| 15 | Guarded writes, refresh on focus and a per-transcript queue; no realtime. | Safe with one user and a rare second tab, without publishing segments. |
| 16 | The directory is called **People**, at `/people`. | "Speakers" would blur the person and transcript-speaker distinction. |
| 17 | The People list is ordered by recent appearance by default, with an organisation filter. | The people who recur are the ones the user looks for. |
| 18 | A person can be deleted only with zero appearances, and each appearance can be unlinked on the person page. | Typos can be cleaned up, but one click never unlinks dozens of transcripts. |
| 19 | Merge keeps the survivor's details, moves every link in one transaction and has no Undo. | Simplest correct behaviour; rename afterwards covers naming. |
| 20 | Hidden people appear in a collapsed section when a search matches them. | Prevents accidental duplicates. |
| 21 | Summary counts follow the original spec: every unlinked voice counts separately. | The user's choice. Grey avatars name their transcript to tell them apart. |
| 22 | Transcript speakers store `ordinal` and `custom_label`. | Needed to tell generic voices from named ones reliably and to restore the original number. |
| 23 | The linking session covers all named labels. | Unlinked variants would otherwise be double-counted in summaries. |
| 24 | Splitting and merging segments get their own specification. | The editor does not load real word timings, and text edits do not update words. |
| 25 | Build in this order: foundations → people in the editor → directory and summaries → linking session. | The directory exists to check and fix the linking script's result. |
| 26 | Plain `db push`, relying on Pro daily backups. | Development-only data with one user; backups confirmed running. |
| 27 | Picker ranking: this transcript, then this project, then recent, then everyone else. | The project is the strongest signal for who is speaking. |
| 28 | **Rename person everywhere · N transcripts** is available in the editor; organisation and colour are changed on the person page. | Typos are usually spotted right after creating a person. |

### Details filled in while writing this spec (not discussed in review)

- Organisation rename and delete live in the People list's organisation filter, since there is no separate management screen.
- The Participants block also lists unlinked voices; Unknown is not listed.
- The Undo window is about 8 seconds.
- Clearing a custom local label returns the speaker to `Speaker {ordinal}`. This replaces **Reset to generic name**.
- **Unlink from this transcript** on the person page unlinks every local speaker of that transcript linked to the person.
- Organisation names use the same 50-character limit as person names.
- The original spec's name-based merge *suggestions* are out of scope.
