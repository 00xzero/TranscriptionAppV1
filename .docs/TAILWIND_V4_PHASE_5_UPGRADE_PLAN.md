# Phase 5: Tailwind CSS 3.4.7 to 4.2.2 Upgrade

## Context

Phase 5 of the Tech Stack Upgrade Plan in [`.docs/TECH_STACK_UPGRADE_PLAN.md`](./TECH_STACK_UPGRADE_PLAN.md).

Tailwind v4 is a near-complete rewrite: configuration moves from JS to CSS, `@tailwind` directives are replaced by `@import`, and several utility classes are renamed. This project's setup is clean, with no plugins, no `@apply`, and no legacy opacity utilities, which makes the migration straightforward but still requires careful handling of custom design tokens and font variable naming.

Browser support assumption: Tailwind v4 targets Safari 16.4+, Chrome 111+, and Firefox 128+. This app is assumed to not require older browser support. If it does, this phase is blocked.

---

## Step 1: Branch and run the automated upgrade tool

```bash
git checkout -b deps/phase-5-tailwind-4
cd frontend
npx @tailwindcss/upgrade@latest
```

The upgrade tool should:

- Install `tailwindcss@4.x` and `@tailwindcss/postcss`
- Convert `tailwind.config.ts` into `@theme` CSS in `globals.css`
- Replace `@tailwind base/components/utilities` with `@import "tailwindcss"`
- Update `postcss.config.js`
- Rename deprecated utility classes in `.tsx` files

Commit the raw automated output first, then manually fix what it missed.

---

## Step 2: Verify or fix `postcss.config.js`

Target:

```js
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

- Remove `tailwindcss` and `autoprefixer` entries because Tailwind v4 bundles prefixing.
- File: `frontend/postcss.config.js`

---

## Step 3: Fix the `globals.css` `@theme` block

After the automated tool runs, verify the `@theme` block has the correct variable names.

Target structure:

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --color-paper: #E4E1D9;
  --color-ink: #1D1E18;
  --color-warm-highlight: #FFE8D1;
  --color-trust-blue: #4F638C;
  --color-ember-red: #C73E1D;
  --color-night-surface: #1D1E18;
  --color-night-border: #333333;

  --shadow-elevation: 0 10px 40px -10px rgba(0,0,0,0.1);
  --shadow-float: 0 20px 50px -10px rgba(0,0,0,0.3);

  --font-sans: var(--font-inter), 'Inter', sans-serif;
  --font-serif: var(--font-newsreader), 'Newsreader', serif;
  --font-mono: var(--font-ibm-plex-mono), 'IBM Plex Mono', monospace;
}
```

The rest of `globals.css` should remain as-is:

- `:root` and `.dark` CSS variables
- `.bg-surface`, `.bg-noise`, scrollbar styling
- range input styling
- transitions and reduced motion rules

- File: `frontend/app/globals.css`

---

## Step 4: Rename font CSS variables in `layout.tsx`

`next/font` variables must not collide with Tailwind v4's `--font-*` theme namespace.

Mapping:

- `--font-sans` -> `--font-inter`
- `--font-serif` -> `--font-newsreader`
- `--font-mono` -> `--font-ibm-plex-mono`

The `body` CSS rule `font-family: var(--font-sans)` should resolve through Tailwind's theme variable chain:

```text
--font-sans -> var(--font-inter) -> actual font
```

- File: `frontend/app/layout.tsx`

---

## Step 5: Delete `tailwind.config.ts`

After all theme extensions, including colors, fonts, and shadows, plus dark-mode behavior have been migrated into CSS and verified, delete the JS config.

Tailwind v4 can still load legacy JS config via `@config` if needed, but a clean CSS-only setup is preferred here because the config surface is small.

- File: `frontend/tailwind.config.ts`

---

## Step 6: Fix renamed utility classes with a repo-wide grep cleanup

The automated tool should handle many of these, but run a repo-wide search after the tool finishes and fix anything it missed. Do not rely on a fixed-file checklist alone. Search the entire `frontend/` tree for each pattern.

### 6a. `shadow-sm` -> `shadow-xs` (8 occurrences)

Tailwind v4 shifted the shadow scale, and v3's `shadow-sm` maps to v4's `shadow-xs`.

```bash
rg -n "shadow-sm" frontend/
```

Known files:

- `frontend/components/Sidebar.tsx`
- `frontend/components/ContextualHeader.tsx` (2)
- `frontend/components/LibraryView.tsx` (2)
- `frontend/components/FloatingPlayerDeck.tsx`
- `frontend/components/CaptureModal/CaptureFooter.tsx`
- `frontend/app/editor/[id]/components/TranscriptSegmentCard.tsx`

### 6b. `flex-shrink-0` -> `shrink-0` (10 occurrences)

Deprecated alias. `shrink-0` is the v4 canonical name.

```bash
rg -n "flex-shrink-0|flex-shrink" frontend/
```

Known files:

- `frontend/components/Sidebar.tsx` (8)
- `frontend/components/LibraryView.tsx`
- `frontend/app/projects/page.tsx`

### 6c. `placeholder-{color}` -> `placeholder:text-{color}` (5 occurrences)

Tailwind v4 uses variant syntax instead of the shorthand placeholder color form.

```bash
rg -n "placeholder-" frontend/
```

Known files:

- `frontend/components/ContextualHeader.tsx`
- `frontend/components/CaptureModal/CaptureDetails.tsx`
- `frontend/components/CaptureModal/KeyTermsInput.tsx`
- `frontend/components/FindReplaceModal.tsx` (2)

### 6d. `outline-none` -> `outline-hidden` (10 occurrences across 9 files)

This affects both `focus:outline-none` and `focus-visible:outline-none`.

```bash
rg -n "outline-none" frontend/
```

Known files:

- `frontend/components/SpeakerPopover.tsx`
- `frontend/components/Sidebar.tsx`
- `frontend/components/ContextualHeader.tsx`
- `frontend/app/editor/[id]/components/TranscriptSegmentCard.tsx`
- `frontend/app/editor/[id]/components/EditorHeader.tsx`
- `frontend/components/AudioPlayer.tsx`
- `frontend/components/FindReplaceModal.tsx` (2)
- `frontend/components/CaptureModal/CaptureDetails.tsx`
- `frontend/components/CaptureModal/KeyTermsInput.tsx`

### 6e. `backdrop-blur-sm` -> `backdrop-blur-xs` (5 occurrences)

Tailwind v4 shifted the blur scale the same way it shifted shadows.

```bash
rg -n "backdrop-blur-sm" frontend/
```

Known files:

- `frontend/components/ContextualHeader.tsx` (2)
- `frontend/components/ExportModal.tsx`
- `frontend/components/CaptureModal/CaptureModal.tsx`
- `frontend/components/FindReplaceModal.tsx`

### 6f. `rounded-sm` -> `rounded-xs` (4 occurrences)

Tailwind v4 shifted the rounding scale, and v3's `rounded-sm` maps to v4's `rounded-xs`.

```bash
rg -n "rounded-sm" frontend/
```

Known files:

- `frontend/components/Sidebar.tsx`
- `frontend/components/ContextualHeader.tsx`
- `frontend/app/auth/page.tsx`
- `frontend/app/editor/[id]/components/TranscriptSegmentCard.tsx`

### Renamed utility summary

- `shadow-sm` -> `shadow-xs` (8)
- `flex-shrink-0` -> `shrink-0` (10)
- `placeholder-{color}` -> `placeholder:text-{color}` (5)
- `outline-none` -> `outline-hidden` (10)
- `backdrop-blur-sm` -> `backdrop-blur-xs` (5)
- `rounded-sm` -> `rounded-xs` (4)
- Total expected rename touches: 42

---

## Step 7: Update `package.json`

Final `devDependencies` target:

- `tailwindcss`: `4.2.2`
- `@tailwindcss/postcss`: `4.2.2`
- Remove `autoprefixer`
- Keep `postcss` at `8.5.8`

`package-lock.json` will be regenerated by `npm install`.

---

## Step 8: Build, test, and visual QA

```bash
cd frontend
npm run build
npm test
npm run dev
```

Expected test baseline:

- `295` tests
- `26` suites

Note: `npm run build` may fail in environments without network access because Next.js 16 fetches Google Fonts at build time from `frontend/app/layout.tsx`. That is a network issue, not a Tailwind issue.

### Visual QA checklist

- Editor: serif headings, mono timestamps, segment highlights, active states
- Library: card shadows, hover lift, dark mode cards using `night-surface` and `night-border`
- Modals: `ExportModal`, `FindReplaceModal`, `CaptureModal` backdrop blur and borders
- Dark mode toggle: `.dark` class behavior and all CSS variables
- `FloatingPlayerDeck`: `shadow-float` and trust-blue play button
- Sidebar: nav items, active state, user avatar section
- Auth page: brand logo rendering

### Things that should not break

- Opacity modifiers such as `text-ink/50` and `bg-trust-blue/10`
- Arbitrary values such as `text-[10px]` and `bg-[#F2EFED]`
- The editor test checking `bg-trust-blue/10` because it asserts the JSX string, not rendered CSS
- Custom CSS helpers such as `.bg-surface` and `.border-base`
- `:root` and `.dark` CSS variables

---

## Files expected to change

Modified files:

- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/postcss.config.js`
- `frontend/app/globals.css`
- `frontend/app/layout.tsx`
- `frontend/app/auth/page.tsx`
- `frontend/app/projects/page.tsx`
- `frontend/components/Sidebar.tsx`
- `frontend/components/ContextualHeader.tsx`
- `frontend/components/LibraryView.tsx`
- `frontend/components/FloatingPlayerDeck.tsx`
- `frontend/components/ExportModal.tsx`
- `frontend/components/FindReplaceModal.tsx`
- `frontend/components/AudioPlayer.tsx`
- `frontend/components/SpeakerPopover.tsx`
- `frontend/components/CaptureModal/CaptureModal.tsx`
- `frontend/components/CaptureModal/CaptureFooter.tsx`
- `frontend/components/CaptureModal/CaptureDetails.tsx`
- `frontend/components/CaptureModal/KeyTermsInput.tsx`
- `frontend/app/editor/[id]/components/TranscriptSegmentCard.tsx`
- `frontend/app/editor/[id]/components/EditorHeader.tsx`

Deleted file:

- `frontend/tailwind.config.ts`

---

## Validation notes

Referenced paths verified in the repo:

- `frontend/app/globals.css`
- `frontend/app/layout.tsx`
- `frontend/postcss.config.js`
- `frontend/tailwind.config.ts`

This standalone document is intended to be the canonical write-up for the Tailwind v4 migration phase, while leaving the master upgrade plan unchanged unless a later sync is requested.
