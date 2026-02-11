# UI Overhaul Phase Status Tracker

> **Update this file at the start and end of each phase.**

## Current Phase

| Field | Value |
|:---|:---|
| **Phase** | 8 - QA + Cleanup |
| **Status** | ✅ Complete |
| **Owner** | Hamza |
| **Started** | 2026-02-11 |
| **Completed** | 2026-02-11 |

## Phase Progress

| Phase | Name | Status | Completion Date |
|:---|:---|:---|:---|
| 1 | Spec Lock | ✅ Complete | 2026-02-04 |
| 2 | Design System Foundation | ✅ Complete | 2026-02-05 |
| 3 | App Shell + Routing | ✅ Complete | 2026-02-05 |
| 4 | Library View | ✅ Complete | 2026-02-05 |
| 5 | Capture Modal | ✅ Complete | 2026-02-06 |
| 6 | Editor Interim Alignment | ✅ Complete | 2026-02-07 |
| 7 | Modals | ✅ Complete | 2026-02-08 |
| 8 | QA + Cleanup | ✅ Complete | 2026-02-11 |

**Legend**: ⏳ Not Started | 🔄 In Progress | ✅ Complete | ⚠️ Blocked | ⏸ Deferred

---

## Pending Decisions (Per Phase)

> Use this list as a checklist. Clear items as they are decided or completed.

### Phase 1 — Spec Lock
None — Phase 1 complete.

### Phase 2 — Design System Foundation
None — Phase 2 complete.

### Phase 3 — App Shell + Routing
None — Phase 3 complete.

### Phase 4 — Library View
- ✅ Project metadata in "Recent Files": title, duration, status, updated_at (speaker count deferred)
- ✅ Empty state: "No projects yet. Click 'Capture' to start your first transcription."
- ✅ "View All" links to `/projects` page

### Phase 5 — Capture Modal
- ✅ File messaging: "MP3, WAV, M4A, AAC, FLAC, MP4, MOV, WebM, OGG (up to 1.5GB)"
- ✅ Drag-and-drop: Implemented with visual feedback
- ✅ Post-upload navigation: Stay on Library (modal closes, realtime updates show new project)

### Phase 6 — Editor Interim Alignment
- ✅ Waveform placeholder: Collapsible on scroll > 50px, shows mini progress bar.
- ✅ Transcript card active state: `bg-trust-blue/10 dark:bg-trust-blue/15`.
- ✅ Existing controls: AudioPlayer controls hidden when FloatingPlayerDeck is visible.

### Phase 7 — Modals
- ✅ Export modal: DOCX + VTT active, PDF "COMING SOON", Olivetti glassmorphism styling
- ✅ Find/Replace highlight: warm-highlight (light) / trust-blue (dark), ember-red outline on current match
- ✅ Focus trap: Both modals trap focus via useFocusTrap hook
- ✅ Two-step Enter: first Enter commits search term, second Enter selects result and closes modal
- ✅ Debounce dirty state: "Searching..." indicator while input is uncommitted; replace controls disabled
- ✅ Highlights persist on modal close; clear only when query is cleared or changed
- ✅ Auto-exit: Opening Find/Replace or Export auto-closes segment edit mode and speaker popover
- ✅ Comprehensive test suite: 12+ tests covering modal interactions, debounce, cross-modal exclusion, auto-exit

### Phase 8 — QA + Cleanup
- ✅ Deprecated `/import` route fully removed (page + middleware)
- ✅ Auth post-login redirect fixed: `/projects` → `/` (Library)
- ✅ `prefers-reduced-motion` accessibility support added to `globals.css`
- ✅ No stale `data-theme` references found
- ✅ 111/111 automated tests pass
- ✅ `⌘E` Export shortcut implemented in editor
- ✅ M4A upload fix: added browser MIME aliases to Supabase bucket allowlist
- ✅ Testing checklist items verified (automated + browser)

---

## Phase Handoff Notes

> Engineers completing a phase should document key decisions, gotchas, and context for the next phase here.

