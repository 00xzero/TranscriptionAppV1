# Editor Page Decomposition Plan

**Date:** 2026-03-15
**Status:** Approved
**Scope:** Editor-only. No webhook, pipeline, schema, or export-route changes.
**Goal:** Decompose `app/editor/[id]/page.tsx` (1551 lines) into focused hooks, components, and utilities. No UX changes.

---

## End State

```
app/editor/[id]/
├── page.tsx                           # ~15 lines — thin synchronous wrapper, renders EditorScreen
├── EditorScreen.tsx                   # ~200 lines — client orchestrator, composes hooks + renders layout
├── types.ts                           # ~30 lines — editor-local type aliases
├── utils.ts                           # ~70 lines — pure functions + constants
├── hooks/
│   ├── useEditorData.ts               # ~90 lines — data fetching + reload helper
│   ├── useTranscriptSync.ts           # ~180 lines — scroll sync, follow mode, active segment
│   ├── useEditorPlayback.ts           # ~120 lines — audio state, seeking, scrubbing
│   ├── useTranscriptMutations.ts      # ~60 lines — inline editing, debounced autosave
│   ├── useTranscriptSearch.ts         # ~180 lines — find/replace with match navigation
│   ├── useSpeakerAssignments.ts       # ~150 lines — speaker assign/create/rename/untag
│   ├── useProjectTitleEditing.ts      # ~40 lines — title editing only (save, blur, escape)
│   └── useEditorKeyboardShortcuts.ts  # ~50 lines — keyboard shortcuts + CustomEvent listeners
└── components/
    ├── EditorHeader.tsx               # ~80 lines — title editing, status/meta row, divider
    ├── TranscriptList.tsx             # ~60 lines — Virtuoso wrapper
    ├── TranscriptSegmentCard.tsx      # ~120 lines — single segment (includes SegmentHeaderRow)
    ├── MixModeBanner.tsx              # ~20 lines — warning when source === 'segments'
    └── SyncToAudioButton.tsx          # ~30 lines — floating sync/follow button
```

**Size targets:** `page.tsx` under 20 lines, `EditorScreen` under 200 lines, no hook or component over 250 lines.

---

## Prerequisites

### Fix AudioPlayer Mock Path (must happen before any extraction)

The jest config uses a brittle relative path for the AudioPlayer mock:

```js
// CURRENT (breaks if any extracted file imports AudioPlayer from a different depth)
'^\\.\\./\\.\\./\\.\\./components/AudioPlayer$': '<rootDir>/__mocks__/AudioPlayer.tsx'
```

**Fix:** Replace with an alias-based pattern and ensure it comes before the generic `@/` mapper:

```js
moduleNameMapper: {
  '^@/components/AudioPlayer$': '<rootDir>/__mocks__/AudioPlayer.tsx',  // BEFORE generic alias
  '^@/(.*)$': '<rootDir>/$1',
  '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  '^react-virtuoso$': '<rootDir>/__mocks__/react-virtuoso.tsx',
}
```

Remove the old relative-path entry. Run all tests to verify.

**File:** `frontend/jest.config.js`

---

## Slice 1: Utilities and Types

**Goal:** Extract zero-behavior-change pure code. Smallest possible first commit.

### 1a. Create `types.ts`

Move type aliases from page.tsx lines 26-32:
- `Word` (alias for `EditorWord`)
- `Seg` (Chunk with optional words)
- `Speaker` (alias for `SpeakerType`)
- `Match`, `SegmentMatch`, `SaveStatus`, `SaveStatusBySegment`

### 1b. Create `utils.ts`

Move constants (lines 34-46) and pure functions (lines 48-98, line 1544):
- Constants: `SAVE_DEBOUNCE_MS`, `SYNC_OFFSET_MS`, `SEEK_LOCK_MS`, `PROGRAMMATIC_SCROLL_RESET_MS`, `ACTIVE_CARD_VISIBILITY_MARGIN_PX`, `ASCII_WORD_CHAR_REGEX`, `NON_CASED_WORD_CHAR_REGEX`, `COMBINING_MARK_START`, `COMBINING_MARK_END`, `SCROLL_INTENT_KEYS`
- Functions: `isUnicodeWordChar`, `computeWordsForSegment`, `computeWordsForSegments`, `formatProjectDate`, `formatDurationHHMMSS`, `msToTimestamp`

