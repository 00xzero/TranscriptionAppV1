/**
 * Typewriter: a portable typewriter with a blank sheet rolled in. Sweep the
 * pointer across it and the carriage slides to that column on a spring, while
 * the key under the pointer goes down. At rest the carriage is pushed home to
 * the left margin, hanging out to the right, and the blank sheet is the bright
 * mark: the page nothing has been typed on. The slider is the carriage's travel.
 *
 * The pattern: a continuous position (the carriage, a spring) with a discrete
 * pick (the key, a tween). Keys are hit on their own row's rest height.
 */
import HL from "../kernel.js";

const {
  Cam, clamp, facing, fillet, fit, hull, lerp, open, poly, proj, prism, rad, ringAt, rrect, circ, run, spring, stepS,
  tdone, tset, tval, tween, unproj, mk, pointer, put, register, disposer, solid,
} = HL;

const PX = 60, PW = 70, PZ = 48, PH = 54, TILT = 13, PR = 7, PY = 12, PZC = 45, DECK = 12, PRESS = 3.2;
const CURL = 14, CORNER = 2.4, BOW = 1.2, SWAY = 0.045;

/** The sheet's spine as it rises out of the platen: it leaves at TILT and curls back further towards the top, as paper does. */
const SPINE = (() => {
  const out = [[PY - 5, PZ]];
  for (let w = 1; w <= PH; w++) {
    const th = rad(TILT + CURL * (w / PH) ** 2), [y, z] = out[w - 1];
    out.push([y - Math.sin(th), z + Math.cos(th)]);
  }
  return out;
})();

/** A point on the sheet: u across it (-1 to 1), w up it. The corners curl back, the middle bows forward a touch, and the top lags the carriage. */
function onSheet(P, xm, u, w, lag) {
  const h = w / PH, [y, z] = SPINE[Math.round(w)];
  const back = CORNER * u * u * h * h - BOW * (1 - u * u) * h;
  return P(xm + u * (PW / 2) + lag * h * h, y - back, z - back * 0.3);
}
const ROWS = [{ y: 56, top: 25, n: 8 }, { y: 68, top: 21.5, n: 8 }, { y: 80, top: 18, n: 7 }];

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

