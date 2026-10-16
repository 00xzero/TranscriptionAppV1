/**
 * Drawer: a card-file drawer pulled out, eight blank tabbed cards standing in
 * it with nothing written on any of them. The card under the pointer rises a
 * little and straightens; its neighbours lean a few degrees away, staggered
 * outwards from it. At rest one card stands nearly upright, and its
 * empty tab is the bright mark. The slider is how far the chosen card lifts;
 * the others lean away by a few degrees in proportion, so the answer stays small.
 *
 * The pattern: discrete items, after Riffle. Tweens, a stagger by distance,
 * and a hit test on static bands along the resting top edges.
 */
import HL from "../kernel.js";

const {
  Cam, clamp, facing, fillet, fit, hull, open, poly, proj, prism, rad, rings, ringAt, rrect, run, seg,
  tdone, tset, tval, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const N = 8, W = 84, H = 46, G = 15, TW = 24, TH = 9, TABS = [6, 30, 54], TK = 1.4;
const MARK = 3, REST = [-19, -13, -16, -3, -14, -18, -10, -13], LIFT = 12, STAG = 40;
const X0 = -5, X1 = W + 5, Y0 = -10, Y1 = (N - 1) * G + 12, WH = 22, WR = 6, WT = 2.4, FH = WH + 14;

/** Whether screen point q lies inside the polygon pts (even-odd rule). */
function inside(q, pts) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** A run of points ordered left to right on screen. */
const LR = (pts) => (pts[0][0] <= pts[pts.length - 1][0] ? pts : pts.slice().reverse());

/** The drawer, which never moves: `far` is painted before the dividers, `near` after them. */
function tray(P, front, outer, inner) {
  const far = [
    [poly(hull(ringAt(P, outer, 0).concat(ringAt(P, outer, WH)))), "sil"],
    [poly(ringAt(P, inner, WH)), "nf"],
    [open(ringAt(P, run(inner, (q) => !front(q)), 2.5)), "nf lo"],
    // the rod the cards would ride on, bare along the floor
    [seg(P(W / 2, Y0 + 4, 5), P(W / 2, Y1, 5)), "nf lo"],
  ];
  const iF = LR(ringAt(P, run(inner, front), WH)), oT = LR(ringAt(P, run(outer, front), WH)), oB = LR(ringAt(P, run(outer, front), 0));
  const near = [
    [poly([...iF, oT[oT.length - 1], ...oB.slice().reverse(), oT[0]]), "fo"],
    [open(oT), "nf lo"],
    [open(iF), "nf"],
    [open([oT[0], ...oB, oT[oT.length - 1]]), "nf sil"],
  ];
  return { far, near };
}

/** Divider i, back to front: which of three tab positions it takes, and its filleted outline, upright in its own plane. */
function divider(i) {
  const t0 = TABS[i % 3];
  const shape = fillet(
    [[0, 0], [W, 0], [W, H], [t0 + TW, H], [t0 + TW, H + TH], [t0, H + TH], [t0, H], [0, H]],
    [1, 1, 3.2, 1.8, 2.4, 2.4, 1.8, 3.2],
  );
  return { t0, shape };
}

/** Divider i leaning th degrees (negative leans back) and lifted: its paths. The tab holds an empty label window. */
function pose(P, i, t0, shape, th, lift) {
  const yb = i * G, s = Math.sin(rad(th)), c = Math.cos(rad(th));
  const w = (u, v) => P(u, yb + v * s, v * c + lift);
  const wb = (u, v) => P(u, yb + v * s - TK * c, v * c + TK * s + lift);
  const win = rrect(t0 + 4, H + 2.2, t0 + TW - 4, H + TH - 2.2, 1.2, 3).map((q) => w(q.u, q.v));
  return { back: poly(shape.map((p) => wb(p[0], p[1]))), face: poly(shape.map((p) => w(p[0], p[1]))), win: poly(win) };
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let amp = value;

  const C = Cam(45, 0.5, 1.42);
  fit(C, [[X0 - 3, Y0, 0], [X1 + 3, Y1 + 4, -6], [X1 + 3, Y0, 0], [X0 - 3, Y1 + 4, 0], [X0, Y0, H + TH], [X1, Y0, H + TH + LIFT]], 200, 166);
  const P = proj(C), front = facing(C);
  const outer = rrect(X0, Y0, X1, Y1, WR, 6), inner = rrect(X0 + WT, Y0 + WT, X1 - WT, Y1 - WT, WR - WT, 6);
  const paths = tray(P, front, outer, inner);

  const g = mk("g", {}, svg);
  for (const [d, cls] of paths.far) mk("path", { d, class: cls }, g);

  const divs = [];
  for (let i = 0; i < N; i++) {
    const { t0, shape } = divider(i);
    const grp = mk("g", {}, g);
    const back = mk("path", { class: "lo" }, grp), face = mk("path", { class: "sil" }, grp), win = mk("path", { class: "nf lo" }, grp);
    divs.push({ t0, shape, back, face, win, a: tween(REST[i]), z: tween(0) });
  }
  for (const [d, cls] of paths.near) mk("path", { d, class: cls }, g);
  divs[MARK].win.setAttribute("class", "nf hi");

  // The drawer front: a taller panel with an empty label holder, a cup pull below it, and the rod's knob.
  const [fr, fi] = rings(X0 - 3, Y1 - 1, X1 + 3, Y1 + 4, 2.5, 1);
  put(solid(g), prism(P, front, fr, fi, 0, FH));
  const onFront = (ring) => poly(ring.map((q) => P(q.u, Y1 + 4, q.v)));
  const cx = (X0 + X1) / 2;
  mk("path", { d: onFront(rrect(cx - 15, FH - 13, cx + 15, FH - 4, 1.6, 4)), class: "nf" }, g);
  mk("path", { d: onFront(rrect(cx - 13, FH - 11.4, cx + 13, FH - 5.6, 1, 4)), class: "nf lo" }, g);
  const cup = [[cx - 12, 18], [cx + 12, 18], [cx + 9, 12], [cx - 9, 12]];
  mk("path", { d: poly(fillet(cup, [1, 1, 4, 4]).map(([u, v]) => P(u, Y1 + 4, v))), class: "nf" }, g);
  mk("path", { d: onFront(rrect(cx - 2.2, 4, cx + 2.2, 8.4, 2.2, 4)), class: "nf" }, g);

  // hit bands: oblique strips along the RESTING top edges, at the mean rest lean. They never move.
  const RM = REST.reduce((a, b) => a + b, 0) / N;
  const top = (i) => P(W / 2, i * G + H * Math.sin(rad(RM)), H * Math.cos(rad(RM)));
  const c0 = top(0), c1 = top(1), d = [c1[0] - c0[0], c1[1] - c0[1]];
  const px0 = P(0, 0, 0), px1 = P(1, 0, 0), ex = [px1[0] - px0[0], px1[1] - px0[1]];
  const HALF = W / 2 + 6, det = d[0] * ex[1] - d[1] * ex[0];

  // Each card's outline in its rest pose, which never moves, and the drawer front.
  const restCards = divs.map((dv, i) => dv.shape.map(([u, v]) => P(u, i * G + v * Math.sin(rad(REST[i])), v * Math.cos(rad(REST[i])))));
  const frontPanel = [[X0 - 3, 0], [X1 + 3, 0], [X1 + 3, FH], [X0 - 3, FH]].map(([u, v]) => P(u, Y1 + 4, v));

  /** The card the pointer is over: the front-most whose resting outline holds it, the front card over the drawer front, else the nearest along the stack. */
  function hit(q) {
    for (let i = N - 1; i >= 0; i--) if (inside(q, restCards[i])) return i;
    if (inside(q, frontPanel)) return N - 1;
    const qx = q[0] - c0[0], qy = q[1] - c0[1];
    const s = (qx * ex[1] - qy * ex[0]) / det, r = (d[0] * qy - d[1] * qx) / det;
    if (Math.abs(r) > HALF || s < -0.6 || s > N - 0.4) return -1;
    return clamp(Math.round(s), 0, N - 1);
  }

  function draw(i, th, lift) {
    const dv = divs[i], q = pose(P, i, dv.t0, dv.shape, th, lift);
    dv.back.setAttribute("d", q.back);
    dv.face.setAttribute("d", q.face);
    dv.win.setAttribute("d", q.win);
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    divs.forEach((dv, i) => { draw(i, tval(dv.a, now), tval(dv.z, now)); if (!tdone(dv.a, now) || !tdone(dv.z, now)) moving = true; });
    return moving;
  });
  bag.add(B.unregister);

  let act = -1;
  function setActive(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act;
    act = a;
    divs.forEach((dv, i) => {
      const delay = Math.abs(i - from) * STAG;
      // a nudge, not a riffle: the chosen card straightens a little and rises; its neighbours lean away a few degrees
      const th = a < 0 ? REST[i] : i === a ? REST[i] * (1 - amp / 16) : REST[i] + (i < a ? -1 : 1) * amp;
      tset(dv.a, th, now, delay); tset(dv.z, a === i ? amp : 0, now, delay);
      const lit = a < 0 ? i === MARK : i === a;
      dv.face.classList.toggle("hi", i === a); dv.win.classList.toggle("hi", lit); dv.win.classList.toggle("lo", !lit);
    });
    read.textContent = a < 0 ? "rest" : `tab ${a + 1} · empty`;
    B.wake();
  }

  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));

  /**
   * An area around the figure drives it on both axes. The cards stand along
   * the down-left diagonal, front card lowest, so moving left or down walks
   * towards the front and right or up towards the back. Down weighs more
   * than across, so a sweep along a card's own width still walks the cards.
   */
  function follow(u, v) {
    const t = clamp(0.5 + 1.0 * (0.5 - u) + 1.4 * (v - 0.5), 0, 1);
    setActive(Math.round(t * (N - 1)));
  }
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { amp = v; if (act >= 0) { const a = act; act = -1; setActive(a); } },
    follow,
    /** A pointer at viewBox point q over the drawing: the card under it rises; over no card, rest. */
    point: (q) => setActive(hit(q)),
    rest: () => setActive(-1),
    destroy: bag.dispose,
  };
}

const figure = {
  name: "drawer",
  means: "A card drawer of blank tabbed cards: the one under the pointer rises a little, and its neighbours lean away from it.",
  rules: [1, 2, 5, 8],
  range: [4, 8, 12],
  tour: [[150, 120], [230, 150], null],
  mount,
};

export default figure;
