# UI Overhaul Phase Status Tracker

> **Update this file at the start and end of each phase.**

## Current Phase

| Field | Value |
|:---|:---|
| **Phase** | 6 - Editor Interim Alignment |
| **Status** | ⏳ Not Started |
| **Owner** | Hamza |
| **Started** | — |
| **Target Completion** | TBD |

## Phase Progress

| Phase | Name | Status | Completion Date |
|:---|:---|:---|:---|
| 1 | Spec Lock | ✅ Complete | 2026-02-04 |
| 2 | Design System Foundation | ✅ Complete | 2026-02-05 |
| 3 | App Shell + Routing | ✅ Complete | 2026-02-05 |
| 4 | Library View | ✅ Complete | 2026-02-05 |
| 5 | Capture Modal | ✅ Complete | 2026-02-06 |
| 6 | Editor Interim Alignment | 🔄 In Progress | — |
| 7 | Modals | ⏳ Not Started | — |
| 8 | QA + Cleanup | ⏳ Not Started | — |

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
- Confirm which existing controls stay visible in the new layout.
- Confirm waveform placeholder behavior (static vs collapsible based on scroll).
- Confirm transcript card active state styling.

### Phase 7 — Modals
- Confirm Export modal formats and labels.
- Confirm Find/Replace highlight colors and selection outline.
- Confirm whether modals should trap focus.

### Phase 8 — QA + Cleanup
- Confirm final acceptance checklist scope.
- Confirm whether screenshots are required for PRs in this phase.

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

---

### Phase 6 → Phase 7

*To be filled when Phase 6 completes.*

---

### Phase 7 → Phase 8

*To be filled when Phase 7 completes.*

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
| 2026-02-04 | Phase 1 | Find/Replace modal details | Match Case toggle; snippet-only results; clear highlights on close; selecting result closes modal |
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