### Phase 1 → Phase 2

**Key Deliverables Created:**
- Spec decisions finalized for Find/Replace modal and Library placeholders.

**Decisions Made:**
- Find/Replace modal includes Match Case toggle.
- Results list shows snippet text only (no timestamps/speaker labels).
- Highlights clear on modal close.
- Selecting a result closes the modal.
- Recent Projects uses sample cards: “The Sonic Archives” (Active), “Product Roadmap” (Filed), plus “New Project Folder” placeholder.

**For Phase 2:**
- Implement design tokens and theme migration per DESIGN_TOKENS.md.

**Gotchas:**
- Keep `trust-blue` consistent across themes; use `player-blue` for player controls.

---

### Phase 2 → Phase 3

**Key Deliverables Created:**
- Tailwind tokens in `tailwind.config.ts` with Olivetti color palette
- CSS variables in `globals.css` for theming
- Paper noise texture via `bg-noise` utility class
- Font setup via `next/font` (Inter, Newsreader, IBM Plex Mono)

**Decisions Made:**
- Theme switching uses Tailwind's `dark` class strategy
- Noise texture applied via pseudo-element on body
- Auth page restyled with Olivetti glassmorphism and typography

**For Phase 3:**
- Replace top-nav with sidebar + contextual header
- Make Library the landing page at `/`
- Redirect `/upload` to open Capture modal

**Gotchas:**
- CSS variable names use `--bg`, `--text` etc. for semantic layering
- `content-layer` class ensures content appears above noise texture

---

### Phase 3 → Phase 4

**Key Deliverables Created:**
- `Sidebar.tsx`: Collapsible Olivetti sidebar with navigation, user section, theme toggle
- `ContextualHeader.tsx`: View-aware header with search and Capture button
- `CaptureModal.tsx`: Glassmorphism modal placeholder for file capture
- `LibraryView.tsx`: Library landing page with greeting and project cards
- `ModalContext.tsx`: Global context for modal state management
- Updated `layout.tsx` to new sidebar shell structure
- Updated `page.tsx` to render LibraryView
- Updated `upload/page.tsx` to redirect with modal trigger

**Decisions Made:**
- Sidebar collapse: Toggle between `w-16` (collapsed) and `w-64` (expanded) on desktop
- `/import` route: Remains accessible via direct URL for backwards compatibility, removed from nav
- Sidebar collapse state persists to `localStorage`

**For Phase 4:**
- Implement full Library view with real project data
- Add folder organization and "View All" functionality
- Connect LibraryView to actual projects API

**Gotchas:**
- `/upload` redirect triggers auth middleware when not signed in (expected, Library requires auth)
- Theme toggle is now integrated into sidebar, not a separate dropdown
- `ThemeToggle.tsx` and `AuthStatus.tsx` are no longer used in layout (functionality moved into Sidebar)
- **Code Style**: Enforced 2-space indentation for all new components (`Sidebar`, `CaptureModal`, `LibraryView`)
- **Accessibility**: Library list items use sibling positioning for actions to avoid invalid HTML (button inside link)
- **Robustness**: User initials generation now handles missing name/email gracefully

---

### Phase 4 → Phase 5

**Key Deliverables Created:**
- Enhanced `LibraryView.tsx` with real project data display
- Duration formatting helper ("42 mins" / "1 hr 42 mins")
- Status badges for processing/error projects
- Ellipsis dropdown menu with delete action + confirmation dialog

**Decisions Made:**
- Duration format: "X mins" for <1 hour, "X hr Y mins" for ≥1 hour
- Speaker count display: DEFERRED (requires additional database query per project)
- Ellipsis menu actions: Delete only (more actions in future phase)
- "View All" navigates to `/projects` page

**For Phase 5:**
- Implement full Capture modal with file upload, key terms, and form styling
- Wire up existing upload logic to modal
- Add Language + Diarization as disabled "Coming soon" fields

