# UI Overhaul Glossary

Quick reference for design and UI terms used in the Olivetti refactor.

## Design System Terms

| Term | Definition |
|:---|:---|
| **Olivetti** | Codename for the new design system (named after the iconic Italian typewriter brand) |
| **Paper** | Light mode background color (`#E4E1D9`) — warm, textured cream |
| **Ink** | Primary text color (`#1D1E18`) — deep, rich black |
| **Night Shift** | Dark mode color scheme |
| **Trust Blue** | Primary accent color (`#4F638C`) — used for links, active states |
| **Player Blue** | Playback accent color (`#3B82F6`) — used for audio controls |
| **Ember Red** | Secondary accent (`#C73E1D`) — used for Capture button, speaker indicators |

## UI Component Terms

| Term | Definition |
|:---|:---|
| **App Shell** | Sidebar + contextual header layout (replaces top-nav) |
| **Library** | Main landing view showing projects and recent files (replaces Projects list) |
| **Capture Modal** | Upload flow presented as modal (replaces `/upload` page) |
| **Floating Player Deck** | Bottom-anchored audio controls in Editor view |
| **Transcript Card** | Individual speaker turn with color indicator and timestamp |
| **Waveform Visualizer** | Collapsible audio visualization at top of Editor |

## Layout Terms

| Term | Definition |
|:---|:---|
| **Contextual Header** | Header that changes content based on current view |
| **Breadcrumbs** | Navigation path shown in Editor header (Library / filename.mp3) |
| **Glassmorphism** | Semi-transparent backgrounds with blur effect |
| **Noise Texture** | Subtle paper grain effect applied to backgrounds |

## Modal Types

| Term | Definition |
|:---|:---|
| **Capture Modal** | File upload + project details form |
| **Export Modal** | Format selection for transcript download |
| **Find/Replace Modal** | Search and replace within transcript |

## CSS/Tailwind Terms

| Term | Definition |
|:---|:---|
| **`dark` class** | Tailwind dark mode trigger (replaces `data-theme` attribute) |
| **Design Tokens** | Reusable CSS variables for colors, fonts, spacing |
| **Shadow Elevation** | Hover state shadow (`shadow-elevation`) |
| **Shadow Float** | Floating element shadow (`shadow-float`) |

## State Terms

| Term | Definition |
|:---|:---|
| **Collapsed Sidebar** | Icon-only sidebar state (`w-16` or `w-20`) |
| **Expanded Sidebar** | Full sidebar with labels (`w-64`) |
| **Waveform Collapsed** | State when user scrolls past waveform section |
| **Active Card** | Currently playing transcript segment (highlighted) |

## File/Route Terms

| Term | Definition |
|:---|:---|
| **`/`** | Library view (new home route) |
| **`/upload`** | Deprecated route (redirects to Library + opens Capture) |
| **`/import`** | Deprecated route (removed from nav) |
| **`/editor/[id]`** | Transcript editor (unchanged route) |
| **`/auth`** | Authentication page (restyled) |

## Keyboard Shortcuts

| Shortcut | Action |
|:---|:---|
| `⌘F` / `Ctrl+F` | Open Find/Replace modal |
| `⌘E` / `Ctrl+E` | Open Export modal |
| `ESC` | Close any open modal |
