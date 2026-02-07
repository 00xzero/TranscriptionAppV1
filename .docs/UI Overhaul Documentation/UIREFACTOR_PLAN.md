# UI Refactor Plan (Olivetti)

## Goals
- Replace the current top-nav shell with the Olivetti sidebar + contextual header.
- Make the Library the primary landing page at `/`.
- Replace `/upload` with the Capture modal entry point.
- Deprecate `/import` from navigation and entry points.
- Theme the Auth page to match Olivetti.
- Align the current Editor UI visually while keeping existing player logic as a placeholder.

## Scope Decisions (Confirmed)
- App shell change: Sidebar + contextual header.
- Routing: `/` becomes Library.
- Capture: Modal replaces `/upload` page, and `/upload` redirects to `/` and auto-opens Capture.
- Import: Deprecated.
- Auth: Olivetti theme required.
- Editor: Immersive studio layout later; keep current player as placeholder now.
- Capture fields: Language + Diarization inputs disabled with "Coming soon" labels.

## Key Gaps / Mismatches (With Notes)
- App shell vs sidebar: confirmed.
- Home placeholder vs Library landing: confirmed.
- Visual system mismatch: confirmed.
- Capture flow page vs modal: confirmed.
- Projects view vs Library cards: partially true. Projects-based folders not supported, treat as placeholder. Recent files maps to current list.
- Editor immersive studio: defer. Use current player and structure as placeholder.
- Find/Replace modal: confirmed — see [Find/Replace Specification](#findreplace-modal-specification) below.
- Export modal styling: confirmed.
- Theme toggle approach: migrate from `data-theme` to Tailwind `dark` class.
- Colors: `trust-blue` is consistent across themes; use `player-blue` for playback controls (see [DESIGN_TOKENS.md](./DESIGN_TOKENS.md)).

## Reference Documents
- **[DESIGN_TOKENS.md](./DESIGN_TOKENS.md)** — Comprehensive design tokens, typography, colors, and component inventory extracted from `Olivetti.html`.

---

## Phased Execution Plan

### 1) Spec Lock
- Confirm Find/Replace modal behavior and results list expectations.
- Clarify placeholder behavior for Recent Projects.
- Review [DESIGN_TOKENS.md](./DESIGN_TOKENS.md) for completeness.

### 2) Design System Foundation
- Add Olivetti tokens to Tailwind config (see [DESIGN_TOKENS.md](./DESIGN_TOKENS.md#color-palette)).
- Install fonts: Newsreader, Inter, IBM Plex Mono.
- Implement paper/ink palette, noise texture background, custom scrollbar.
- Migrate theme from `data-theme` to Tailwind `dark` class.
- Document animation/transition specs (300ms default; opt-in with `.theme-transition`; cubic-bezier easing for sidebar).

### 3) App Shell + Routing
- Replace root layout with Olivetti sidebar + contextual header.
- Make `/` the Library view.
- Remove `/upload` page; add redirect to Library + open Capture modal.
- Deprecate `/import` in navigation.
- **Responsive behavior**: Sidebar collapses to `w-16` (icons only) on mobile, `w-64` or toggle to `w-20` on desktop.

### 4) Library View
- Implement Library UI per Olivetti.
- Map current projects list into "Recent Files".
- Render "Recent Projects" with sample cards and a "coming soon" placeholder until folders exist.
  - Suggested sample cards: “The Sonic Archives” (Active), “Product Roadmap” (Filed).
- Implement project card hover states (`hover:-translate-y-1`, `shadow-elevation`).

### 5) Capture Modal
- [x] Convert Upload flow to modal triggered from header "Capture" button.
- [x] Reuse existing upload + key terms logic.
- [x] Restyle to Olivetti Capture modal design (glassmorphism, form inputs).
- [x] Implement key terms chip input with Enter to add, comma separation.
- [x] Add Language + Diarization fields as disabled controls labeled "Coming soon".

### 6) Editor Interim Alignment
- Apply Olivetti typography/colors to current editor layout.
- Keep existing AudioPlayer as placeholder.
- Add collapsible waveform container (collapses on scroll > 50px, shows mini progress bar).
- Style transcript cards with speaker color indicators.

### 7) Modals
- Restyle Export modal to Olivetti (radio selection, format badges).
- Implement Find/Replace modal per [specification](#findreplace-modal-specification).
- Remove inline Find/Replace controls from editor toolbar.

### 8) QA + Cleanup
- Execute [Testing Checklist](#testing-checklist).
- Remove deprecated Import entry points.
- Manual flow verification: auth → library → capture → editor → export.

---

## Component Inventory

> Full details in [DESIGN_TOKENS.md](./DESIGN_TOKENS.md#component-inventory)

| Component | Phase | Notes |
|-----------|-------|-------|
| Sidebar (collapsible) | 3 | Toggle icon rotates 180° |
| Contextual Header | 3 | "Library" / breadcrumbs for Editor |
| Theme Toggle | 2 | Sun/moon icon, migrate to `dark` class |
| Project Cards | 4 | Folder tab decoration, status badges |
| File List Items | 4 | Icon + metadata row layout |
| Capture Modal | 5 | Dropzone + form + key terms |
| Export Modal | 7 | Radio options, disabled PDF badge |
| Find/Replace Modal | 7 | See spec below |
| Transcript Cards | 6 | Speaker color bar, timestamp |
| Waveform Visualizer | 6 | Placeholder, collapsible |
| Floating Player Deck | 6 | Keep existing logic, restyle |

---

## Find/Replace Modal Specification

### Opening
- Trigger: `⌘F` / `Ctrl+F` or toolbar button
- Focus moves to search input immediately

### Search Behavior
- Real-time search as user types (debounce optional)
- Empty state shows "Recent Commands" (Export, Highlight)
- On input, switches to "Matches in Transcript" results list
- Each result shows snippet text only (no timestamp/speaker)
- Click result → scroll to match in transcript, close modal
- Closing the modal clears all highlights
- Include “Match case” toggle (keeps existing behavior)

### Replace Behavior
- Replace row appears when search has results
- **"ONE" button**: Replace first occurrence only
- **"ALL" button**: Replace all occurrences, show count Toast

### Highlighting
- `.search-highlight`: `bg-warm-highlight` (light) / `bg-trust-blue text-white` (dark)
- `.search-highlight.current`: `outline: 2px solid ember-red`

### Keyboard Navigation
- `↑` `↓` — Navigate results list
- `↵` (Enter) — Select current result
- `ESC` — Close modal, clear highlights

---

## Accessibility Notes

- **Focus management**: Trap focus inside modals, return focus on close.
- **Keyboard shortcuts**: Document in UI (show `⌘F`, `ESC` badges).
- **ARIA labels**: Add to icon-only buttons (sidebar toggle, export, theme).
- **Color contrast**: Verify `ink` on `paper` meets WCAG AA (4.5:1).
- **Reduced motion**: Respect `prefers-reduced-motion` for animations.

---

## Testing Checklist

### Visual / Theme
- [ ] Dark mode toggle works globally (sidebar, header, modals, editor).
- [ ] Light mode colors match Olivetti prototype.
- [ ] Paper noise texture visible in both modes.
- [ ] Custom scrollbar styled correctly.

### Navigation
- [ ] `/` loads Library view.
- [ ] `/upload` redirects to Library and auto-opens Capture modal.
- [ ] Sidebar collapse/expand works on desktop.
- [ ] Mobile sidebar shows icon-only view.

### Modals
- [ ] Capture modal opens from header button.
- [ ] Capture modal: file upload, form fields, key terms work.
- [ ] Export modal: format selection, export button.
- [ ] Find/Replace: search, highlight, replace one/all.
- [ ] All modals close on `ESC`.

### Editor
- [ ] Transcript loads with speaker color indicators.
- [ ] Waveform collapses on scroll, mini progress bar shows.
- [ ] Floating player deck styled, controls functional.
- [ ] Clicking transcript card seeks audio (existing behavior preserved).

### Keyboard
- [ ] `⌘F` opens Find/Replace.
- [ ] `⌘E` opens Export modal.
- [ ] Arrow keys navigate Find/Replace results.

### Auth
- [ ] Auth page styled with Olivetti theme.
- [ ] Login/signup flows work correctly.

---

## Out of Scope (For This Pass)
- Full studio waveform visualization and immersive editor redesign.
- Project folders and advanced Library project grouping.
- Additional new features beyond UI alignment.
- Live recording (Capture is upload-only for now).

## Risks
- Theme migration may require updates in existing components that rely on `data-theme` or CSS variables.
- Removing `/upload` may affect direct links or documentation — mitigate with redirect.
- Find/Replace modal requires clear behavior to avoid regressions — spec added above.

## Success Criteria
- Library is the first experience at `/`.
- Capture modal replaces `/upload` as primary entry.
- Olivetti design system applied across shell and core flows.
- Editor remains functional with updated styling.
- Auth is visually aligned with new design system.
- All items in Testing Checklist pass.

---

## Decisions Made (Phase 1)

| Date | Decision | Reasoning |
|:---|:---|:---|
| 2026-02-04 | Codename: **Olivetti** | Named after classic Italian typewriter brand; fits editorial aesthetic |
| 2026-02-04 | Sidebar + contextual header layout | Modern app pattern, better hierarchy than top-nav |
| 2026-02-04 | Library as landing page (`/`) | Users arrive at content first, not an action prompt |
| 2026-02-04 | Capture as modal (not page) | Reduces navigation friction, maintains context |
| 2026-02-04 | Migrate to Tailwind `dark` class | Standard approach, better tooling support than `data-theme` |
| 2026-02-04 | Keep existing AudioPlayer logic | Immersive studio player is out of scope; restyle only for now |
| 2026-02-04 | Language + Diarization as "Coming soon" | Show as disabled placeholders in Capture modal |
| 2026-02-04 | `trust-blue` consistent across themes | Single accent color (`#4F638C`) for links/actions in both modes |
| 2026-02-04 | `player-blue` for playback only | Brighter blue (`#3B82F6`) specifically for audio controls |
| 2026-02-04 | Glassmorphism modals | `/45` to `/90` opacity + `backdrop-blur` for premium feel |
| 2026-02-04 | Paper noise texture | SVG-based grain overlay for tactile, editorial feel |
| 2026-02-04 | Collapsible sidebar | `w-16` (mobile/collapsed) ↔ `w-64` (desktop/expanded) |
| 2026-02-04 | Collapsible waveform on scroll | Scroll > 50px triggers collapse, shows mini progress bar |
| 2026-02-04 | Speaker color indicators | Vertical bar on transcript cards; 3 default colors + dynamic |
| 2026-02-04 | `/upload` redirect strategy | Redirect to `/` and auto-open Capture modal |

## Decisions Made (Phase 2)

| Date | Decision | Reasoning |
|:---|:---|:---|
| 2026-02-05 | Tailwind `dark` class enabled | Aligns with Olivetti and simplifies theming |
| 2026-02-05 | Token names fixed in Tailwind | Use `paper`, `ink`, `warm-highlight`, `trust-blue`, `ember-red`, `player-blue`, `night-*`, `studio-dark` |
| 2026-02-05 | Fonts via `next/font` variables | Enables consistent typography across the app |
| 2026-02-05 | Preserve CSS variables | Keep `--bg`, `--text`, etc. while migrating theme trigger to `.dark` |
| 2026-02-05 | Global texture + scrollbar | Implement paper noise, custom scrollbar, and opt-in transitions (`.theme-transition`) in `globals.css` |

## Decisions Made (Phase 3)

| Date | Decision | Reasoning |
|:---|:---|:---|
| 2026-02-05 | Sidebar collapse behavior | Toggle `w-16`/`w-64`; persists to `localStorage` for user preference |
| 2026-02-05 | `/import` route status | Keep accessible for backwards compatibility, remove from primary nav |
| 2026-02-05 | `/upload` redirect | Redirect to `/` + modal to enforce new patterns while keeping links working |
| 2026-02-05 | Sidebar-integrated controls | User/Theme controls moved into Sidebar structure for better hierarchy |
| 2026-02-05 | Code Style Standards | Enforced 2-space indentation and accessible list patterns (no buttons in links) |

## Decisions Made (Phase 4)

| Date | Decision | Reasoning |
|:---|:---|:---|
| 2026-02-05 | Duration format: "X mins" / "X hr Y mins" | Human-readable format matching conversational style |
| 2026-02-05 | Speaker count deferred | Requires additional DB query per project; not available in current schema query |
| 2026-02-05 | Ellipsis menu: Delete only | Keep UI simple; expand actions in future phase |
| 2026-02-05 | "View All" links to `/projects` | Existing page is functional; avoids duplicate views |
| 2026-02-05 | Library requires authentication | Added `/` to protected routes; matches behavior of `/projects` |
| 2026-02-05 | Post-auth redirect to Library | After login, users land on `/` (Library) not `/projects` |
| 2026-02-05 | `isCompleted()` status helper | Normalize status check (`complete`/`completed`) in one place to avoid spreading inconsistency |
