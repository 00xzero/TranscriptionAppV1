# Radix UI Primitives Migration Plan

> Migrate hand-rolled UI primitives to Radix UI for consistent accessibility, reduced boilerplate, and design-system alignment. All Radix wrappers are styled with Olivetti design tokens. Unique domain components (AudioPlayer, CollapsibleWaveform, FloatingPlayerDeck, TranscriptList, TranscriptSegmentCard, FileDropZone) remain hand-rolled.

---

## Quick Reference

| Phase | Scope | Key Files | Est. Complexity |
|-------|-------|-----------|-----------------|
| 1 | Foundation — install packages, build `components/ui/` layer | New files only | Medium |
| 2 | Dialogs — migrate 3 modals, migrate ExportModal RadioGroup, delete `useFocusTrap` | ExportModal, FindReplaceModal, CaptureModal | Large |
| 3 | Overlays — split into 3A DropdownMenu and 3B SpeakerPopover/editor integration | LibraryView, SpeakerPopover, EditorScreen, TranscriptSegmentCard, useSpeakerAssignments | Medium to Large |
| 4 | Form Primitives — Switch, Select, Toggle, Label | CaptureDetails, AudioPlayer, FindReplaceModal | Medium |
| 5 | Polish — Separator, Tooltip, cleanup | Sidebar, EditorHeader, global buttons | Small |

---

## Phase 1: Foundation

**Goal:** Install all Radix packages and create the `components/ui/` wrapper layer. No existing components are modified — this phase is additive only.

### 1.1 Install Packages

Run from `frontend/`:

```bash
npm install @radix-ui/react-dialog @radix-ui/react-popover @radix-ui/react-dropdown-menu @radix-ui/react-switch @radix-ui/react-select @radix-ui/react-radio-group @radix-ui/react-toggle @radix-ui/react-label @radix-ui/react-separator @radix-ui/react-tooltip
```

### 1.2 Create `components/ui/` Directory

Create the following files under `frontend/components/ui/`. Each file wraps one Radix primitive with Olivetti styling baked in. Every wrapper must:

- Re-export Radix sub-components with `forwardRef` and `className` merge support
- Apply Olivetti design tokens (CSS variables from `globals.css`) as default styling
- Support dark mode via the existing `dark:` variant / CSS custom properties
- Accept and merge additional `className` props for one-off overrides
- Include no business logic — pure presentation wrappers

#### Files to create:

