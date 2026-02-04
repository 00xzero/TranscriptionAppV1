# Olivetti Design Tokens Reference

> Extracted from `Olivetti.html` prototype. Use this as the source of truth for implementing the UI refactor.

---

## Color Palette

### Core Colors (Paper & Ink)

| Token | Light Mode | Dark Mode | Usage |
|-------|------------|-----------|-------|
| `paper` | `#E4E1D9` | — | Primary background |
| `ink` | `#1D1E18` | — | Primary text |
| `warm-highlight` | `#FFE8D1` | — | Selection, accent highlights |
| `trust-blue` | `#4F638C` | `#4F638C` | Links, active states, primary actions |
| `player-blue` | `#3B82F6` | `#3B82F6` | Player controls, active playback states |
| `ember-red` | `#C73E1D` | — | Record button, destructive actions, speaker indicator |

### Dark Mode ("Night Shift") Colors

| Token | Value | Usage |
|-------|-------|-------|
| `night-bg` | `#0e0e0c` | Deepest background |
| `night-surface` | `#1D1E18` | Card/surface backgrounds |
| `night-border` | `#333333` | Borders, dividers |
| `studio-dark` | `#141414` | Immersive studio areas |

### Border & Surface Colors

| Context | Light Mode | Dark Mode |
|---------|------------|-----------|
| Primary border | `#D1CEC5` | `#333` or `white/10` |
| Sidebar bg | `#DFDCD4` | `night-surface` |
| Modal bg | `#F2EFED/90` | `#1A1A1A/90` |
| Input bg | `white/50` | `#222/50` |

---

## Typography

### Font Families

| Token | Font Stack | Usage |
|-------|------------|-------|
| `font-sans` | `Inter, sans-serif` | Body text, UI elements |
| `font-serif` | `Newsreader, serif` | Headlines, document titles, logo |
| `font-mono` | `IBM Plex Mono, monospace` | Timestamps, labels, badges |

### Font Loading
```html
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&display=swap" rel="stylesheet">
```

### Text Sizes (Common Patterns)

| Element | Size | Weight | Style |
|---------|------|--------|-------|
| Logo wordmark | `text-2xl` | — | `italic` |
| Page title | `text-3xl` to `text-5xl` | — | serif |
| Section header | `text-xl` | — | serif |
| Body text | `text-lg` | — | sans |
| Speaker name | `text-sm` | `font-bold` | sans |
| Timestamp | `text-[10px]` | — | mono |
| Labels/badges | `text-[10px]` | — | mono, uppercase, tracking-wider |

---

## Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `shadow-elevation` | `0 10px 40px -10px rgba(0,0,0,0.1)` | Hover state on cards |
| `shadow-float` | `0 20px 50px -10px rgba(0,0,0,0.3)` | Floating player deck |

---

## Effects & Textures

### Paper Noise Texture
```css
.bg-noise::before {
  background-image: url("data:image/svg+xml,...");
  opacity: 0.03; /* 0.05 in dark mode */
}
```

### Glassmorphism (Modals & Player)
- Background: `/45` to `/90` opacity
- `backdrop-blur-md` or `backdrop-blur-xl`
- Border: `border-[#D1CEC5]` (light) / `border-white/10` (dark)

### Scrollbar ("Archive Rail")
- Width: `6px`
- Thumb: `#D1CEC5` (light) / `#333` (dark)
- Track: `transparent`

---

## Component Inventory

### App Shell
| Component | Status | Notes |
|-----------|--------|-------|
| Sidebar (collapsible) | To implement | `w-16` collapsed → `md:w-64` expanded |
| Contextual Header | To implement | Changes based on view |
| Theme Toggle | To implement | Migrate from `data-theme` to Tailwind `dark` class |

### Library View
| Component | Status | Notes |
|-----------|--------|-------|
| Project Cards | To implement | Folder tab decoration, status badges |
| File List Items | To implement | Icon + metadata row |
| "New Project" placeholder | To implement | Dashed border style |

### Capture Modal
| Component | Status | Notes |
|-----------|--------|-------|
| File dropzone | To implement | Reuse existing upload logic |
| Project details form | To implement | Title, Language, Diarization toggle |
| Key Terms input | To implement | Comma-separated chips |

### Editor View
| Component | Status | Notes |
|-----------|--------|-------|
| Waveform visualizer | Placeholder | Collapsible on scroll |
| Transcript cards | To implement | Speaker color indicators |
| Floating player deck | Placeholder | Keep existing player logic |
| Mini progress bar | To implement | Visible when waveform collapsed |

### Modals
| Component | Status | Notes |
|-----------|--------|-------|
| Export Modal | To implement | Radio selection, format options |
| Find/Replace Modal | To implement | See spec below |

---

## Animations & Transitions

### Global Transition
```css
transition-property: background-color, border-color, color;
transition-duration: 300ms;
```

### Sidebar Collapse
- Duration: `300ms`
- Easing: `cubic-bezier(0.25, 0.1, 0.25, 1.0)`
- Icon rotation: `rotate(180deg)`

### Waveform Collapse (on scroll)
- Duration: `500ms`
- Properties: `max-height, padding, opacity`
- Trigger: `scrollTop > 50px`

### Card Hover
- Transform: `hover:-translate-y-1`
- Shadow: `hover:shadow-elevation`
- Duration: `300ms`

### Button Active
- `active:scale-95`

### Modal Backdrop
- `backdrop-blur-sm` on overlay
- Content scales/fades in

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘F` / `Ctrl+F` | Open Find/Replace |
| `⌘E` / `Ctrl+E` | Open Export Modal |
| `ESC` | Close any open modal |
| `↑` `↓` | Navigate search results |
| `↵` (Enter) | Select result / Add key term |

---

## Find/Replace Modal Specification

### Behavior
1. Opens with `⌘F`, focuses search input
2. Real-time search as user types
3. Shows "Recent Commands" when empty, switches to "Matches" on input
4. Results display snippet with highlighted term
5. Click result → scroll to match, close modal

### Replace Functionality
- **Replace One**: Replaces first occurrence only
- **Replace All**: Replaces all occurrences, updates count

### Highlight Styling
```css
.search-highlight {
  background-color: #FFE8D1; /* warm-highlight */
  /* dark: bg-trust-blue, text-white */
}
.search-highlight.current {
  outline: 2px solid #C73E1D; /* ember-red */
}
```

---

## Speaker Color Assignment

| Speaker | Color Token |
|---------|-------------|
| Interviewer / Host | `trust-blue` |
| Guest 1 | `ember-red` |
| Guest 2 | `yellow-600` |
| Additional | Cycle or assign dynamically |

---

## Responsive Breakpoints

| Breakpoint | Sidebar | Notes |
|------------|---------|-------|
| Mobile (`< md`) | `w-16` (icons only) | Header search hidden |
| Desktop (`≥ md`) | `w-64` or collapsed `w-20` | Full nav visible |