Do **not** carry forward dead constants that have no active behavior in the current page. `SEEK_RESUME_TIMEOUT_MS` and `SEEK_TOLERANCE_MS` should be deleted during extraction, not moved.

### 1c. Update `page.tsx`

Replace definitions with imports from `./types` and `./utils`. Remove the now-empty constant/function blocks — don't leave commented-out or dead code behind.

**Gate:** `npm test` + `npm run build` green.

---

## Slice 2: Introduce EditorScreen

**Goal:** Split route wrapper from client logic. No logic change.

### 2a. Create `EditorScreen.tsx`

Move the entire `"use client"` component body from `page.tsx` into `EditorScreen`. It receives `projectId: string` as its only prop.

### 2b. Reduce `page.tsx` to synchronous thin wrapper

This is a Next.js 14 app — `params` is a plain object, not a Promise. Keep the wrapper synchronous so tests can render it directly without async complications.

```tsx
import EditorScreen from './EditorScreen'

export default function EditorPage({ params }: { params: { id: string } }) {
  return <EditorScreen projectId={params.id} />
}
```

### 2c. Test import

The test file imports from `'../app/editor/[id]/page'`. Since `page.tsx` still default-exports a synchronous component, the test works without changes.

**Gate:** `npm test` + `npm run build` green.

---

## Slice 3: Data, Title, Text Mutation, and Speaker Hooks

**Goal:** Extract the four hooks with the simplest interfaces first.

### 3a. `hooks/useEditorData.ts` (~90 lines)

**Moves:** The data loading `useEffect` (lines 389-451).

**Owns:**
- State: `audioSrc`, `status`, `segments`, `speakers`, `source`, `projectTitle`, `projectCreatedAt`, `projectDurationSecs`
- A `reloadTranscript()` helper that re-fetches transcript data + speakers (used by speaker assignment rollback)

**Returns:** All state + setters. Other hooks mutate `segments`, `speakers`, `projectTitle` via these setters.

**Imports:** `fetchTranscriptData`, `fetchSpeakers`, `fetchProjectById` from `@/lib/supabase/queries`

### 3b. `hooks/useProjectTitleEditing.ts` (~40 lines)

**Moves:** Title editing state + handlers only (lines 1139-1184).

**Owns:**
- State: `editingTitle`, `titleInput`, `titleSaveError`
- Refs: `titleInputRef`, `isSavingTitleRef`
- Handlers: `startEditingTitle`, `saveTitle`, `onTitleKeyDown`, `onTitleBlur`

**Does NOT own:** `uniqueSpeakerCount`, `showStatusInMetaRow`, `isStatusError` — these are header/meta display concerns that belong in `EditorHeader` or `EditorScreen`, not in a title-editing hook.

**Params:** `projectId`, `projectTitle`, `setProjectTitle`

### 3c. `hooks/useTranscriptMutations.ts` (~60 lines)

**Moves:** Inline editing state + debounced autosave (lines 195-200, 787-831).

**Owns:**
- State: `editingId`, `editingTexts`, `saveStatus`
- Refs: `textAreaRefs`, `saveTimers`, `saveStatusResetTimers`
- Handler: `scheduleSave` (optimistic segment text update + debounced DB write)
- Cleanup effect for save timers

**Params:** `source`, `setSegments`

### 3d. `hooks/useSpeakerAssignments.ts` (~150 lines)

**Moves:** Speaker management (lines 870-1137).

**Owns:**
- State: `speakerPopover`
- Memos: `speakersMap`, `speakerColorMap`, `speakerColorPalette`, `colorForSpeaker`
- Handlers: `handleAvatarClick`, `handleSelectSpeaker`, `handleCreateSpeaker`, `handleRenameSpeaker`, `handleUntag`

