# Transcript editor

**Scope reviewed:** `frontend/app/(app)/editor/[id]/**` (EditorScreen 660, hooks 4,146, components 1,391), `lib/editor/**`, `core/editor/**`, `core/transcript/**`, `core/speakers/**`, `lib/speakers/**`, AudioPlayer/Waveform/CollapsibleWaveform/FloatingPlayerDeck/FindReplaceModal/SpeakerPopoverContent/UndoList, `lib/audio/useScrub*`, `contracts/editor.ts`, media-url and waveform-url routes, `guardedNavigation.tsx`, the editor queries in `lib/supabase/queries.ts`, and the text/split RPCs. About 10.5k lines.

**Scorecard:**

| Lens | Score | Why |
|---|---|---|
| Maintainability | 3 | Hooks are small and well tested, but the state engine sits in `app/`, is wired through mutable bridges, and keeps segment text in several copies. |
| Scalability | 2 | Every keystroke runs several full passes over all segments. Replace All is O(K·N). Load and reload pull the whole transcript (~20 MB JSON at 100k words) one page at a time. |
| Reliability | 4 | The resend, guard, queue and leave design is careful and heavily tested. The main gap: an edit made in another tab is found only when the user's own draft gets refused. |
| Performance | 2 | The per-frame clock is well contained. But there is no memo boundary, so every keystroke, every ~10 Hz timeupdate and every scrub move re-renders all mounted cards. |

**Summary:** On correctness the editor is strong. Every write is guarded and resend-safe, everything runs through one ordered queue, history steps hold diffs rather than snapshots, and reliability tests cover lost answers, conflicts and leaving. Scale is where it is weak. `EditorScreen` owns all the state, and the cards have no memo boundary. Each keystroke copies the segment array, which feeds several derived passes over all segments, and the 10 Hz playback state re-renders every visible card. A 5–10 h transcript (about 5k segments, 100k words) will feel slow to type in and slow to open. **Biggest risk:** typing latency and Replace All freezes on long transcripts. Both come from the same architectural cause: a single owner of the state that has no per-segment subscriptions.

## Findings

### [P1] Every keystroke, playback tick and scrub move re-renders every mounted card
- Lens: performance
- Evidence: `useEditorPlayback.ts:41-43,117-121` keeps `audioCurrentTime`, `audioDuration` and `audioProgress` as state inside EditorScreen, updated on every timeupdate (`components/AudioPlayer.tsx:405`, quantised to 100 ms). Scrubbing sets the same state on every pointer move (`useEditorPlayback.ts:139-147`, `AudioPlayer.tsx:254-258`). Nothing in the editor is wrapped in `React.memo` (grep finds none). `TranscriptList.tsx:88` passes an inline `itemContent`, and with `overscan={1200}` (`:86`) Virtuoso keeps roughly 30–40 cards mounted. Each card gets the whole `editingTexts`/`saveStatus` records and `editingId` (`TranscriptList.tsx:109-111`) and renders three Radix Tooltips plus one span per word.
- Why it matters: While audio plays, every visible card reconciles about 10×/s, and about 60×/s during a scrub, even though only the active card's word changes. The frame-accurate clock itself is isolated correctly (`useCurrentWordIndex.ts:33`, `EditorScreen.tsx:233-234`); the expensive part is the timeupdate state.
- Recommendation: Move the time, progress and duration values into a small external store (like `playbackClock`) that only Waveform, FloatingPlayerDeck and MiniWaveformProgress subscribe to. Wrap `TranscriptList` in `React.memo` and give it a stable `itemContent`. Then memo the card on per-segment primitives: `isEditing`, that segment's draft text, save status and matches.
- Effort: M (the TranscriptList memo alone is S)
- Confidence: high