**`dialog.tsx`** — Wraps `@radix-ui/react-dialog`
- Exports: `Dialog` (Root), `DialogTrigger`, `DialogPortal`, `DialogOverlay`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogClose`
- `DialogOverlay` default styling: `fixed inset-0 bg-paper/20 dark:bg-black/60 backdrop-blur-xs z-50` (matches current modal backdrops)
- `DialogContent` default styling: `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50` with Olivetti surface colors, rounded corners, shadow-float, max-w constraints
- Animation: `data-[state=open]:animate-in data-[state=closed]:animate-out` fade + scale (use Tailwind keyframes or inline styles)

**`popover.tsx`** — Wraps `@radix-ui/react-popover`
- Exports: `Popover` (Root), `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`, `PopoverPortal`
- `PopoverContent` default styling: `bg-surface border border-base rounded-lg shadow-float z-50` with Olivetti tokens
- Default `sideOffset={8}` (matches current `GAP = 8` in SpeakerPopover)
- Default `collisionPadding={8}` for viewport-safe positioning

**`dropdown-menu.tsx`** — Wraps `@radix-ui/react-dropdown-menu`
- Exports: `DropdownMenu` (Root), `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator`
- `DropdownMenuContent` default styling: `bg-white dark:bg-night-surface border border-[#D1CEC5] dark:border-night-border rounded-lg shadow-lg z-50 min-w-[8rem]`
- `DropdownMenuItem` default styling: hover/focus states with `focus:bg-ink/5 dark:focus:bg-white/5`, cursor-pointer, `text-sm`
- Destructive variant: `text-ember-red` for delete actions

**`switch.tsx`** — Wraps `@radix-ui/react-switch`
- Exports: `Switch`
- Root styling: `w-10 h-5 rounded-full` with `data-[state=checked]:bg-trust-blue data-[state=unchecked]:bg-ink/20`
- Thumb styling: `block w-5 h-5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-5`
- Disabled styling: `disabled:opacity-50 disabled:cursor-not-allowed`

**`select.tsx`** — Wraps `@radix-ui/react-select`
- Exports: `Select` (Root), `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`
- `SelectTrigger` default styling: matches current native select — `border border-base rounded-sm px-2 py-1 text-sm bg-surface focus:ring-2 focus:ring-trust-blue/30`
- `SelectContent` default styling: `bg-white dark:bg-night-surface border border-base rounded-lg shadow-lg`
- `SelectItem` highlight: `focus:bg-trust-blue/10`
- Custom chevron icon (SVG, matching current CaptureDetails arrow)

**`radio-group.tsx`** — Wraps `@radix-ui/react-radio-group`
- Exports: `RadioGroup` (Root), `RadioGroupItem`
- `RadioGroupItem` default styling: `w-4 h-4 rounded-full border-2 border-ink/30 data-[state=checked]:border-trust-blue` with inner indicator `w-2 h-2 rounded-full bg-trust-blue`
- Support a "card" variant via className override (for ExportModal format picker)

**`toggle.tsx`** — Wraps `@radix-ui/react-toggle`
- Exports: `Toggle`
- Default styling: `rounded px-2 py-1 text-xs font-mono` with `data-[state=on]:bg-trust-blue/15 data-[state=on]:text-trust-blue dark:data-[state=on]:bg-trust-blue/20`
- Unpressed state: `bg-ink/5 dark:bg-white/10`

**`label.tsx`** — Wraps `@radix-ui/react-label`
- Exports: `Label`
- Default styling: `text-xs font-medium opacity-80` (matches current CaptureDetails label pattern)
- `cursor-pointer` inherits from Radix (clicks focus associated input)

**`separator.tsx`** — Wraps `@radix-ui/react-separator`
- Exports: `Separator`
- Horizontal default: `h-px w-full bg-ink/10 dark:bg-white/10`
- Vertical: `w-px h-full bg-ink/10 dark:bg-white/10`

**`tooltip.tsx`** — Wraps `@radix-ui/react-tooltip`
- Exports: `TooltipProvider`, `Tooltip` (Root), `TooltipTrigger`, `TooltipContent`
- `TooltipContent` default styling: `bg-ink text-paper text-xs px-2 py-1 rounded shadow-lg` with `sideOffset={4}`
- Dark mode: `dark:bg-paper dark:text-ink`

### 1.3 Verification

- [ ] `npm run build` passes with no errors
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (no existing tests should break — no components were modified)
- [ ] Each `ui/` file can be imported without error

### 1.4 Commit

Commit message: `feat(ui): add Radix UI primitive wrappers with Olivetti styling`

---

## Phase 2: Dialog Migration

**Goal:** Migrate all three modals to use `components/ui/dialog.tsx`, and finish the ExportModal format-picker migration while that file is already open. Delete `useFocusTrap` hook when done. This is the highest-value phase — eliminates the most duplicated accessibility code.

### 2.1 Migrate ExportModal

**File:** `frontend/components/ExportModal.tsx`

**Current pattern to replace:**
- Manual `useFocusTrap(panelRef, true)` → Radix Dialog handles focus trapping
- Manual `document.body.style.overflow = 'hidden'` → Radix Dialog handles scroll lock
- Manual ESC keydown listener → Radix `onOpenChange` / `onEscapeKeyDown`
- Manual backdrop `onClick` with `stopPropagation` → Radix `DialogOverlay` + `onPointerDownOutside`
- `role="dialog"`, `aria-modal`, `aria-labelledby` → Radix provides automatically

**Migration steps:**
1. Import `Dialog`, `DialogPortal`, `DialogOverlay`, `DialogContent`, `DialogTitle` from `@/components/ui/dialog`
2. Replace the outer `<>` fragment with `<Dialog open={true} onOpenChange={(open) => { if (!open && !isExporting) onClose() }}>` — note: ExportModal is always "open" when rendered, so `open={true}` is correct
3. Replace the fixed backdrop `<div>` with `<DialogOverlay />`
4. Replace the panel `<div>` with `<DialogContent>` — move all existing className styling to it
5. Replace the `<h2>` title with `<DialogTitle>` (preserves existing styling)
6. Remove: `useFocusTrap` import/call, scroll lock useEffect, ESC keydown useEffect, backdrop onClick handler, `role`/`aria-modal`/`aria-labelledby` attributes
7. To prevent closing during export: add `onEscapeKeyDown={(e) => { if (isExporting) e.preventDefault() }}` and `onPointerDownOutside={(e) => { if (isExporting) e.preventDefault() }}` to `DialogContent`

**Props interface:** Unchanged. `onClose` still passed from parent.

**Test impact:** `frontend/__tests__/exportModal.ui.test.tsx` — tests should still pass. The modal is found by `role="dialog"`. Radix Dialog renders with `role="dialog"` by default. Verify the test's `getByRole('dialog')` still works.

### 2.1.1 Migrate ExportModal RadioGroup While ExportModal Is Open

**File:** `frontend/components/ExportModal.tsx`

**Why here:** ExportModal is already being reworked for Dialog in this phase. Migrate the format picker now to avoid reopening the same file in Phase 4 for a second structural change.

**Migration steps:**
1. Replace the native `<input type="radio">` + custom circle markup with `RadioGroup` and `RadioGroupItem` from `@/components/ui/radio-group`
2. Preserve the existing card layout and selected-state styling using either conditional className logic or `data-[state=checked]`
3. Keep the existing disabled "PDF coming soon" option behavior
4. Verify keyboard support still works, with Radix now providing arrow-key navigation between options

### 2.2 Migrate FindReplaceModal

**File:** `frontend/components/FindReplaceModal.tsx`

**Current pattern to replace:**
- `useFocusTrap(panelRef, open)` → Radix Dialog
- Conditional scroll lock (`if (open)`) → Radix Dialog
- ESC flash animation → use `onEscapeKeyDown` on `DialogContent`
- Custom backdrop with `onPointerDown` → `DialogOverlay`

**Migration steps:**
1. Wrap with `<Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>` — this modal uses the `open` prop for visibility
2. Replace backdrop with `<DialogOverlay />`
3. Replace panel with `<DialogContent>`
4. Add `<DialogTitle className="sr-only">Find and Replace</DialogTitle>` for a11y (current modal has no visible title — Radix requires one, use `sr-only` to keep existing visual design)
5. Move ESC flash logic to `onEscapeKeyDown` handler on `DialogContent`
6. Remove: `useFocusTrap`, scroll lock effect, backdrop div, manual keydown listener for ESC
7. Keep: Arrow key handlers (Up/Down for match navigation) — these are domain-specific, not replaced by Radix

**Important:** The `onClear` callback must fire when the dialog closes. Wire it in `onOpenChange`: `if (!open) { onClose(); onClear(); }`

**Test impact:** `__tests__/editor.test.tsx` — Find/Replace is opened via `Cmd+F` CustomEvent. The modal content is found by text ("Find", "Next", etc.). Verify these still render inside `DialogContent`. The `openFindReplaceModal()` test helper dispatches `CustomEvent('open-find-replace')` — this flow is unchanged since open state is still managed by the editor page.

### 2.3 Migrate CaptureModal

**File:** `frontend/components/CaptureModal/CaptureModal.tsx`

**Current pattern to replace:**
- `useFocusTrap(modalRef, isCaptureModalOpen)` → Radix Dialog
- Scroll lock useEffect → Radix Dialog
- ESC handler (blocked during upload) → `onEscapeKeyDown`
- Backdrop click (blocked during upload) → `onPointerDownOutside`
- `role="dialog"`, `aria-modal`, `aria-labelledby` → automatic

**Migration steps:**
1. Wrap with `<Dialog open={isCaptureModalOpen} onOpenChange={(open) => { if (!open && !isUploading) closeCaptureModal() }}>`
2. Replace backdrop with `<DialogOverlay />`
3. Replace modal panel with `<DialogContent>`
4. Replace `<h2>` with `<DialogTitle>`
5. Add `onEscapeKeyDown` and `onPointerDownOutside` guards for upload-in-progress state
6. Remove: `useFocusTrap`, scroll lock, manual ESC/backdrop handlers
7. Preserve: all child composition (`FileDropZone`, `CaptureDetails`, `KeyTermsInput`, `CaptureFooter`), scrollable content area (`overflow-y-auto max-h-[70vh]`)

**Test impact:** There is no dedicated CaptureModal test file today. Coverage is primarily indirect through `frontend/__tests__/contextualHeader.test.tsx` and end-to-end editor flows. Add a focused CaptureModal interaction test if this phase surfaces regressions.

### 2.4 Delete useFocusTrap

**File:** `frontend/hooks/useFocusTrap.ts`

After all three modals are migrated, this hook has zero consumers. Delete the file entirely.

### 2.5 Verification

- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes — all 286 tests
- [ ] Manual: open each modal, verify focus traps to modal content
- [ ] Manual: ESC closes modals (blocked during loading states)
- [ ] Manual: click outside closes modals (blocked during loading states)
- [ ] Manual: Tab cycles within modal content
- [ ] Manual: dark mode renders correctly for all three modals
- [ ] Verify `useFocusTrap.ts` is deleted and has no remaining imports

### 2.6 Commit

Commit message: `refactor(ui): migrate modals to Radix Dialog, remove useFocusTrap`

---

## Phase 3: Overlays

**Goal:** Migrate LibraryView menu to Radix DropdownMenu, then migrate SpeakerPopover to Radix Popover in a separate sub-phase. These are intentionally split because SpeakerPopover is not a local component swap: it changes editor state shape, trigger wiring, and test coverage.

### 3A: Migrate LibraryView DropdownMenu

**Why first:** This is a contained component migration with low state-management risk. It is a good proving ground for the `ui/dropdown-menu.tsx` wrapper before the editor-facing popover refactor.

**File:** `frontend/components/LibraryView.tsx`

**Current pattern to replace:**
- `openMenuId` state + conditional rendering of menu div → Radix DropdownMenu open/close management
- Manual click-outside (`document.addEventListener('pointerdown', ...)`) → Radix handles automatically
- Manual ESC handler → Radix handles automatically
- `aria-haspopup="menu"`, `aria-expanded`, `aria-controls` → Radix provides automatically
- `role="menu"` / `role="menuitem"` → Radix provides automatically

**Migration steps:**
1. Replace the three-dot button + conditional menu div with:
   ```tsx
   <DropdownMenu>
     <DropdownMenuTrigger asChild>
       <button>{/* three-dot icon */}</button>
     </DropdownMenuTrigger>
     <DropdownMenuContent align="end">
       <DropdownMenuItem
         className="text-ember-red"
         onSelect={() => handleDelete(project.id)}
       >
         Delete
       </DropdownMenuItem>
     </DropdownMenuContent>
   </DropdownMenu>
   ```
2. Remove: `openMenuId` state, `menuRef`, click-outside useEffect, ESC handler, manual ARIA attributes
3. Keep the existing `window.confirm()` behavior for now. A future `AlertDialog` confirmation can be a separate enhancement rather than broadening this phase.
4. Keep: all project list rendering, sorting, loading states

**Test impact:** There is no dedicated `libraryView.test.tsx` today. Add a focused LibraryView menu test in this phase covering trigger open, keyboard dismissal, and Delete action selection.

### 3B: Migrate SpeakerPopover + Editor Integration

**File:** `frontend/components/SpeakerPopover.tsx`

**Current pattern to replace:**
- Manual DOMRect-based positioning (`anchorRect.top`, `anchorRect.bottom`, viewport flip logic) → Radix Popover auto-positioning with collision detection
- Manual click-outside listener (`document.addEventListener('mousedown', ...)`) → Radix `onPointerDownOutside`
- Fixed positioning with calculated `top`/`left` → Radix handles portal + positioning
- `role="dialog"` → Radix Popover provides appropriate role

**Migration steps:**
1. The parent component currently passes `anchorRect: DOMRect | null` to SpeakerPopover. This needs to change. The parent should instead wrap the speaker button in `<PopoverTrigger>` and let Radix handle anchoring.
2. Restructure: the parent component (TranscriptSegmentCard or editor page) should use:
   ```tsx
   <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
     <PopoverTrigger asChild>
       <button>{/* speaker button */}</button>
     </PopoverTrigger>
     <PopoverContent side="bottom" align="start" sideOffset={8}>
       <SpeakerPopoverContent {...props} />
     </PopoverContent>
   </Popover>
   ```
3. Refactor SpeakerPopover into a "content-only" component (rename to `SpeakerPopoverContent` or keep name but remove positioning/portal logic)
4. Remove: `anchorRect` prop, viewport flip calculation, click-outside useEffect, fixed positioning styles, `useRef` for popoverRef (used only for click-outside)
5. Keep: speaker list rendering, search input, inline rename, tag/untag logic, keyboard navigation within the popover
6. Set `collisionPadding={8}` on `PopoverContent` to match current viewport safety margin
7. Radix Popover auto-flips when there isn't enough space — this replaces the manual `flipUp` logic

**Breaking change:** The `anchorRect` prop is removed. This is not a local component swap. The parent/consumer layer must adopt the `<Popover>` + `<PopoverTrigger>` pattern and update editor state accordingly. Check and update these files together:
- `frontend/app/editor/[id]/hooks/useSpeakerAssignments.ts` — remove `anchorRect` from state, store only the logical open target
- `frontend/app/editor/[id]/EditorScreen.tsx` — stop rendering a globally-positioned popover and instead colocate trigger/content ownership
- `frontend/app/editor/[id]/components/TranscriptSegmentCard.tsx` — the speaker button becomes the `PopoverTrigger`

**Test impact:** Existing hook coverage in `frontend/__tests__/editor/useSpeakerAssignments.test.ts` will need updates because the popover state shape changes. Add focused UI coverage for opening the popover from a transcript segment and selecting or renaming a speaker.

### 3.3 Verification

- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] Manual: LibraryView three-dot menu opens/closes, Delete item works
- [ ] Manual: SpeakerPopover opens anchored to speaker button, auto-flips when near viewport edge
- [ ] Manual: clicking outside SpeakerPopover closes it
- [ ] Manual: keyboard navigation in both components (Tab, ESC, Enter)
- [ ] Manual: dark mode renders correctly