**Gotchas:**
- Projects with `null` duration show "Duration unknown"
- Both `complete` and `completed` status values are handled for editor navigation
- Delete uses optimistic update from `useProjectsRealtime` hook

---

### Phase 5 → Phase 6

**Key Deliverables Created:**
- Full `CaptureModal.tsx` with drag-and-drop, valid types (audio/video), and key terms.
- `useCapture.ts` hook robustly handling:
  - File upload to Supabase storage.
  - Project creation + separate `source_object_key` update (fixes silent failure).
  - Transcription initiation via Inngest.
- MIME handling improvements:
  - Inference from extension when `file.type` is empty.
  - Normalization of aliases (e.g., `audio/x-m4a` → `audio/mp4`).
- Auth Guard: Capture button and search hidden when not logged in.
- UI Updates: removed MKV from supported list, updated Auth screen header.

**Decisions Made:**
- File messaging: "MP3, WAV, M4A, AAC, FLAC, MP4, MOV, WebM, OGG (up to 1.5GB)"
- Drag-and-drop: Yes, with visual hover feedback (border color change)
- Post-upload: Modal closes, user stays on Library (realtime shows new project)
- Title auto-fills from filename (without extension) if empty
- Key terms: Comma/Enter to add, chips with X to remove, 100 term limit
- Client-side mapping of browser-reported aliases to bucket-allowed canonical types (e.g., `audio/x-m4a` -> `audio/mp4`).
- Fallback to extension-based MIME type if browser reports empty string (common for some video formats).
- MKV Support Removed: explicitly removed `.mkv` support to avoid bucket validation errors (bucket has strict allowlist).
- Inngest Requirement: Transcription start relies on Inngest events; local dev server must be running.

**For Phase 6:**
- Editor alignment with card-based layout.
- Waveform placeholder or simplified player.
- Transcript card active state styling.

**Gotchas:**
- Modal is accessible even when auth screen is shown (intentional for layout consistency)
- `useCapture` returns project ID on success, null on failure
- Supported file types checked by both MIME type and extension (fallback)
- The `media` bucket has a **strict** MIME allowlist. Any new file types must be added to the bucket config *and* the client-side `useCapture.ts` validation/normalization.
- Project is created *first*, file uploaded *second*, then project updated with `source_object_key` *third*. This multi-step process handles potential upload failures better but requires careful error handling.
- **Robustness**: The capture flow now includes automatic rollback if the project is created but the file upload fails. If the file is uploaded but the project update fails, the user is notified.
- **Suspense Requirement**: The `ProjectsPage` uses `useSearchParams` to show capture outcomes, requiring a `<Suspense>` boundary to prevent build errors in Next.js 14+.
- **SSR/Hydration**: `ContextualHeader.tsx` creates Supabase client inside `useEffect` (not at module level) to avoid SSR issues and shared-singleton bugs.
- **Drag State Reset**: `CaptureModal.tsx` resets `isDragging` state when modal closes to prevent stale dropzone highlight.
- **AVI Support**: Added `video/x-msvideo` to `SUPPORTED_MIME_TYPES` and updated UI help text to include AVI for consistent file type messaging.

---

### Phase 6 → Phase 7

**Key Deliverables Created:**
- Enhanced `CollapsibleWaveform.tsx` with gradient fades on edges
- Updated typography in editor document header (text-4xl md:text-5xl, tracking-tight)
- Transcript card styling refinements (active state, hover states, inline timestamp with speaker)
- Verified `FloatingPlayerDeck.tsx` matches Olivetti glassmorphism styling
- Header/sidebar alignment: Both now use `h-[56px]` for pixel-perfect divider alignment
- Speaker color palette aligned with Olivetti prototype (trust-blue, ember-red, yellow-600)
- Timestamp format standardized to `HH:MM:SS` with full zero-padding
- Document header metadata display: Date • Speakers • Duration format

