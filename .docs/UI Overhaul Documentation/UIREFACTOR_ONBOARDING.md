# UI Overhaul Onboarding Guide

> **Purpose**: Get up to speed quickly when joining the Olivetti UI refactor.

## Quick Start (5 minutes)

1. **Open the prototype**: [Olivetti.html](../../Olivetti.html) — view in browser, try dark mode toggle
2. **Read the design tokens**: [DESIGN_TOKENS.md](./DESIGN_TOKENS.md) — colors, fonts, components
3. **Understand the plan**: [UIREFACTOR_PLAN.md](./UIREFACTOR_PLAN.md) — phases and scope
4. **Check current status**: [UIREFACTOR_PHASE_STATUS.md](./UIREFACTOR_PHASE_STATUS.md) — what's done, what's next

## What Is This Refactor?

A visual overhaul of the transcription app UI, codenamed **Olivetti**:

| Before | After |
|:---|:---|
| Top navigation bar | Sidebar + contextual header |
| `/projects` landing | `/` Library view |
| `/upload` page | Removed route; use Capture modal from Library |
| Basic styling | Premium glassmorphism, noise textures |
| `data-theme` toggle | Tailwind `dark` class |

## Design System Overview

### Color Palette
```text
Light Mode:     paper (#E4E1D9) + ink (#1D1E18)
Dark Mode:      night-bg (#0e0e0c) + paper text
Accents:        trust-blue (#4F638C), ember-red (#C73E1D)
```

### Typography
```text
Headlines:      Newsreader (serif, italic)
Body:           Inter (sans-serif)
Labels/Code:    IBM Plex Mono
```

### Key Visual Elements
- **Glassmorphism**: `/45` to `/90` opacity backgrounds + `backdrop-blur`
- **Paper Noise**: SVG texture overlay for tactile feel
- **Speaker Colors**: Vertical bars on transcript cards

## Codebase Context

```text
frontend/
├── app/
│   ├── page.tsx          # → Library view (Phase 4)
│   ├── editor/[id]/      # → Restyled (Phase 6)
│   └── auth/             # → Restyled (Phase 2)
│   └── globals.css       # → Add Olivetti tokens (Phase 2)
├── components/
│   ├── Sidebar.tsx       # → NEW (Phase 3)
│   ├── CaptureModal.tsx  # → NEW (Phase 5)
│   └── ...
└── tailwind.config.ts    # → Add design tokens (Phase 2)
```

## Phase Quick Reference

| Phase | Name | Key Deliverables |
|:---|:---|:---|
| 1 | Spec Lock | Finalize modal behaviors, placeholders |
| 2 | Design System | Tailwind tokens, fonts, theme toggle |
| 3 | App Shell | Sidebar, header, routing changes |
| 4 | Library | Project cards, recent files list |
| 5 | Capture Modal | File upload modal with key terms |
| 6 | Editor | Styling update, waveform container |
| 7 | Modals | Export, Find/Replace styling |
| 8 | QA | Testing checklist, cleanup |

## Where to Find Things

| Need | Location |
|:---|:---|
| Design prototype | `Olivetti.html` (project root) |
| Color values | [DESIGN_TOKENS.md#color-palette](./DESIGN_TOKENS.md#color-palette) |
| Component list | [DESIGN_TOKENS.md#component-inventory](./DESIGN_TOKENS.md#component-inventory) |
| Testing checklist | [UIREFACTOR_PLAN.md#testing-checklist](./UIREFACTOR_PLAN.md#testing-checklist) |
| Phase status | [UIREFACTOR_PHASE_STATUS.md](./UIREFACTOR_PHASE_STATUS.md) |

## Common Questions

### Where do I add new design tokens?
1. Add to `tailwind.config.ts` under `theme.extend.colors`
2. Document in [DESIGN_TOKENS.md](./DESIGN_TOKENS.md)

### How do I test dark mode?
Toggle the theme button in sidebar (or use browser devtools to add `dark` class to `<html>`)

### What happened to the `/upload` page?
The route has been removed. Launch Capture from the header button in Library/Projects.

### Are we changing any backend logic?
No. This is a pure UI refactor. All backend/API logic from the previous refactor remains unchanged.

### Where is the existing refactor documentation?
[.docs/Refactor Documentation/](../Refactor%20Documentation/) — contains backend architecture, glossary, and completed phase docs.

## Getting Help

- Review the [Olivetti.html](../../Olivetti.html) prototype for visual reference
- Check [DESIGN_TOKENS.md](./DESIGN_TOKENS.md) for exact values
- Search existing components for patterns
- Ask about decisions in [UIREFACTOR_PHASE_STATUS.md#key-decisions-log](./UIREFACTOR_PHASE_STATUS.md#key-decisions-log)