### 3.4 Commit

Commit message: `refactor(ui): migrate SpeakerPopover and LibraryView menu to Radix`

---

## Phase 4: Form Primitives

**Goal:** Migrate Switch, Select, Toggle, and Label across the app. ExportModal RadioGroup was intentionally pulled into Phase 2 so that file is only structurally refactored once.

### 4.1 Migrate Switch — CaptureDetails

**File:** `frontend/components/CaptureModal/CaptureDetails.tsx`

**Current:** Custom CSS toggle for speaker diarization (currently disabled/coming-soon).

**Migration steps:**
1. Replace the custom `<div>` toggle with:
   ```tsx
   <Switch disabled checked={false} />
   ```
2. Apply `disabled` prop (feature is "coming soon")
3. Remove the custom toggle markup (the `relative inline-block w-10 ...` div structure)
4. The Radix Switch provides `aria-checked`, keyboard support (Space to toggle), and focus management automatically

### 4.2 Migrate Select — AudioPlayer Rate

**File:** `frontend/components/AudioPlayer.tsx`

**Current:** Native `<select>` for playback rate (0.5x–2x).

**Migration steps:**
1. Replace native `<select>` with:
   ```tsx
   <Select value={String(playbackRate)} onValueChange={(v) => { ... }}>
     <SelectTrigger>
       <SelectValue />
     </SelectTrigger>
     <SelectContent>
       {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(r => (
         <SelectItem key={r} value={String(r)}>{r.toFixed(2)}x</SelectItem>
       ))}
     </SelectContent>
   </Select>
   ```