**Params:** `projectId`, `speakers`, `setSpeakers`, `segments`, `setSegments`, `source`, `reloadTranscript`

**Rollback strategy:** On failed speaker assignment, calls `reloadTranscript()` from `useEditorData` rather than inline re-fetching.

**Cleanup discipline:** After each hook extraction in this slice, immediately remove the moved code, its now-unused refs/state/imports from `EditorScreen`. Don't leave dead declarations behind — clean as you go.

**Gate:** `npm test` + `npm run build` green.

---

## Slice 4: Playback and Transcript Sync Hooks

**Goal:** Extract the two most coupled hooks. Order matters.

### 4a. `hooks/useTranscriptSync.ts` (~180 lines) — extract FIRST

**Why first:** `useEditorPlayback` calls `syncActiveSegment` on every audio time update. Extracting sync first means the audio hook can receive `syncActiveSegment` as a parameter. This avoids circular dependencies.

**Owns:**
- State: `syncDirection`, `isFollowMode`, `hasUserScrolled`, `activeIds`, `scrollParent`, `waveformCollapsed`
- Refs: `virtuosoRef`, `transcriptScrollRef`, `visibleRangeRef`, `segmentsRef`, `isUserScrollingRef`, `isProgrammaticScrollRef`, `programmaticScrollResetTimerRef`, `isScrubbingRef` (created here, mutated by playback hook), `clickLockRef` (manual-seek lock, created here)
- Handlers: `findActiveSegmentId`, `syncActiveSegment`, `handleRangeChanged`, `scrollToSegmentIndex`, `ensureActiveSegmentVisible`, `centerActiveSegment`, `scrollTranscriptToTop`, `handleReturnToTop`, `setSeekLock`, `isSeekLocked`
- Effects: scroll detection listeners, follow-mode auto-scroll, waveform collapse on scroll >50px, disable follow mode when `editingId` or `speakerPopover` are truthy

**Params:** `segments`, `editingId`, `speakerPopover`

**Shared ref ownership:** Both `isScrubbingRef` and `clickLockRef` are created in this hook and returned to the caller. The playback hook calls `setSeekLock()` when the user manually seeks (click, scrub) and sets `isScrubbingRef.current` during drag operations. The sync hook reads both refs internally — `syncActiveSegment` skips sync while scrubbing or seek-locked. This keeps all "should I sync?" logic in one place and avoids circular imports.

### 4b. `hooks/useEditorPlayback.ts` (~120 lines) — extract SECOND

**Owns:**
- Refs: `audioPlayerRef`, `wasPlayingBeforeScrubRef`, `readyRef`, `pendingSeekRef`, `seekTimeoutRef`
- State: `audioElement`, `ready`, `playing`, `audioProgress`, `audioCurrentTime`, `audioDuration`, `playbackRate`
- Handlers: `handleAudioPlayerRef`, `handleAudioReady`, `handleAudioError`, `handlePlayingChange`, `handleTimeUpdate`, `handleScrubPreview`, `handleScrubPreviewFraction`, `seekToMs`, `togglePlay`, `seekRelative`, `onRateChange`, `onWordClick`, `onSegmentClick`, `syncTranscriptToPlayer`
- Scrub handlers: `handleMiniScrubStart`, `handleMiniScrub`, `handleMiniScrubEnd`, `handlePlayerDragStart`, `handlePlayerDragEnd`
- Integrates `useAudioSessionRecovery`

**Does NOT own:** `clickLockRef` — moved to `useTranscriptSync`. Playback calls `sync.setSeekLock()` when seeking instead of managing the lock ref directly.

**Params (explicit — no spreads):**
- From `useEditorData`: `projectId`, `audioSrc`, `setAudioSrc`, `setStatus`, `segments`
- From `useTranscriptSync`: `syncActiveSegment`, `findActiveSegmentId`, `setActiveIds`, `isFollowMode`, `ensureActiveSegmentVisible`, `isScrubbingRef`, `setWaveformCollapsed`, `transcriptScrollRef`, `setSeekLock`

