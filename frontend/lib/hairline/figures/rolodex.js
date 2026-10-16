/**
 * Rolodex: a rotary card file on its stand, thirty blank cards round the
 * axle. The cards part at the top where the file falls open, and the card
 * standing in that gap is the one you would read: it has no name on it. The
 * pointer runs through the cards like a finger: its angle round the axle
 * turns the wheel, a card at a time, and the file opens a touch wider while
 * a hand is on it. The slider is the gap.
 *
 * The pattern: scrub with detents. A soft spring on the wheel's angle, a
 * static mapping from the pointer to a card, and paint order kept by moving groups.
 */
import HL from "../kernel.js";

const {
  Cam, clamp, facing, fillet, fit, hull, open, poly, proj, rad, ringAt, rrect, run, spring, stepS,
  disposer, mk, pointer, put, register, solid,
} = HL;

const N = 30, STEP = (Math.PI * 2) / N, ZA = 54, R0 = 9, R1 = 42, HW = 31, TK = 1.1, A0 = rad(-10), TAB = 5, TABW = 10;
const CAM = [0.612, 0.612, 0.5];

/** A solid whose top ring is smaller than its foot: the hull of both, and one crease. */
function taper(P, front, foot, top, inner, z0, z1) {
  return { sil: poly(hull(ringAt(P, foot, z0).concat(ringAt(P, top, z1)))), crease: open(ringAt(P, run(inner, front), z1)) };
}

/** A cylinder lying along x: the hull of its two end circles, and the near end (x1) as the crease. */
function cyl(P, x0, x1, y, z, R, rim) {
  const end = (x, r) => { const out = []; for (let k = 0; k < 28; k++) { const a = (k / 28) * Math.PI * 2; out.push(P(x, y + r * Math.cos(a), z + r * Math.sin(a))); } return out; };
  const near = end(x1, R);
  return { sil: poly(hull(end(x0, R).concat(near))), crease: poly(near) + (rim ? poly(end(x1, rim)) : "") };
}

/** Card i's outline in its own plane: u across, v out from the axle, with the slot that grips the rails.
 *  Every fifth card is a guide card, its index tab a step further along than the last one's. */
function card(i) {
  const pts = [[-HW, R0], [-7, R0], [-5, R0 + 4], [5, R0 + 4], [7, R0], [HW, R0], [HW, R1]];
  const radii = [1.5, 0.8, 1, 1, 0.8, 1.5, 3];
  if (i % 5 === 0) {
    const t = -HW + 4 + (i / 5) * 9.4;
    pts.push([t + TABW, R1], [t + TABW, R1 + TAB], [t, R1 + TAB], [t, R1]);
    radii.push(1, 1.6, 1.6, 1);
  }
  pts.push([-HW, R1]); radii.push(3);
  return fillet(pts, radii);
}

/** A side bracket: a plate in the y–z plane at x, rising from the base to a round boss at the axle. */
const BRACKET = fillet([[-24, 7], [24, 7], [10, ZA + 4], [-10, ZA + 4]], [2, 2, 9, 9]);

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Whether screen point q lies inside the polygon pts (even-odd rule). */
function inside(q, pts) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}


/** How much wider the file falls open while a hand is on it. */
const HOVER_GAP = 1.2;

/**
 * A finger running through the cards: degrees the pointer travels round the
 * axle, as seen, for each card the wheel turns. Across the whole visible fan
 * that is about four cards either way.
 */
const DEG_PER_CARD = 26;

/** How far past a detent the pointer must go before the next card clicks over, in cards: no flicker on a boundary. */
const DETENT = 0.6;

/** The most cards the wheel turns from home either way, however far the pointer circles. */
const MAX_TURN = 8;

/**
 * The wheel's springs: softer and more damped than the default (k 100, c 18), so
 * cards turn past at a readable pace instead of snapping. c ≈ 2√k: no overshoot.
 */
