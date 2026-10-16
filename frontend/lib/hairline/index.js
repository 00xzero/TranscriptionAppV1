/**
 * The app's Hairline figures: line drawings for empty states that answer the
 * pointer. mountFigure draws one into a host element and returns the controls
 * the page drives it with. Browser only: the kernel needs requestAnimationFrame,
 * IntersectionObserver and matchMedia, so callers load this module from an effect.
 */
import HL from "./kernel.js";
import drawer from "./figures/drawer.js";
import rolodex from "./figures/rolodex.js";
import typewriter from "./figures/typewriter.js";

const FIGURES = { drawer, rolodex, typewriter };

/**
 * Two positions for each figure's follow(u, v), as fractions across and down:
 * what the action previews, and where the entrance reaches before settling.
 */
const GUIDES = {
  typewriter: { preview: [0.5, 0.5], arrive: [0.95, 0.4] },
  drawer: { preview: [0.38, 0.62], arrive: [0.62, 0.4] },
  rolodex: { preview: [0.62, 0.55], arrive: [1, 0.8] },
};

const ARRIVE_HOLD_MS = 600;

/**
 * Each figure draws into a 400 × 320 frame with wide margins. The tight crop is
 * what the figure covers in every pose, at the widest answer the slider allows,
 * plus room for the stroke, as [x, y, width, height] at 5:4 like the host.
 */
const TIGHT = {
  typewriter: [52, 49, 301, 241],
  drawer: [79, 59, 250, 200],
  rolodex: [53, 49, 296, 237],
};

/**
 * The figure always draws into its whole 400 × 320 frame, because its own hit
 * testing reads pointer positions in that frame. A tight figure's frame is a
 * stage larger than the host, placed so the crop fills the host exactly.
 */
function stageFor(name, host, tight) {
  if (!tight) return host;
  const [x, y, w, h] = TIGHT[name];
  const stage = host.ownerDocument.createElement("div");
  stage.dataset.hairline = name;
  Object.assign(stage.style, {
    position: "absolute",
    left: `${(-x / w) * 100}%`,
    top: `${(-y / h) * 100}%`,
    width: `${(400 / w) * 100}%`,
    height: `${(320 / h) * 100}%`,
  });
  host.appendChild(stage);
  return stage;
}

export function mountFigure(name, host, { tight = false } = {}) {
  const figure = FIGURES[name];
  const guide = GUIDES[name];
  HL.inject(host.ownerDocument);
  const stage = stageFor(name, host, tight);
  const svg = HL.mk("svg", { viewBox: "0 0 400 320", "aria-hidden": "true" }, stage);
  // The figure's caption of what it has picked, kept on the host for tests and debugging.
  const read = { set textContent(text) { host.dataset.read = text; } };
  // The middle of each figure's range: its default, deliberately gentle answer.
  const handle = figure.mount({ stage, svg, read }, figure.range[1]);

  let arriving = 0;
  const stopArriving = () => {
    window.clearTimeout(arriving);
    arriving = 0;
  };

  return {
    /**
     * A pointer over the drawing itself, in client coordinates. The figure hit
     * tests it against its own parts, so the key or card under it answers; over
     * no part, the figure rests.
     */
    point(clientX, clientY) {
      stopArriving();
      const r = stage.getBoundingClientRect();
      handle.point([((clientX - r.left) / r.width) * 400, ((clientY - r.top) / r.height) * 320]);
    },
    /** The figure's answer to the empty state's action. */
    preview() {
      stopArriving();
      handle.follow(...guide.preview);
    },
    /** Back to rest. */
    release() {
      stopArriving();
      handle.rest();
    },
    /** One reach and back, as the page opens. Skipped when the reader asks for less motion. */
    arrive() {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      handle.follow(...guide.arrive);
      stopArriving();
      arriving = window.setTimeout(() => {
        arriving = 0;
        handle.rest();
      }, ARRIVE_HOLD_MS);
    },
    destroy() {
      stopArriving();
      handle.destroy();
      svg.remove();
      if (stage !== host) stage.remove();
    },
  };
}
