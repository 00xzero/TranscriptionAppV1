# Editor UX – Find & Replace Acceptance Criteria

- **[commit-search]** Typing in the Find input does not search until committed via Search button or Enter.
- **[summary]** After commit, the UI shows the match counter `current/total`.
- **[nav-buttons]** Prev/Next are disabled until a term is committed; enabled once matches exist.
- **[open-edit]** Focusing the current match opens that segment in edit mode and selects the matched text in the textarea.
- **[next-prev]** Prev/Next move the selection across matches in reading order and keep the segment scrolled into view.
- **[highlight]** Read-only transcript view highlights all matches, with the active match highlighted stronger.
- **[replace-one]** Replace updates only the selected match within the segment and schedules a debounce save (≤500ms).
- **[replace-all]** Replace all updates every occurrence across all segments and saves each updated segment.
- **[case-toggle]** Toggling Match case recomputes matches immediately for the committed term.
- **[resilience]** Cancelling edit or navigating away from the open segment should not crash; the current match state remains coherent.
- **[persistence]** After debounce delay, saves succeed and the Saved status appears briefly.
- **[no-flash]** No excessive reflows or jumpiness during selection, navigation, or save indicator updates.

# Non-Functional
- **[performance]** Searching in transcripts up to 10k words remains responsive (<100ms render on modern laptop).
- **[accessibility]** Inputs have labels; buttons are keyboard-navigable; Enter commits search; focus moves predictably to the textarea on match.