**Decisions Made:**
- Title typography: `text-4xl md:text-5xl tracking-tight italic` (matches Olivetti)
- Metadata separators: Bullet dots (•) instead of pipes (|) for cleaner look
- Active card styling: `bg-trust-blue/10 dark:bg-trust-blue/15` for consistent theming
- Waveform gradient fades: `from-paper dark:from-black to-transparent` on edges
- Header height: `h-[56px]` (matches Olivetti prototype, aligns with sidebar divider)
- Speaker colors: First 3 match prototype exactly (#4F638C, #C73E1D, #CA8A04), then brand-complementary
- Timestamp format: Always `HH:MM:SS` with leading zeros (e.g., `00:04:03`)

**For Phase 7:**
- Implement Find/Replace modal (triggered by ⌘F)
- Restyle Export modal to Olivetti design
- Remove inline Find/Replace toolbar from editor (or keep as fallback)

**Gotchas:**
- Time rulers and playhead styling deferred to future enhancement
- Volume control section in FloatingPlayerDeck deferred
- Inline Find/Replace toolbar remains for now; modal version is Phase 7

---

### Phase 7 → Phase 8

**Key Deliverables Created:**
- `FindReplaceModal.tsx`: Olivetti glassmorphism Find/Replace modal with search, navigation, replace, and match context snippets
- `useFocusTrap.ts`: Lightweight focus trap hook (no dependencies) for Tab/Shift+Tab trapping, focus save/restore
- Restyled `ExportModal.tsx`: Olivetti glassmorphism with custom radio-card format selector, ESC/scroll lock
- Updated `ContextualHeader.tsx`: Export icon button + Find & Replace button with `Cmd+F` badge on editor route; translucency matched to FloatingPlayerDeck (`bg-white/45 dark:bg-[#1A1A1A]/45 backdrop-blur-md`)
- Updated editor `page.tsx`: Inline toolbar removed, Cmd+F shortcut, FindReplaceModal wired, Olivetti highlight colors, two-step Enter logic, debounce dirty state with "Searching..." indicator, auto-exit edit mode / speaker popover on modal open
- Updated `CollapsibleWaveform.tsx`: Eliminated gap between header divider and mini progress bar (`leading-none` + `block` button)
- Updated `editor.test.tsx`: Comprehensive test suite (12+ tests) — Cmd+F shortcut, debounce behavior, two-step Enter, replace one + replace all, Export modal open/close/ESC, cross-modal exclusion (Cmd+F ignored while Export open), auto-exit edit mode, auto-close speaker popover

**Decisions Made:**
- Find/Replace is a pure presentational modal; all state/logic stays in editor page (~15 props)
- Header→editor communication via CustomEvent (`open-find-replace`, `open-export`) to avoid ModalContext dependency
- ModalContext unchanged — custom events are simpler and test-safe
- Both modals use `z-[100]` (matches CaptureModal), no conflicts since they're on different routes
- Focus trap intercepts Tab only; tests using `type()` and `click()` are unaffected
- Highlight colors: `bg-warm-highlight text-ink` (light) / `bg-trust-blue text-white` (dark), current match has `outline-2 outline-ember-red`
- Header translucency: Matched to FloatingPlayerDeck for visual consistency (`/45` opacity + `backdrop-blur-md`)
- Mini player flush: `leading-none` on wrapper + `block` on button eliminates inline baseline gap
- Two-step Enter: First Enter commits dirty search term; second Enter on committed term selects result and closes modal (stays open if 0 matches)
- Highlights persist on modal close: Matches remain visible until query is cleared or changed
- Replace row appears when query is active; replace buttons remain disabled until search is committed with matches
- Auto-exit edit mode: Opening Find/Replace or Export auto-closes any active segment textarea and speaker popover

**For Phase 8:**
- Full QA pass across all routes
- Cross-browser testing (Safari, Firefox, Chrome)
- Responsive testing at mobile/tablet breakpoints
- Accessibility audit (keyboard navigation, screen reader)

**Gotchas:**
- `Cmd+F` is intercepted BEFORE the `instanceof HTMLInputElement` guard so it works even when an input is focused
- FindReplaceModal ESC handler closes the modal; the editor keyboard handler does not need ESC handling
- Body scroll lock (`overflow: hidden`) is applied on modal open and restored on close
- Tests open the modal via `fireEvent.keyDown(document, { key: 'f', metaKey: true })` before interacting with find/replace
- CollapsibleWaveform mini bar uses `block` display to avoid default inline-block baseline spacing from `<button>`
- Header was previously `bg-paper/80 backdrop-blur-sm`; updated to match FloatingPlayerDeck exactly for cohesive glassmorphism
- `isFindDirty` (`findInput !== findTerm`) gates navigation and replace buttons to prevent stale-match operations during debounce
- `matchSummary` shows "Searching..." while dirty, preventing user confusion during the 800ms debounce window
- Opening Export while Find/Replace is open (or vice versa) is prevented — Cmd+F is ignored while Export modal is visible
- Segment edit mode (`editingId`) is cleared on modal open to prevent hidden textarea edits conflicting with find/replace

---

## Blockers and Dependencies

| Blocker | Affects Phase | Owner | Status |
|:---|:---|:---|:---|
| None | — | — | — |

---

## Key Decisions Log

| Date | Phase | Decision | Reasoning |
|:---|:---|:---|:---|
| 2026-02-04 | Phase 1 | Codename: Olivetti | Named after classic Italian typewriter brand, fits the "editorial" aesthetic |
| 2026-02-04 | Phase 1 | Sidebar + contextual header | Matches modern app patterns, better hierarchy than top-nav |
| 2026-02-04 | Phase 1 | Library as landing page | Users arrive at content first, not an action prompt |
| 2026-02-04 | Phase 1 | Capture as modal, not page | Reduces navigation friction, keeps context |
| 2026-02-04 | Phase 1 | `/upload` redirects to `/` and auto-opens Capture | Preserve deep links while enforcing modal-first flow |
| 2026-02-04 | Phase 1 | Migrate to Tailwind `dark` class | Standard approach, better tooling support than `data-theme` |
| 2026-02-04 | Phase 1 | Keep existing AudioPlayer logic | Immersive studio player is out of scope; restyle only |
| 2026-02-04 | Phase 1 | Language + Diarization disabled | Show as "Coming soon" placeholders in Capture modal |
| 2026-02-04 | Phase 1 | `trust-blue` consistent across themes | Single accent color for links/actions in both modes |
| 2026-02-04 | Phase 1 | `player-blue` for playback | Brighter blue (`#3B82F6`) specifically for audio controls |
| 2026-02-04 | Phase 1 | Find/Replace modal details | Match Case toggle; snippet-only results; highlights persist until query is cleared or changed; selecting result closes modal |
| 2026-02-04 | Phase 1 | Recent Projects placeholders | Sample cards: “The Sonic Archives” (Active), “Product Roadmap” (Filed), plus New Project Folder placeholder |
| 2026-02-05 | Phase 2 | Tailwind token names | Use `paper`, `ink`, `warm-highlight`, `trust-blue`, `ember-red`, `player-blue`, `night-*`, `studio-dark` |
| 2026-02-05 | Phase 2 | Dark mode persistence | Store `app-theme` in localStorage; map legacy `blue` to `dark` |
| 2026-02-05 | Phase 2 | CSS variables | Keep `--bg`, `--text`, etc., but update values and bind to `.dark` class |
| 2026-02-05 | Phase 2 | Fonts via `next/font` | Use Inter/Newsreader/IBM Plex Mono with CSS variables for consistency |
| 2026-02-05 | Phase 2 | Global texture + scrollbar | Add paper noise, custom scrollbar, and opt-in transitions (`.theme-transition`) in `globals.css` |
| 2026-02-05 | Phase 3 | Sidebar collapse behavior | Toggle between `w-16` (collapsed) and `w-64` (expanded) on desktop; persists to `localStorage` |
| 2026-02-05 | Phase 3 | `/import` route status | Deprecated from navigation but accessible via direct URL for backwards compatibility |
| 2026-02-05 | Phase 3 | `/upload` redirect | Redirects to `/` and auto-opens Capture modal to enforce new flow while supporting legacy links |
| 2026-02-05 | Phase 3 | `AuthStatus` & `ThemeToggle` | Integrated directly into Sidebar user/bottom sections; removed standalone components from layout |
| 2026-02-05 | Phase 4 | Duration format: "X mins" / "X hr Y mins" | Human-readable, conversational style for project metadata |
| 2026-02-05 | Phase 4 | Speaker count deferred | Requires additional DB query per project; not available in current schema query |
| 2026-02-05 | Phase 4 | Ellipsis menu: Delete only | Keep UI simple; expand actions in future phase |
| 2026-02-05 | Phase 4 | "View All" → `/projects` | Existing page is functional; avoids duplicate views |
| 2026-02-05 | Phase 4 | Library requires authentication | Added `/` to protected routes; matches behavior of `/projects` |
| 2026-02-05 | Phase 4 | Post-auth redirect to Library | After login, users land on `/` (Library) not `/projects` |
| 2026-02-05 | Phase 4 | `isCompleted()` status helper | Normalize status check (`complete`/`completed`) in one place to avoid spreading inconsistency |
| 2026-02-06 | Phase 5 | Remove MKV support | Supabase bucket strictly forbids `video/x-matroska`; removed to prevent user confusion |
| 2026-02-06 | Phase 5 | Client-side MIME normalization | Browsers report aliases (e.g. `audio/x-m4a`) that fail strict bucket checks; locally normalized to canonical types |
| 2026-02-06 | Phase 5 | Upload flow logic split | Separate `source_object_key` update step ensures reliability over initial insert |
| 2026-02-07 | Phase 5 | Granular Capture Outcomes | Distinguished 'started' vs 'saved_needs_retry' to guide users when Inngest/network fails but upload succeeded |
| 2026-02-07 | Phase 5 | Automatic Rollback | If project creation succeeds but upload fails, the project is auto-deleted to prevent orphan records |
| 2026-02-07 | Phase 5 | Suspense Boundary | `ProjectsPage` wrapped in Suspense to safely handle `useSearchParams` for capture outcome notification |
| 2026-02-07 | Phase 6 | Header/sidebar alignment | Both use `h-[56px]` for pixel-perfect divider alignment matching Olivetti prototype |
| 2026-02-07 | Phase 6 | Speaker color palette | First 3 colors match prototype exactly (trust-blue, ember-red, yellow-600), then brand-complementary |
| 2026-02-07 | Phase 6 | Timestamp format | Always `HH:MM:SS` with full zero-padding for consistency |
| 2026-02-07 | Phase 6 | Metadata display | Document header shows Date • Speakers • Duration format |
| 2026-02-07 | Phase 6 | Transcript card layout | Inline timestamp with speaker name, pencil icon for edit on hover |
| 2026-02-08 | Phase 7 | Find/Replace as modal, not inline toolbar | Matches Olivetti glassmorphism design, triggered via Cmd+F or header button |
| 2026-02-08 | Phase 7 | CustomEvent for header→editor communication | Avoids ModalContext dependency, keeps tests simple (no ModalProvider wrapper needed) |
| 2026-02-08 | Phase 7 | Focus trap via custom hook | Lightweight, no external dependency, Tab/Shift+Tab trapping with focus save/restore |
| 2026-02-08 | Phase 7 | Highlight colors: warm-highlight + ember-red outline | Olivetti tokens for match highlighting; current match outlined in ember-red for visibility |
| 2026-02-11 | Phase 7 | Header translucency matches FloatingPlayerDeck | `bg-white/45 backdrop-blur-md` for cohesive glassmorphism across all chrome |
| 2026-02-11 | Phase 7 | Mini player flush with header divider | `leading-none` + `block` button eliminates inline baseline gap in CollapsibleWaveform |
| 2026-02-11 | Phase 7 | Highlight persistence on close | Closing Find/Replace keeps highlights; highlights clear when query is cleared or changed |
| 2026-02-11 | Phase 7 | Replace row visibility | Replace controls appear when a search query is active (buttons remain match-gated) |
| 2026-02-11 | Phase 7 | Two-step Enter behavior | First Enter commits dirty term; second Enter selects result and closes modal (stays open if 0 matches) |
| 2026-02-11 | Phase 7 | Debounce dirty state indicator | "Searching..." shown while input differs from committed term; replace disabled until committed |
| 2026-02-11 | Phase 7 | Auto-exit edit mode on modal open | Opening Find/Replace or Export clears segment editing and speaker popover to prevent conflicts |
| 2026-02-11 | Phase 7 | Comprehensive modal test suite | 12+ tests covering Find/Replace, Export, debounce, two-step Enter, cross-modal exclusion, auto-exit |
| 2026-02-11 | Phase 8 | Auth redirect to `/` (Library) | Aligns with Phase 4 decision; Library is the primary landing page |
| 2026-02-11 | Phase 8 | `prefers-reduced-motion` disables all animations | Global `transition: none !important` and `animation: none !important` for accessibility |
| 2026-02-11 | Phase 8 | `⌘E` Export shortcut | Follows `⌘F` pattern; intercepted before input guard in editor keyboard handler |
| 2026-02-11 | Phase 8 | Supabase bucket MIME aliases | Expanded `allowed_mime_types` to include browser aliases as defense-in-depth alongside client normalization |
| 2026-02-11 | Phase 8 | Deprecated `/import` fully removed | Page file deleted + removed from `PROTECTED_ROUTES`; no longer accessible via direct URL |

---

### Phase 8 → Post-Overhaul

**Key Deliverables Created:**
- Deprecated `/import` route removed (page file deleted + removed from `PROTECTED_ROUTES` in `middleware.ts`)
- Auth post-login redirect fixed from `/projects` → `/` (Library) in `auth/page.tsx`
- `prefers-reduced-motion` accessibility media query added to `globals.css`
- `⌘E` / `Ctrl+E` keyboard shortcut for Export modal in editor `page.tsx`
- M4A upload fix: expanded Supabase `media` bucket `allowed_mime_types` to include browser aliases (`audio/x-m4a`, `audio/m4a`, `audio/x-wav`, `audio/mp3`, `audio/x-flac`, `video/x-m4v`)
- Added forward migration (`20260211000000_expand_bucket_mime_types.sql`) to apply aliases in existing environments

**Decisions Made:**
- Auth redirect target is `/` (Library), not `/projects`, aligning with Phase 4 decision
- `prefers-reduced-motion` disables all `transition` and `animation` properties globally
- Export shortcut `⌘E` follows same pattern as `⌘F` Find/Replace shortcut
- Supabase bucket allowlist expanded to accept ALL browser-reported MIME aliases rather than relying solely on client-side normalization

**Gotchas:**
- Supabase storage validates MIME types against the bucket's `allowed_mime_types` ARRAY *independently* of the `contentType` header — both the client normalization AND the bucket allowlist must cover browser aliases
- The frontend `getMimeType()` normalizer in `useCapture.ts` still normalizes aliases to canonical types, but the bucket now accepts both as defense-in-depth
- Some testing checklist items (transcript card seeks audio, full auth flow) require manual verification with real credentials

---

## Scope Reference

### In Scope
- App shell (sidebar + header)
- Library view at `/`
- Capture modal replacing `/upload`
- Editor visual alignment
- Export and Find/Replace modal styling
- Auth page theming
- Dark/light mode with Tailwind `dark` class
- Responsive sidebar collapse

### Out of Scope
- Full immersive studio waveform visualization
- Project folders and grouping
- Live recording functionality
- New features beyond UI alignment
- Backend/API changes

---

## Testing Checklist Reference

See [UIREFACTOR_PLAN.md#testing-checklist](./UIREFACTOR_PLAN.md#testing-checklist) for the full QA checklist to execute in Phase 8.