2. Move the `onChange` logic into `onValueChange`
3. Keep the `aria-label="Playback rate"` on SelectTrigger
4. Preserve existing size/styling (small, inline)

**Note:** The `hideControls` prop hides the entire controls section. If `hideControls` is true, this Select is not rendered — no special handling needed.

### 4.3 Migrate Select — CaptureDetails Language

**File:** `frontend/components/CaptureModal/CaptureDetails.tsx`

**Current:** Native `<select>` with custom SVG chevron overlay, currently disabled.

**Migration steps:**
1. Replace native `<select>` + chevron overlay with Radix `Select` (chevron is built into `SelectTrigger`)
2. Apply `disabled` prop
3. Keep existing label association

### 4.4 Migrate Toggle — FindReplaceModal

**File:** `frontend/components/FindReplaceModal.tsx`

**Current:** Two `<button>` elements with `aria-pressed` for "Match Case" and "Whole Word".

**Migration steps:**
1. Replace each button with:
   ```tsx
   <Toggle
     pressed={caseSensitive}
     onPressedChange={setCaseSensitive}
     aria-label="Match case"
   >
     Aa
   </Toggle>
   ```
2. The `data-[state=on]` styling from the `ui/toggle.tsx` wrapper replaces the manual conditional className
3. Remove: manual `onClick` toggle logic, `aria-pressed` attribute (Radix provides it)