**Critical:** `syncActiveSegment` is called imperatively from `handleTimeUpdate`, NOT via a `currentTimeMs` prop that triggers re-renders. Audio ticks at ~10-25 Hz; prop-drilling the time would cause unnecessary re-renders of the entire tree.

**Cleanup discipline:** After extraction, remove all moved refs/state/handlers from `EditorScreen` immediately. No dead code left behind.

**Gate:** `npm test` + `npm run build` green.

---

## Slice 5: Search Hook + View Components

**Goal:** Extract the last hook and all remaining view components.

### 5a. `hooks/useTranscriptSearch.ts` (~180 lines)

**Moves:** Find/replace logic (lines 833-1029).

**Owns:**
- State: `findInput`, `findTerm`, `replaceTerm`, `matchIndex`, `caseSensitive`, `wholeWord`, `findReplaceOpen`
- Memos: `matches`, `matchesBySeg`
- Handlers: `handlePrev`, `handleNext`, `goToDelta`, `handleReplace`, `handleReplaceAll`, `onFindKeyDown`, `openFindReplaceModal`
- Debounce effect: `findInput` → `findTerm` (800ms)

**Params (explicit):**
- From `useEditorData`: `segments`, `source`
- From `useTranscriptMutations`: `editingTexts`, `setEditingTexts`, `scheduleSave`, `setEditingId`
- From `useTranscriptSync`: `scrollToSegmentIndex`, `setIsFollowMode`
- From `useSpeakerAssignments`: `setSpeakerPopover`
- From `EditorScreen`: `exportModalOpen`

### 5b. `hooks/useEditorKeyboardShortcuts.ts` (~50 lines)

**Moves:** Keyboard shortcut effect (lines 658-693) + CustomEvent listeners (`open-find-replace`, `open-export`, `editor-scroll-to-top`).

**Params:** `togglePlay`, `seekRelative`, `openFindReplaceModal`, `openExportModal`, `handleReturnToTop`

**Returns:** Nothing (side-effect-only hook).

### 5c. `components/TranscriptSegmentCard.tsx` (~120 lines)

**Moves:** `SegmentHeaderRow` (lines 100-167) + the Virtuoso `itemContent` render logic (lines 1360-1471).

**Must preserve:** `data-testid="segment-card"`, `data-segment-id`, `bg-trust-blue/10` active class, all click handlers, search highlight rendering with `warm-highlight` / `trust-blue` tokens.

### 5d. `components/TranscriptList.tsx` (~60 lines)

**Moves:** Virtuoso wrapper with overscan, scroll parent, `rangeChanged`, and `itemContent` delegating to `TranscriptSegmentCard`.

### 5e. `components/EditorHeader.tsx` (~80 lines)

**Moves:** The document header JSX — title editing, metadata row (date, speaker count, duration), status display, and divider.

### 5f. `components/MixModeBanner.tsx` (~20 lines)

**Moves:** The conditional warning shown when `source === 'segments'` (lines 1262-1280).

### 5g. `components/SyncToAudioButton.tsx` (~30 lines)

**Moves:** The floating sync-to-audio button with direction arrow (lines 1477-1494).

**Cleanup discipline:** After each component extraction, remove the moved JSX and any now-unused local variables from `EditorScreen`.

**Gate:** `npm test` + `npm run build` green.

---

## Slice 6: Cleanup and Hook Tests

**Goal:** Final polish, dead-code removal, and new test coverage.

### 6a. Slim `EditorScreen.tsx` to orchestrator

After all extractions, `EditorScreen` should be ~200 lines:
- Import and call all hooks in order
- Wire hook outputs to hook inputs (the composition layer)
- Render JSX: `CollapsibleWaveform` > `AudioPlayer`, `FindReplaceModal`, `EditorHeader`, `TranscriptList`, `SyncToAudioButton`, `FloatingPlayerDeck`, `ExportModal`, `SpeakerPopover`

### 6b. Hook call order in EditorScreen

