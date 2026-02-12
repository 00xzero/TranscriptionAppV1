# Segment Split Feature

## Context
Deepgram sometimes attributes an interjection from one speaker to another speaker's segment. Users need to split a segment at a specific point and reassign the speaker of either half. No split/merge functionality currently exists.

## UX Flow
1. User clicks the pencil icon to enter edit mode on a segment
2. User places their cursor at the desired split point in the textarea
3. A **scissors button** appears in the `SegmentHeaderRow` (next to the pencil icon, only visible while editing)
4. User clicks the scissors button (or presses `Cmd+Shift+S`)
5. The segment splits into two at the cursor's word boundary — both keep the original speaker
6. User clicks the speaker label on either segment to reassign via the existing `SpeakerPopover`

## Implementation

### 1. Database: New RPC function
**New file:** `infra/supabase/migrations/YYYYMMDD_split_chunk_rpc.sql`

Create a `split_chunk` PostgreSQL function that atomically:
- Verifies user ownership (auth.uid() check)
- Inserts two new chunks (inheriting `project_id`, `speaker_id`, `source_segment_ids`, `algo_version`; both set `is_edited = true`, `is_filler = false`)
- Remaps `chunk_words` rows: words before split index → chunk A, words at/after → chunk B (re-indexes `order_index`)
- Deletes the original chunk
- Returns `(chunk_a_id, chunk_b_id)`

Parameters: `p_chunk_id, p_split_word_index, p_text_a, p_text_b, p_start_ms_a, p_end_ms_a, p_start_ms_b, p_end_ms_b`

### 2. Query helper
**Modify:** `frontend/lib/supabase/queries.ts`

Add `splitChunk()` function that calls `supabase.rpc('split_chunk', {...})` and returns `{ chunk_a_id, chunk_b_id }`.

### 3. SegmentHeaderRow — scissors button
**Modify:** `frontend/app/editor/[id]/page.tsx` (SegmentHeaderRow component, ~line 79)

- Add `onSplit?: () => void` prop
- Render a scissors icon button next to the pencil icon, visible only when `editingId === segmentId && source !== 'segments'` and `onSplit` is provided
- Styled like the existing pencil button (same hover/opacity classes)

### 4. Editor page — split handler + wiring
**Modify:** `frontend/app/editor/[id]/page.tsx` (EditorPage component)

**New state:** `splittingId: string | null` (to disable UI during split)

**`handleSplitChunk(segId)` handler:**
1. Read `textarea.selectionStart` to get cursor position
2. Split text into `textA` (before cursor, trimmed) and `textB` (after cursor, trimmed)
3. Validate both halves are non-empty — bail if not
4. Compute timing proportionally: `splitMs = start + round((end - start) * (textA.length / totalLength))`
5. Count words before cursor for `chunk_words` remapping index
6. **Optimistic update:** replace original segment with two temp-id segments in state, exit edit mode
7. Call `splitChunk()` RPC
8. On success: swap temp IDs with real IDs from response
9. On error: revert to original segment

**Keyboard shortcut:** `Cmd+Shift+S` (while editing) triggers `handleSplitChunk(editingId)`

**Wire to SegmentHeaderRow:** pass `onSplit` prop when segment is being edited

### 5. Tests
**Modify:** `frontend/__tests__/editor.test.tsx`

- Add `splitChunk` mock to existing jest setup
- Test: scissors button appears when editing a chunk segment
- Test: split calls `splitChunk` with correct params and produces two segment cards
- Test: split reverts on API error

### 6. Jest setup
**Modify:** `frontend/jest.setup.ts`

Add `splitChunk: jest.fn().mockResolvedValue([{ chunk_a_id: 'new-a', chunk_b_id: 'new-b' }])` to the queries mock.

## Files Changed

| File | Change |
|------|--------|
| `infra/supabase/migrations/YYYYMMDD_split_chunk_rpc.sql` | **New** — RPC function |
| `frontend/lib/supabase/queries.ts` | Add `splitChunk()` |
| `frontend/app/editor/[id]/page.tsx` | Add scissors button to SegmentHeaderRow, add `handleSplitChunk` handler + state, add `Cmd+Shift+S` shortcut |
| `frontend/jest.setup.ts` | Add `splitChunk` mock |
| `frontend/__tests__/editor.test.tsx` | Add split test cases |

## Edge Cases
- **Cursor at start/end of text:** Both halves must be non-empty after trim — no-op otherwise
- **Single-word segment:** Can't split (cursor at start or end only) — no-op
- **Edited chunk (text diverged from words):** Proportional timing, best-effort `chunk_words` remap
- **No `chunk_words` rows:** RPC still works, just nothing to remap
- **Segments source mode:** Scissors button hidden (only chunks support split)

## Verification
1. Run existing tests: `cd frontend && npm test` — all 98 tests pass
2. Run new split tests specifically
3. Manual QA: open editor, edit a segment, place cursor mid-text, click scissors → verify two segments appear with correct text/speaker/timestamps
4. Verify speaker reassignment works on split segments via SpeakerPopover
5. Verify export (DOCX/VTT) includes split segments correctly