### [P1] Each keystroke makes several O(N) passes over the whole transcript
- Lens: scalability
- Evidence: `useTranscriptMutations.ts:301` builds a new `segments` array on every `onChange`, and every one of these recomputes when it does:
  - `createSegmentLocator` (`EditorScreen.tsx:227`)
  - `resolveSpeakerPresentation`/`buildSpeakerDisplay` (`useSpeakerAssignments.ts:177-180`)
  - `summariseSpeakers`, which rebuilds 240-char excerpts for every turn (`useSpeakerOverview.ts:49-50`, `core/speakers/talk.ts:76-79`)
  - `segmentsById` in FindReplaceModal, even while it is closed (`FindReplaceModal.tsx:129-135`)
  - a full lowercase search whenever a find term is set (`useTranscriptSearch.ts:49-74`); the term survives closing the modal (`FindReplaceModal.tsx:101-105`)
  - `segments.findIndex` (`useTranscriptSync.ts:217-224`)
- Why it matters: At 5k segments that is 6+ full passes plus megabytes of short-lived strings per keystroke, on top of the card re-renders above. Input lag grows linearly with transcript length.
- Recommendation: Keep typed text in the draft store, not in the `segments` array, until a save, a reload or an undo actually changes it. The alternative is to key the derived structures (locator, presentation, overview) on a "shape and speaker" version, so they don't depend on the array's identity.
- Effort: M
- Confidence: high on the passes, medium on the size of the lag

### [P1] Replace All is O(K·N) plus O(K²) on the main thread
- Lens: scalability
- Evidence: `useTranscriptSearch.ts:164` calls `scheduleSave` once per changed segment. Each call does:
  - an O(N) `find` (`useTranscriptMutations.ts:293`)
  - an O(N) `segments.update(prev => prev.map…)`, run twice: once on the ref and once as the React updater (`:301`, `useLiveStore.ts:23-24`)
  - a `setSaveStatus` that spreads a record that never shrinks; entries go back to `'idle'` but are never deleted (`:75,79`)
  - one debounce timer and, later, one reset timer (`:77,306`)
- Why it matters: Replacing "the" in a 10 h transcript (K ≈ 3–5k, N ≈ 5k) copies tens of millions of elements, then fires K separate status-reset timers 1.2 s later, each calling setState. The tab can freeze for seconds. The database write itself is already a single batched RPC.
- Recommendation: Add `scheduleSaves(edits[])`: set every draft, do one `segments.update`, one status update and one timer. Keep save status in a `Map` and delete entries when they go idle.
- Effort: S
- Confidence: high

### [P2] Load and every reload fetch the whole transcript, one page at a time
- Lens: scalability
- Evidence: `queries.ts:90-111` fetches pages one after another. Words are embedded with `segment_id` included (`queries.ts:467`), which is about 25% of each ~210-byte word row, so 100k words come to ~21 MB of JSON. Nothing renders until every segment page has arrived (`useEditorData.ts:261-276`). Title and metadata are fetched only after that (`:282`). `groupSourceWords` runs a Zod parse on every word row on the main thread (`utils.ts:39-40`). `reloadSegments` downloads everything again (`useTranscriptMutations.ts:99`), and it runs after every conflict or unknown outcome through `repair` → `bridge.refresh` (`useEditorHistory.ts:116-125`, `EditorScreen.tsx:170`).
- Why it matters: Opening a long transcript takes seconds. A single conflict while working on a 10 h file costs another ~20 MB download and parse.
- Recommendation: Group embedded words by their parent row and drop `segment_id` from them. Fetch pages in parallel, or use keyset paging and render the first page early. Make reload incremental: read `id, revision, updated_at`, then refetch only the rows that changed. Fetch metadata in parallel with the segments.
- Effort: M
- Confidence: high on the mechanism, medium on timings

### [P2] Text changed in another tab stays invisible until the user's own draft is dropped
- Lens: reliability
- Evidence: The editor subscribes to no Realtime channel (grep). The refresh on focus reads only `id, speaker_id, revision` (`queries.ts:452-465`, called from `useSpeakerAssignments.ts:117-175`). A refused save triggers a reload that drops the draft and shows "wasn't saved" with a copy option (`useTranscriptMutations.ts:117-126,151`).
- Why it matters: Tab A edits a segment. The user goes back to tab B; the focus refresh sees nothing. They type a paragraph into that segment, the save is refused 500 ms later, and the paragraph survives only as a toast to copy from. Nothing is lost silently, but it is a lost edit from the user's point of view.
- Recommendation: Add `updated_at` to the focus refresh (segments already has an update trigger, `infra/supabase/migrations/20260114000000_initial_schema.sql:163`) and reload changed rows before the user types. Later, consider a Realtime channel for the open transcript.
- Effort: S (focus refresh) / M (Realtime)
- Confidence: high