Every param is explicit — no `...spread` from hook returns. This makes the dependency graph readable at a glance.

```tsx
// 1. Data layer — no dependencies on other hooks
const data = useEditorData(projectId)

// 2. Mutation hooks — depend only on data
const editing = useTranscriptMutations({
  source: data.source,
  setSegments: data.setSegments,
})
const speakers = useSpeakerAssignments({
  projectId,
  speakers: data.speakers,
  setSpeakers: data.setSpeakers,
  segments: data.segments,
  setSegments: data.setSegments,
  source: data.source,
  reloadTranscript: data.reloadTranscript,
})
const title = useProjectTitleEditing({
  projectId,
  projectTitle: data.projectTitle,
  setProjectTitle: data.setProjectTitle,
})

// 3. Sync — needs editing/speaker state to disable follow mode
const sync = useTranscriptSync({
  segments: data.segments,
  editingId: editing.editingId,
  speakerPopover: speakers.speakerPopover,
})

// 4. Playback — needs sync callbacks, writes to sync-owned refs
const playback = useEditorPlayback({
  projectId,
  audioSrc: data.audioSrc,
  setAudioSrc: data.setAudioSrc,
  setStatus: data.setStatus,
  segments: data.segments,
  syncActiveSegment: sync.syncActiveSegment,
  findActiveSegmentId: sync.findActiveSegmentId,
  setActiveIds: sync.setActiveIds,
  isFollowMode: sync.isFollowMode,
  ensureActiveSegmentVisible: sync.ensureActiveSegmentVisible,
  isScrubbingRef: sync.isScrubbingRef,
  setWaveformCollapsed: sync.setWaveformCollapsed,
  transcriptScrollRef: sync.transcriptScrollRef,
  setSeekLock: sync.setSeekLock,
})

// 5. Search — needs editing state + sync scrolling
const search = useTranscriptSearch({
  segments: data.segments,
  source: data.source,
  editingTexts: editing.editingTexts,
  setEditingTexts: editing.setEditingTexts,
  scheduleSave: editing.scheduleSave,
  setEditingId: editing.setEditingId,
  scrollToSegmentIndex: sync.scrollToSegmentIndex,
  setIsFollowMode: sync.setIsFollowMode,
  setSpeakerPopover: speakers.setSpeakerPopover,
  exportModalOpen,
})

// 6. Keyboard shortcuts — receives action handlers, no return value
useEditorKeyboardShortcuts({
  togglePlay: playback.togglePlay,
  seekRelative: playback.seekRelative,
  openFindReplaceModal: search.openFindReplaceModal,
  openExportModal,
  handleReturnToTop: sync.handleReturnToTop,
})

// Header/meta derivation lives here or in EditorHeader, not in hooks
const uniqueSpeakerCount = useMemo(...)
const showStatusInMetaRow = ...
const isStatusError = ...
```

### 6c. Add hook-level tests

New test files in `__tests__/editor/`:

- **`utils.test.ts`** — Unicode whole-word boundaries, computed word timing, timestamp/date/duration formatting
- **`useEditorData.test.ts`** — audio URL resolves independently of transcript; silent speaker/project metadata failures
- **`useTranscriptSearch.test.ts`** — debounce, dirty search state, Enter behavior, replace one/all
- **`useTranscriptSync.test.ts`** — earliest overlapping segment rule, scrub follow correction, user-scroll disabling follow mode
- **`useSpeakerAssignments.test.ts`** — optimistic update + rollback behavior
- **`useTranscriptMutations.test.ts`** — debounced save, save status transitions

### 6d. Final prop tightening and size audit

Dead-code removal happens per-slice (not deferred to here). This step is for:
- Tighten prop interfaces — ensure no component receives more props than it uses
- Verify every file is under its size target
- Confirm no orphaned imports or unused type exports remain across files

**Gate:** `npm test` + `npm run build` green. All files within size targets.

---

## Coupling Resolution Summary