### 4.5 Migrate Labels

**Files:** `CaptureDetails.tsx`, `KeyTermsInput.tsx`, `FileDropZone.tsx`, `AudioPlayer.tsx`

**Migration steps:**
1. Replace `<label>` elements with `<Label>` from `@/components/ui/label`
2. Keep `htmlFor` associations
3. The wrapper provides consistent default styling (`text-xs font-medium opacity-80`)
4. Where labels have custom styling that differs, pass `className` override

**Note:** This is low-risk, mostly cosmetic alignment. Do all label replacements in a single pass.

### 4.6 Verification

- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] Manual: AudioPlayer rate dropdown opens, selects rate, audio updates
- [ ] Manual: FindReplaceModal toggle buttons show pressed state, function correctly
- [ ] Manual: CaptureModal switch renders disabled, label clicks focus inputs
- [ ] Manual: dark mode for all migrated elements

### 4.7 Commit

Commit message: `refactor(ui): migrate form primitives to Radix (Switch, Select, Toggle, Label)`

---

## Phase 5: Polish & Cleanup

**Goal:** Migrate Separator and Tooltip, remove dead code, verify full test suite.

### 5.1 Migrate Separators

**Files:** `EditorHeader.tsx`, `Sidebar.tsx`, `LibraryView.tsx`, any modal section dividers