### [P2] Segment text has several live copies, kept in sync only by convention
- Lens: maintainability / reliability
- Evidence: The copies are `segments[i].text` (optimistic), `editingTexts` (`useTranscriptMutations.ts:40`), the `drafts` and `baseline` refs (`:46,53`) and the card's `typedRef` (`TranscriptSegmentCard.tsx:327`).
  - `editingTexts` is written in 8 places: `TranscriptSegmentCard.tsx:143,514`, `useTranscriptSearch.ts:135,163`, `useSegmentSplit.ts:67,101`, `useTranscriptMutations.ts:146,234`.
  - Search and Replace read it first (`useTranscriptSearch.ts:55,130,144`).
  - Its entries are never removed, and it differs from `segments` only during an IME composition (`TranscriptSegmentCard.tsx:507-515`).
- Why it matters: Every writer today updates both copies. But a future text writer that forgets `editingTexts` would make Replace build text from the stale copy. Its guard compares against `baseline`, so the write would succeed and overwrite the segment. The search snippets (`FindReplaceModal.tsx:132`) and the match offsets also read different copies.
- Recommendation: Delete `editingTexts`. Keep composition text local to the card, and have everything read through one selector over segments plus drafts.
- Effort: M
- Confidence: high on the structure, medium on the failure (it is hypothetical)

### [P2] The editor's state engine lives in `app/` and is wired through mutable bridges
- Lens: maintainability
- Evidence: Contrary to "app is thin":
  - `hooks/` is 4,146 lines.
  - `speakerActions.ts` (474 lines) is not a hook. It calls queries directly and keeps module-global `savedIds`/`provisionalCount`, which are never cleared (`:101-106`).
  - Pure logic sits in `app/`: `utils.ts:36-154`, `hooks/segmentSplit.ts`, `scrollSyncMachine.ts`, the search and Replace All maths (`useTranscriptSearch.ts:49-74,140-165`) and draft reconciliation (`useTranscriptMutations.ts:108-134`).
  - EditorScreen breaks circular dependencies with refs that it reassigns on every render (`EditorScreen.tsx:60-61,78-80,164-194`).
  - Hooks take each other's whole return value (`useSegmentSplit.ts:27`).
  - The generic write queue lives in app hooks (`useEditorWriteQueue.ts`) while its sibling `untilAnswered` is in `lib/editor/`.
- Why it matters: It is hard to see who owns what, and changing one hook ripples through EditorScreen. This structure is also what blocks per-segment subscriptions, which the two P1 performance findings need.
- Recommendation: Create one `EditorSession` per transcript in `lib/editor/`: plain TypeScript holding the queue, sender, holds, history, and segment, word and draft stores, each with `subscribe` and selectors. Move the pure parts to `core/editor` and `core/transcript`. EditorScreen then only composes. Also inject the speaker writer into the speaker op algebra.
- Effort: L
- Confidence: high

### [P3] The Find & Replace snippet list is not virtualised
- Lens: performance
- Evidence: `FindReplaceModal.tsx:137-151` builds a snippet for every match, and `:252-274` renders a button for each one. The list is rebuilt whenever `matchIndex` changes (Next/Prev) or `segments` changes.
- Why it matters: A common word gives thousands of DOM rows, rebuilt on each Next press.
- Recommendation: Cap the list (e.g. 200 plus "N more") or virtualise it.
- Effort: S
- Confidence: high

### [P3] TranscriptSegmentCard mixes three concerns behind 26 props
- Lens: maintainability
- Evidence: Header row at `TranscriptSegmentCard.tsx:53-165`. Textarea, IME and history plumbing at `:283-388,466-544`. Search-highlight and word rendering at `:547-589`, which also sorts and filters matches per token on every render (`:408,553`).
- Why it matters: This is the most-changed UI surface, and its shape makes the memo work above hard.
- Recommendation: Split it into `SegmentEditor` and `SegmentReadView`, and move the match-to-token splitting into a pure function in core.
- Effort: M
- Confidence: high