const at = (ring, x, y) => ring.map((q) => ({ u: q.u + x, v: q.v + y, nu: q.nu, nv: q.nv }));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let T = value;

  const C = Cam(45, 0.5, 1.42);
  fit(C, [[0, 0, 0], [120, 96, 0], [0, 96, 0], [-26 - 40, 10, 62], [136 + 40, 12, 38], [PX - PW / 2 - 40, PY - 18, PZ + PH], [PX + PW / 2 + 40, PY - 18, PZ + PH]], 200, 168);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);

  // The machine, which never moves: a soft shell, the hood over the type, two ribbon spools on it.
  put(solid(g), taper(P, front, rrect(0, 0, 120, 96, 22, 8), rrect(4, 4, 116, 92, 18, 8), rrect(6, 6, 114, 90, 16, 8), 0, DECK));
  put(solid(g), taper(P, front, rrect(4, 0, 116, 48, 16, 8), rrect(12, 5, 108, 40, 9, 8), rrect(14, 7, 106, 38, 7, 8), DECK, 34));
  for (const x of [30, 90]) {
    put(solid(g), prism(P, front, at(circ(7.5, 32), x, 31), at(circ(6, 32), x, 31), 34, 36));
    put(solid(g), prism(P, front, at(circ(2.4, 16), x, 31), null, 36, 37.4));
  }

  // The carriage, which slides: a rail, the sheet, the platen, the bail and its rollers, two knurled knobs, the lever.
  const rail = solid(g), sheet = mk("path", { class: "sil hi" }, g), plat = solid(g);
  const bail = solid(g), rollL = solid(g), rollR = solid(g), hubL = solid(g), knobL = solid(g), hubR = solid(g), knobR = solid(g);
  const lever = mk("path", { class: "sil" }, g);


  // Three stepped rows of round keys on stems, back to front, then the space bar.
  const keys = [];
  ROWS.forEach((row, r) => {
    for (let k = 0; k < row.n; k++) {
      const x = PX + (k - (row.n - 1) / 2) * 12.5 + (r === 1 ? 3 : 0);
      keys.push({ r, x, y: row.y, top: row.top, stem: solid(g), cap: solid(g), tw: tween(0), drawn: NaN });
    }
  });
  put(solid(g), prism(P, front, rrect(30, 87, 90, 92, 2.5, 4), rrect(31, 88, 89, 91, 1.5, 4), DECK, DECK + 4));

  function drawKey(kk, dz) {
    if (dz === kk.drawn) return;
    kk.drawn = dz;
    const z1 = kk.top + dz;
    put(kk.stem, prism(P, front, at(circ(1.3, 12), kk.x, kk.y), null, DECK, z1 - 2.4));
    put(kk.cap, prism(P, front, at(circ(4.6, 24), kk.x, kk.y), at(circ(3.5, 24), kk.x, kk.y), z1 - 2.4, z1));
  }

  const sp = spring(T, { eps: 0.05 });
  let drawn = NaN;
  function drawCarriage(o, v) {
    if (o === drawn) return;
    drawn = o;
    put(rail, prism(P, front, rrect(-14 + o, 2, 134 + o, 22, 6, 6), rrect(-12 + o, 4, 132 + o, 20, 4, 6), 34, 37));
    const x0 = PX - PW / 2 + o, x1 = PX + PW / 2 + o;
    // paper, not card: sampled round its edge so it can bend, with the top trailing the carriage a little
    const lag = clamp(-v * SWAY, -4, 4), xm = PX + o, edge = [], radii = [];
    const side = (pts, r0) => pts.forEach(([u, w], i) => { edge.push(onSheet(P, xm, u, w, lag)); radii.push(i === 0 ? r0 : 0); });
    side([...Array(8).keys()].map((i) => [-1 + (2 * i) / 8, 0]), 0.8);
    side([...Array(12).keys()].map((i) => [1, (PH * i) / 12]), 0.8);
    side([...Array(10).keys()].map((i) => [1 - (2 * i) / 10, PH]), 2.4);
    side([...Array(12).keys()].map((i) => [-1, PH - (PH * i) / 12]), 2.4);
    sheet.setAttribute("d", poly(fillet(edge, radii)));
    put(plat, cyl(P, -6 + o, 126 + o, PY, PZC, PR));
    const by = SPINE[7][0] + BOW * 7 / PH + 2.6, bz = SPINE[7][1];
    put(bail, cyl(P, x0 - 6, x1 + 6, by, bz, 0.9));
    put(rollL, cyl(P, x0 + 9, x0 + 15, by, bz, 2.3));
    put(rollR, cyl(P, x1 - 15, x1 - 9, by, bz, 2.3));
    put(knobL, cyl(P, -17 + o, -10 + o, PY, PZC, 7.5, 5));
    put(hubL, cyl(P, -10 + o, -6 + o, PY, PZC, 4));
    put(hubR, cyl(P, 126 + o, 130 + o, PY, PZC, 4));
    put(knobR, cyl(P, 130 + o, 137 + o, PY, PZC, 7.5, 5));
    // the return lever: a flat bar off the left end, bent up and out towards the typist
    const line = [P(-8 + o, PY + 4, 50), P(-14 + o, PY + 14, 60), P(-18 + o, PY + 30, 63)];
    const up = line.map(([x, y]) => [x, y - 2.2]), dn = line.map(([x, y]) => [x, y + 2.2]);
    lever.setAttribute("d", poly(fillet([...up, ...dn.reverse()], [1, 2, 1.5, 1.5, 2, 1])));
  }
  // paint order for the carriage's own parts: the lever behind the left knob
  knobL.g.before(lever);

  const B = register(stage, (dt, now) => {
    let m = stepS(sp, dt);
    drawCarriage(sp.x, sp.v);
    for (const kk of keys) { drawKey(kk, tval(kk.tw, now)); if (!tdone(kk.tw, now)) m = true; }
    return m;
  });
  bag.add(B.unregister);

  /** The key under the pointer: each row is tested on its own rest height, so a key going down cannot drop out from under it. */
  function keyAt(sx, sy2) {
    // the nearest key, out to half the diagonal between keys, so the keyboard has no gaps
    let best = -1, bd = 9.5;
    keys.forEach((kk, i) => {
      const [x, y] = unproj(C, sx, sy2, kk.top), d = Math.hypot(x - kk.x, y - kk.y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  /** Sets the carriage to column t (0 to 1, or null for home) and presses key act (-1 for none). */
  function apply(t, act) {
    const now = performance.now();
    keys.forEach((kk, i) => { tset(kk.tw, i === act ? -PRESS : 0, now, 0); kk.cap.sil.classList.toggle("hi", i === act); });
    // the blank sheet keeps the bright only while no key has it
    sheet.classList.toggle("hi", act < 0);
    if (t === null) { sp.t = T; read.textContent = "rest"; }
    else {
      sp.t = lerp(T, -T, t);
      read.textContent = `col ${Math.round(t * 59) + 1}${act < 0 ? "" : ` · key ${act + 1}`}`;
    }
    B.wake();
  }

  let over = null, again = () => apply(null, -1);
  function retarget(p) {
    apply(over ? clamp((over[0] - 6) / 108, 0, 1) : null, p ? keyAt(p[0], p[1]) : -1);
  }

  /**
   * An area around the figure drives it on both axes, as if typing: across
   * moves the carriage and picks the key in that column, down picks the row,
   * and down nudges the carriage a little too, so no direction is dead.
   */
  const ROW_START = ROWS.map((_, r) => ROWS.slice(0, r).reduce((n, row) => n + row.n, 0));
  function follow(u, v) {
    const t = clamp(u + (v - 0.5) * 0.3, 0, 1);
    const r = clamp(Math.floor(clamp(v, 0, 0.999) * ROWS.length), 0, ROWS.length - 1);
    apply(t, ROW_START[r] + Math.round(clamp(u, 0, 1) * (ROWS[r].n - 1)));
    again = () => follow(u, v);
  }

  // the whole machine, sheet included (it stands high, so it reads far back on this plane)
  const onMachine = (p) => { const w = unproj(C, p[0], p[1], 20); return w[0] > -60 && w[0] < 180 && w[1] > -170 && w[1] < 130 ? w : null; };

  /** A pointer at viewBox point p over the drawing: the key under it goes down, and the carriage follows. Off the machine, rest. */
  function point(p) {
    over = onMachine(p);
    if (!over) return rest();
    last = p;
    retarget(last);
    again = () => retarget(last);
  }

  function rest() { over = null; last = null; apply(null, -1); again = () => apply(null, -1); }

  let last = null;
  bag.add(pointer(stage, {
    move: (p) => {
      over = onMachine(p);
      last = over ? p : null;
      retarget(last);
      again = () => retarget(last);
    },
    leave: () => { over = null; last = null; retarget(null); again = () => apply(null, -1); },
  }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { T = v; again(); },
    follow,
    point,
    rest,
    destroy: bag.dispose,
  };
}

const figure = {
  name: "typewriter",
  means: "A typewriter with a blank sheet: sweep across it and the carriage follows, a key goes down, and nothing is typed yet.",
  rules: [1, 3, 5, 8],
  range: [10, 18, 26],
  tour: [[150, 200], [205, 225], [250, 245], null],
  mount,
};

export default figure;