**Current:** `<div className="h-px w-full bg-ink/10 dark:bg-white/10" />` or border-based dividers.

**Migration steps:**
1. Replace visual divider `<div>` elements with `<Separator />` from `@/components/ui/separator`
2. Radix Separator provides `role="separator"` and `aria-orientation` automatically — better semantics than a `<div>`
3. Where dividers are `border-t` or `border-b` on container elements (like Sidebar sections), keep as-is — these are structural borders, not standalone separators

### 5.2 Add Tooltips

**Files:** Various — AudioPlayer buttons, FloatingPlayerDeck buttons, ContextualHeader buttons, editor toolbar buttons

**Current:** `title` attributes on buttons (native browser tooltip — inconsistent styling, delayed appearance).

**Migration steps:**
1. Wrap the app's root layout with `<TooltipProvider delayDuration={300}>` (in `app/layout.tsx` or a shared provider)
2. Replace `title="..."` on interactive elements with:
   ```tsx
   <Tooltip>
     <TooltipTrigger asChild>
       <button aria-label="Play">{/* icon */}</button>
     </TooltipTrigger>
     <TooltipContent>Play</TooltipContent>
   </Tooltip>
   ```
3. Keep `aria-label` on buttons (tooltips are visual, aria-label is for screen readers)
4. Remove `title` attributes (Radix Tooltip replaces them)
5. Prioritize icon-only buttons first — these benefit most from styled tooltips