| Coupling | Resolution |
|----------|------------|
| Audio time → syncActiveSegment → scroll | `useTranscriptSync` creates `syncActiveSegment`; passed as callback to `useEditorPlayback`. Called imperatively from `handleTimeUpdate` — no re-render prop drilling. |
| Find/replace reads editing state | `editingTexts` passed from `useTranscriptMutations` → `useTranscriptSearch` |
| Speaker assignment mutates segments | `setSegments` + `reloadTranscript` passed from `useEditorData` → `useSpeakerAssignments` |
| Editing disables follow-mode | `editingId` passed to `useTranscriptSync`, effect sets `isFollowMode(false)` |
| `isScrubbingRef` + `clickLockRef` shared by playback + sync | Both created in `useTranscriptSync`. Playback mutates `isScrubbingRef` directly and calls `setSeekLock()` for click-lock. Sync reads both internally in `syncActiveSegment`. All "should I sync?" logic lives in one hook. |
| Keyboard shortcuts span domains | `useEditorKeyboardShortcuts` receives all action handlers as params |
| Speaker popover disables follow-mode | `speakerPopover` state passed to `useTranscriptSync` |

---

## What Does NOT Move

These shared components/hooks stay where they are:
- `components/AudioPlayer.tsx` — shared boundary, used with imperative ref API
- `components/CollapsibleWaveform.tsx` — shared UI wrapper
- `components/FloatingPlayerDeck.tsx` — shared UI component
- `components/FindReplaceModal.tsx` — shared modal (pure UI, state in parent)
- `components/ExportModal.tsx` — shared modal
- `components/SpeakerPopover.tsx` — shared component
- `hooks/useAudioSessionRecovery.ts` — shared hook (called inside `useEditorPlayback`)
- `hooks/useFocusTrap.ts` — shared hook (used by modals)

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| AudioPlayer mock breaks on import depth change | Prerequisite jest config fix switches to `@/` alias (depth-independent) |
| Stale closures in extracted callbacks | Existing code uses refs for async-critical values (`segmentsRef`, `readyRef`, `isScrubbingRef`). Review dependency arrays on extraction. |
| Effect ordering changes | Effects across domains are independent (different events/timers). `segmentsRef.current = segments` stays as early sync assignment in `useTranscriptSync`. |
| Re-render cascades from hook splitting | Cross-hook communication uses refs (no re-render) or stable `Dispatch` setters (React guarantees stability). Audio time flows via imperative callback, not prop. |
| Hook exceeds 250 lines | `useTranscriptSync` and `useTranscriptSearch` are ~180 lines. If either grows, extract pure computation to `utils.ts`. |
| Dead code accumulates during extraction | Each slice cleans up moved code immediately. No "cleanup later" — if you extracted it, delete the original in the same commit. |
| Test import path breaks | `page.tsx` is a synchronous wrapper that default-exports a component. Tests render it directly without async complications. |

### Dead code that should be removed, not preserved

- `SEEK_RESUME_TIMEOUT_MS`
- `SEEK_TOLERANCE_MS`
- `seekTokenRef`
- `fetchChunks` import in the editor page
- `currentPopoverSpeaker` unless a real consumer is introduced during extraction

---

## Success Criteria

- [ ] `page.tsx` under 20 lines (synchronous thin wrapper only)
- [ ] `EditorScreen.tsx` under 200 lines (orchestrator only)
- [ ] No extracted file over 250 lines
- [ ] All 118 existing tests pass after every slice
- [ ] New hook-level tests added in Slice 6
- [ ] `npm run build` produces zero errors after every slice
- [ ] No UX changes — manual smoke test: play audio, edit text, find/replace, change speaker, export

---

## Assumptions

- Editor-only scope. No pipeline, webhook, schema, or route changes.
- Incremental mergeable slices. Each slice is a PR-ready commit.
- If an editor-local module later gets a real second consumer outside the route, promote it to `frontend/components/` or `frontend/hooks/` in a separate follow-up.
- Shared components (`AudioPlayer`, `FindReplaceModal`, etc.) are already valid boundaries and don't move.