## Quick wins
- Wrap `TranscriptList` in `React.memo` and stabilise `itemContent`. Its props don't change on a timeupdate, so this alone stops the 10 Hz full re-render.
- Batch Replace All saves into `scheduleSaves`, and store save status as a Map that deletes entries when they go idle.
- Add `updated_at` to `fetchSegmentSpeakerAssignments` and reload rows changed elsewhere when the tab gets focus.
- Cap the find snippets, and don't build `segmentsById` or `snippets` while the modal is closed.
- Stop swallowing metadata and waveform errors (`useEditorData.ts:179,288`; title, engine and duration silently never appear). Move `savedIds` into per-editor state.

## Zero-in candidates
1. **Editor state architecture (EditorSession plus per-segment subscriptions).** One refactor fixes both P1 performance findings and the two P2 maintainability findings. Start with a scale harness: a 5k-segment, 100k-word fixture that measures keystroke latency and card render counts.
2. **The load and reload path for long transcripts.** Payload shape, parallel or keyset paging, incremental reload, and possibly parsing the words off the main thread.
3. **Multi-tab coherence policy.** Decide between a focus refresh using `updated_at` and Realtime, and decide what a conflict should do with a draft other than drop it.

## Test coverage notes
- **Covered:** 31 files under `__tests__/editor/` and 6 under `__tests__/speakers/`, plus `editor.test.tsx` (1,286 lines), `word-alignment`, `segment-split`, `segment-builder`, `audioPlayer`, `waveform`, `findReplaceModal.ui`, `useScrubGesture`, `guardedNavigation`, and the split and history-guard migration tests.
- **Risky paths are tested well:** `useTranscriptMutations.test.ts` (34 cases: lost answers, conflicts, unknown outcomes), `useEditorHistory.test.tsx`, `untilAnswered.test.ts`, `useLeaveEditor.test.ts`.
- **Gaps:**
  - There is no scale or render-count test, and `__mocks__/react-virtuoso.tsx` renders every item, so render-cost regressions can't show up in tests.
  - `speakerActions.ts` has no direct tests (only through `useSpeakerAssignments.test.ts`).
  - The media-url and waveform-url route handlers are tested only as mocked fetches.
  - FloatingPlayerDeck and UndoList have no tests of their own.
  - Nothing tests IME composition overlapping a reload or an undo.

## Cross-domain notes
- `set_segment_texts_guarded` is SECURITY INVOKER and does not call `require_completed_transcript`, unlike the speaker RPCs (`infra/supabase/migrations/20261023120000_workos_auth.sql:1310-1342`). The DB domain should confirm that RLS and triggers cover this.
- `paginateRows` fetches pages one after another for every caller (`lib/supabase/queries.ts:90-111`), not only the editor.

## Open questions
- Do K reset timers that fire at the same moment produce K separate React renders? This depends on how the scheduler interleaves with timer tasks; I didn't measure it.
- The `useAudioSessionRecovery.ts:142-148` timeout re-arms recovery but leaves the listeners attached. If the new source fails after 5 s, it may fetch media-url again; I didn't confirm whether that can loop.
- `sendOnce` on unmount expects `baseline.text` even when a save of the same segment is still in flight (`useLeaveEditor.ts:167`, `useTranscriptMutations.ts:327-336`). If that save commits first, the newer draft is refused (the user is told, with the text to copy). Is that acceptable?

## What's good
- Every write carries an expectation and recognises its own earlier success, and `untilAnswered` (`lib/editor/untilAnswered.ts`) settles "unknown outcome" correctly. This pattern is worth reusing elsewhere.
- History steps are diffs plus inverse ops (`speakerActions.ts` op algebra), not snapshots. Memory at the 1,000-step cap stays at a few MB, and only a Replace All step grows with transcript size.
- The playback clock is isolated per frame through `useSyncExternalStore` with primitive snapshots, so only the active card follows the word.
- Word alignment is memoised per card and bounded: segments cap at about 25 s (`segment-builder.ts:48-51`) and LCS stops at 40k cells (`word-alignment.ts:49`).