**Scope control:** Only migrate buttons that currently have `title` attributes. Don't add tooltips to elements that don't have them today.

### 5.3 Dead Code Cleanup

1. Delete `frontend/hooks/useFocusTrap.ts` (if not already deleted in Phase 2)
2. Remove the custom range input CSS from `globals.css` if no `<input type="range">` elements remain (AudioPlayer uses a div-based slider, not a native range input — verify first)
3. Grep for any remaining imports of deleted files
4. Remove any unused utility classes from `globals.css` if they were only used by replaced components

### 5.4 Final Verification

- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes — all tests green
- [ ] Full manual walkthrough:
  - Upload flow: CaptureModal → file drop → details → submit
  - Library: project list → three-dot menu → delete
  - Editor: speaker popover → rename/reassign
  - Editor: find/replace → match case toggle → replace
  - Editor: export modal → format selection → export
  - Audio: play/pause, rate change, seek
  - Tooltips visible on hover for icon buttons
  - Dark mode: every component renders correctly
  - Keyboard-only navigation through all flows

### 5.5 Commit

Commit message: `refactor(ui): add Separator and Tooltip, finalize Radix migration cleanup`

---

## Implementation Notes

### Styling Strategy

All Radix primitives render unstyled by default. The `components/ui/` wrappers apply Olivetti tokens via Tailwind classes. The layering is:

```
Radix primitive (headless a11y)
  → ui/ wrapper (Olivetti default styling)
    → consuming component (className overrides for context-specific tweaks)
```

Use `cn()` or a simple string concatenation helper to merge default + override classNames. If you don't already have a `cn()` utility, create one in `lib/utils.ts`:

```typescript
export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ')
}
```

### Animation

Radix Dialog/Popover/DropdownMenu/Tooltip expose `data-[state=open]` and `data-[state=closed]` attributes. Use these with Tailwind for enter/exit animations. If using Tailwind v4, define keyframes in `globals.css`:

```css
@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes fadeOut { from { opacity: 1 } to { opacity: 0 } }
@keyframes scaleIn { from { opacity: 0; transform: scale(0.96) } to { opacity: 1; transform: scale(1) } }
```

Then apply via `data-[state=open]:animate-[fadeIn_150ms]` etc. in the ui/ wrappers.

### Portal Rendering

Radix Dialog, Popover, DropdownMenu, Select, and Tooltip all portal their content to `document.body` by default. This avoids z-index and overflow clipping issues. No changes needed to existing layout structure.

### Test Considerations

- Radix renders real DOM with correct ARIA roles — existing `getByRole` queries should continue to work
- Portaled content may not be inside the component's DOM tree — use `screen.getByRole('dialog')` rather than `within(container).getByRole('dialog')` if tests break
- If tests use `fireEvent.keyDown(element, { key: 'Escape' })`, Radix handles ESC internally — these should still work
- Radix uses `pointer-events` for overlay dismissal. If tests simulate clicks on the overlay to close, they may need to use `pointerDown` instead of `click` events. Check if any tests break and adjust.

### What NOT to Migrate

These components remain hand-rolled — do not wrap them in Radix:

| Component | Reason |
|-----------|--------|
| `AudioPlayer.tsx` (progress slider) | Custom drag-to-seek with pointer capture, domain-specific keyboard steps (2s, 10s). Radix Slider doesn't support this pattern. |
| `CollapsibleWaveform.tsx` | Custom visualization with canvas/SVG rendering + drag scrub. |
| `FloatingPlayerDeck.tsx` | Simple button group, no complex primitive needed. |
| `TranscriptList.tsx` | react-virtuoso integration, domain logic. |
| `TranscriptSegmentCard.tsx` | Domain-specific card with inline editing. |
| `FileDropZone.tsx` | Drag-and-drop file handling, no Radix equivalent. |
| Inline SVG icons | No icon library needed — current approach is fine. |
