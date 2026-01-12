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

---

# Editor UX – Sync to Audio Acceptance Criteria

## Initial State
- **[initial-follow]** On page load, follow mode is ON — transcript automatically follows the audio as it plays.
- **[no-button-initial]** Sync button is NOT visible on initial page load.

## User Scroll Behavior
- **[scroll-disables-follow]** When user scrolls the transcript (mousewheel or touch), follow mode turns OFF.
- **[button-on-scroll]** After user scrolls, the "Sync to audio" button appears at the bottom center of the transcript panel.
- **[button-position]** Button is positioned within the transcript container (not viewport center), and stays visible regardless of scroll position.

## Sync Button Functionality
- **[sync-click-scrolls]** Clicking "Sync to audio" scrolls the transcript to the currently playing segment.
- **[sync-enables-follow]** Clicking "Sync to audio" re-enables follow mode — transcript continues to follow audio automatically.
- **[button-hides-after-sync]** After clicking sync, the button hides (follow mode is active).

## Direction Arrows
- **[arrow-up]** If user has scrolled DOWN past the playing segment, button shows UP arrow (↑).
- **[arrow-down]** If user has scrolled UP before the playing segment, button shows DOWN arrow (↓).

## Editing Interaction
- **[edit-disables-follow]** When user clicks "Edit" on any transcript card, follow mode turns OFF.
- **[no-button-while-editing]** While a transcript card is in edit mode, the sync button is NOT visible.
- **[button-after-edit]** When user closes the edit (clicks "Close"), the sync button becomes visible again.

## Speaker Popover Interaction
- **[no-button-with-popover]** While the speaker popover is open, the sync button is NOT visible.
- **[button-after-popover]** When speaker popover closes, sync button reappears (if not in follow mode).

## Edge Cases
- **[no-button-no-audio]** If no segment is currently active (audio not playing or no activeIds.segId), button does not appear.
- **[programmatic-scroll]** When sync button is clicked, the resulting scroll does NOT disable follow mode (only user-initiated scroll does).

---

## Test Scenarios

### Scenario 1: Basic Follow Mode
1. Load editor page with a transcript
2. Play audio
3. **Expected**: Transcript automatically scrolls to keep the playing segment visible
4. **Expected**: No sync button visible

### Scenario 2: User Scroll Breaks Follow
1. While audio is playing, scroll the transcript up or down
2. **Expected**: Sync button appears at bottom center of transcript panel
3. **Expected**: Transcript no longer auto-follows the audio
4. Let audio continue playing
5. **Expected**: Transcript stays where user scrolled, does not jump

### Scenario 3: Re-sync After Scroll
1. Scroll away from playing segment (sync button visible)
2. Click "Sync to audio"
3. **Expected**: Transcript scrolls smoothly to the playing segment
4. **Expected**: Button disappears
5. Let audio continue playing
6. **Expected**: Transcript resumes auto-following

### Scenario 4: Direction Arrow Accuracy
1. Play audio at a segment in the middle of the transcript
2. Scroll DOWN past the playing segment
3. **Expected**: Button shows UP arrow (↑)
4. Scroll UP before the playing segment
5. **Expected**: Button shows DOWN arrow (↓)

### Scenario 5: Editing Hides Button
1. Scroll away (sync button visible)
2. Click "Edit" on any transcript card
3. **Expected**: Sync button disappears
4. Make changes or just view the edit textarea
5. **Expected**: Button stays hidden
6. Click "Close" to exit edit mode
7. **Expected**: Sync button reappears

### Scenario 6: Speaker Popover Hides Button
1. Scroll away (sync button visible)
2. Click on a speaker avatar to open the popover
3. **Expected**: Sync button disappears
4. Close the popover (click outside or select a speaker)
5. **Expected**: Sync button reappears

### Scenario 7: Edit During Follow Mode
1. While in follow mode (button hidden, transcript following)
2. Click "Edit" on any card
3. **Expected**: Follow mode disabled
4. Close the edit
5. **Expected**: Sync button now visible (user can re-sync if desired)
