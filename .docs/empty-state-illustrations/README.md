# Empty-state illustrations

Line drawings for the three large empty states, made as [Hairline](https://lucasmarkes.com/lab/hairline) figures: isometric line art that reacts gently to the pointer. The app shows them through `components/EmptyState.tsx` on the Library, Transcripts, Projects (including Unfiled and an empty project) and People pages.

| Empty state | Drawing | Heading (from the reference) |
| --- | --- | --- |
| Projects | Card drawer: a filing drawer of blank tabbed cards | Room for a project |
| Transcripts | Typewriter with a blank sheet rolled in | A page waiting for a voice |
| People | Rolodex of blank cards | Room for familiar voices |

## Files

The sources live in the app, in `frontend/lib/hairline/`:

- `figures/*.js`: one figure each. A figure defines `mount({ stage, svg, read }, value)` and exports `{ name, means, range, tour, mount }`.
- `kernel.js`: the Hairline engine. It is vendored from `@lucasmarkes/hairline` (MIT, `LICENSE` beside it), unchanged apart from a default export. The npm package only ships its own figures, not these drawing primitives.
- `index.js`: `mountFigure(name, host)`, which `EmptyState` loads in the browser. It returns the controls the page drives the figure with: `point`, `preview`, `release`, `arrive` and `destroy`. The preview and entrance points live there too. Each figure's `follow(u, v)` maps a position to its own parts; the preview and entrance use it.

This folder holds only the preview:

- `preview.template.html`: the styled preview, with the app's paper theme and a night theme.
- `build-preview.mjs`: inlines the app's kernel and figures into the template and writes `preview.html`.

## Preview

```bash
node .docs/empty-state-illustrations/build-preview.mjs
```

Then open `.docs/empty-state-illustrations/preview.html` in a browser. `preview.html` is generated and git-ignored, so edit the template or the figures instead.

## Colour

Each figure draws in five roles, set with CSS custom properties on the `[data-hairline]` element: `--hairline-plate` (fill, which must match the background behind it), `--hairline-edge` (outlines), `--hairline-mid`, `--hairline-lo` (inner creases), `--hairline-hi` (the one highlighted part) and `--hairline-stroke` (line width in px). In the app, `app/globals.css` mixes the lines from the theme's text colour into the page background, which is also the plate, since empty states are never boxed. The preview's fixed paper and night values are in the template.

## Decisions so far

- Motion stays subtle. A hover answer is a small nudge, never a full spin or riffle.
- Over the drawing, the part under the pointer answers: that key, that drawer card. Each hit tests against resting outlines, so a part moving away cannot flicker the choice. The Rolodex is different: the pointer runs through its cards like a finger. The wheel follows how far the pointer travels round the axle, one card at a time, starting still where the pointer lands, so any steady sweep, the bottom half included, flips cards steadily one way. The card under the pointer is the bright one, as drawn at that moment, so cards light up as they pass under it. Off the drawing, and over the drawing where no part is, it rests: only touching the drawing moves it.
- Full-size drawings show a tight crop of their 400 × 320 frame. The figure still draws in the whole frame, on a stage larger than the host, so its hit testing stays exact.
- Each drawing has one highlighted part at rest: the blank sheet, an empty card tab, or the open Rolodex card.
- There is no text or stray mark inside a drawing. Labels belong in the heading under it.