const WHEEL = { k: 45, c: 13.4, eps: 0.0005 };

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let gap = rad(value);
  // the gap opens wider while a hand is on the file
  const sg = spring(gap, WHEEL);

  const C = Cam(45, 0.5, 1.78);
  fit(C, [[-50, -48, 0], [50, 48, 0], [50, -48, 0], [-50, 48, 0], [-32, -20, ZA + R1 + TAB + 4], [32, 20, ZA + R1 + TAB + 4]], 200, 166);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);

  const plate = (x, cls) => mk("path", { d: poly(BRACKET.map(([y, z]) => P(x, y, z))), class: cls }, g);

  // Back to front: the base, the far bracket and knob, the axle, the cards, the near bracket and knob.
  put(solid(g), taper(P, front, rrect(-50, -32, 50, 32, 12, 6), rrect(-47, -29, 47, 29, 10, 6), rrect(-45, -27, 45, 27, 8, 6), 0, 7));
  put(solid(g), cyl(P, -50, -42, 0, ZA, 7.5, 5));
  plate(-42, "lo"); plate(-39, "sil");
  put(solid(g), cyl(P, -39, 39, 0, ZA, 2.2));
  const deck = mk("g", {}, g);
  plate(39, "lo"); plate(42, "sil");
  put(solid(g), cyl(P, 42, 44, 0, ZA, 4.5));
  put(solid(g), cyl(P, 44, 51, 0, ZA, 7.5, 5));

  const cards = [];
  for (let i = 0; i < N; i++) {
    const grp = mk("g", {}, deck);
    cards.push({ i, shape: card(i), grp, back: mk("path", { class: "lo" }, grp), face: mk("path", { class: "sil" }, grp), depth: 0 });
  }

  /** Where card i stands when the wheel is at th: its angle from upright, pushed apart round the open gap. */
  function angle(i, th, g = sg.x) {
    const rel = wrap(i * STEP + th);
    // the cards in front of the open one fall further towards the reader than the ones behind lean back
    const push = g * Math.tanh(rel / (STEP * 0.9));
    return A0 + rel + (push > 0 ? push * 2.2 : push);
  }

  function draw(th) {
    for (const cd of cards) {
      const a = angle(cd.i, th), s = Math.sin(a), c = Math.cos(a);
      const n = [0, c, -s], toward = n[1] * CAM[1] + n[2] * CAM[2] >= 0 ? 1 : -1;
      const at = (u, v, o) => P(u, v * s + n[1] * o, ZA + v * c + n[2] * o);
      cd.pts = cd.shape.map(([u, v]) => at(u, v, 0));
      cd.face.setAttribute("d", poly(cd.pts));
      cd.back.setAttribute("d", poly(cd.shape.map(([u, v]) => at(u, v, -toward * TK))));
      const rm = (R0 + R1) / 2;
      cd.depth = rm * s * CAM[1] + rm * c * CAM[2];
    }
    // keep paint order: farthest card first, by moving groups, never redrawing them
    cards.slice().sort((a, b) => a.depth - b.depth).forEach((cd) => deck.appendChild(cd.grp));
    relight();
  }

  /**
   * One card is bright: the one under the pointer, where it is drawn right now,
   * so cards light up as they pass under a pointer that is still; off the cards,
   * or with no pointer, the open card. Only the highlight follows the drawn
   * pose; what the wheel does never reads it.
   */
  let pointerQ = null, openN = 0, lit = -1;
  function relight() {
    let target = openN;
    if (pointerQ) {
      const over = cards.slice().sort((a, b) => b.depth - a.depth).find((cd) => cd.pts && inside(pointerQ, cd.pts));
      if (over) target = over.i;
    }
    if (target === lit) return;
    lit = target;
    cards.forEach((cd) => cd.face.classList.toggle("hi", cd.i === target));
  }

  const sp = spring(0, WHEEL);
  let drawn = NaN;
  const B = register(stage, (dt) => {
    const a = stepS(sp, dt), b = stepS(sg, dt), m = a || b;
    const key = sp.x + sg.x * 1000;
    if (key !== drawn) { drawn = key; draw(sp.x); }
    return m;
  });
  bag.add(B.unregister);

  function choose(idx, label) {
    const n = ((idx % N) + N) % N;
    sp.t = -idx * STEP;
    sg.t = label ? gap * HOVER_GAP : gap;
    openN = n;
    relight();
    read.textContent = label ? `card ${String(n + 1).padStart(2, "0")} · no name` : "rest";
    B.wake();
  }
  choose(0, false);

  /**
   * The finger runs through the cards. The pointer's angle round the axle, as
   * seen on screen, turns the wheel in proportion, clicking over one card at a
   * time, so a steady sweep flips cards steadily one way and never back. The
   * axle's place never moves, whatever the wheel is doing. Over the hub, where
   * the angle means nothing, the wheel holds still.
   */
  const hub = P(0, 0, ZA), top = P(0, 0, ZA + R0 + 6), HUB_R = Math.hypot(top[0] - hub[0], top[1] - hub[1]);
  // The wheel follows how far the pointer travels round the axle, like a finger
  // on it: it starts still where the pointer first lands, then adds each step's
  // angle, so a sweep under the axle keeps turning the same way instead of
  // jumping from one side to the other.
  let turn = 0, travelled = 0, lastDeg = null;
  function scrub(q) {
    const fresh = pointerQ === null;
    pointerQ = q;
    const dx = q[0] - hub[0], dy = q[1] - hub[1];
    // Over the hub the angle means nothing: hold, and pick up again from wherever the pointer leaves it.
    if (Math.hypot(dx, dy) < HUB_R) { lastDeg = null; return relight(); }
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    // landing on the drawing never spins it: travel counts from where the pointer arrives
    if (fresh) travelled = 0;
    else if (lastDeg !== null) travelled += ((deg - lastDeg + 540) % 360) - 180;
    lastDeg = deg;
    travelled = clamp(travelled, -MAX_TURN * DEG_PER_CARD, MAX_TURN * DEG_PER_CARD);
    const cont = travelled / DEG_PER_CARD;
    if (Math.abs(cont - turn) > DETENT) turn = Math.round(cont);
    choose(turn, true);
  }
  const home = () => { pointerQ = null; lastDeg = null; travelled = 0; turn = 0; choose(0, false); };

  bag.add(pointer(stage, { move: scrub, leave: home }));
  bag.add(() => svg.replaceChildren());

  /** A position (u, v), each 0 to 1, for the button preview and the entrance: across turns the wheel a few cards. */
  function follow(u, v) {
    pointerQ = null;
    turn = clamp(Math.round((clamp(u, 0, 1) - 0.5) * 6 + (clamp(v, 0, 1) - 0.5) * 2), -3, 3);
    choose(turn, true);
  }

  return {
    set: (v) => { const on = sg.t !== gap; gap = rad(v); sg.t = on ? gap * HOVER_GAP : gap; B.wake(); },
    follow,
    /** A pointer at viewBox point q over the drawing: the wheel turns with the pointer's angle round the axle. */
    point: scrub,
    rest: home,
    destroy: bag.dispose,
  };
}

const figure = {
  name: "rolodex",
  means: "A rotary card file of blank cards: the pointer runs through them like a finger, and each card that falls open has no name on it.",
  rules: [1, 4, 5, 6],
  range: [12, 16, 20],
  tour: [[150, 160], [250, 160], null],
  mount,
};

export default figure;
