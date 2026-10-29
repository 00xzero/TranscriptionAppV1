/**
 * Isometric sheet: a square grid of paper seen in true isometric (the ground
 * axes at 120° to each other and to the vertical), filling its whole card.
 * The sheet is a height field. At rest it holds two low swells; under the
 * pointer it rises in a round hill with a shallow trough around it, the same
 * in every direction, and the hill follows the pointer on a spring.
 *
 * Cells are painted back to front, each filled with the paper colour and then
 * outlined, so a rise hides the lines behind it. Every fourth line is a major
 * line, as on graph paper; lines brighten with height, so the hill reads
 * without shading. The pointer is read on the flat ground plane, which never
 * moves, so the hill cannot chase itself. It draws only while something moves,
 * at most once a frame: resizes and theme changes join the same frame.
 */

const COS30 = Math.cos(Math.PI / 6)
const SIN30 = 0.5

export const CELL = 34
const MAJOR = 4
/** How high the hill stands at its centre, in px. */
export const LIFT = 2.4 * CELL
/** The hill's radius on the ground, in px. */
export const RADIUS = 3.6 * CELL
const SHADES = 8

type Point = readonly [number, number]

/** Where ground point (x, y) at height h lands on screen, about origin (ox, oy). */
export function project(x: number, y: number, h: number, ox: number, oy: number): Point {
  return [ox + (x - y) * COS30, oy + (x + y) * SIN30 - h]
}

/** The ground point under screen point (px, py): the inverse of `project` at h = 0. */
export function ground(px: number, py: number, ox: number, oy: number): Point {
  const u = (px - ox) / COS30
  const v = (py - oy) / SIN30
  return [(v + u) / 2, (v - u) / 2]
}

/**
 * The hill's height at ground offset (dx, dy) from its centre, at full
 * strength: a round hill with a shallow trough around it (a Ricker profile,
 * softened). LIFT at the centre, about 3% of that below flat in the trough.
 */
export function hillHeight(dx: number, dy: number): number {
  const d2 = (dx * dx + dy * dy) / (RADIUS * RADIUS)
  return LIFT * (1 - 0.35 * d2) * Math.exp(-d2 / 1.6)
}

/**
 * The square of ground, `n` cells from `x0` along both axes, whose diamond
 * covers a w × h card, with room for the hill to lift the near edge without
 * showing what's under it.
 */
export function gridFor(w: number, h: number): { x0: number; n: number } {
  const ox = w / 2
  const oy = h / 2
  let lo = Infinity
  let hi = -Infinity
  for (const [a, b] of [[0, 0], [w, 0], [0, h], [w, h + LIFT * 1.5]] as const) {
    const [x, y] = ground(a, b, ox, oy)
    lo = Math.min(lo, x, y)
    hi = Math.max(hi, x, y)
  }
  const x0 = Math.floor((lo - CELL * 2) / CELL) * CELL
  return { x0, n: Math.ceil((hi + CELL * 2 - x0) / CELL) }
}

type Spring = { x: number; v: number; t: number }

type Colours = { paper: string; minor: string[]; major: string[] }

// One 1×1 canvas turns any CSS colour (hex, rgb, oklch…) into sRGB bytes.
let probe: CanvasRenderingContext2D | null = null
function toRGB(css: string): [number, number, number] {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!probe) return [0, 0, 0]
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = '#000'
  probe.fillStyle = css.trim() || '#000'
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

export function mountIsoSheet(canvas: HTMLCanvasElement): { destroy(): void } {
  const ctx = canvas.getContext('2d')
  const panel = canvas.parentElement
  if (!ctx || !panel) return { destroy() {} }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const darkScheme = matchMedia('(prefers-color-scheme: dark)')

  // Card size in CSS px, and the grid laid over it.
  let W = 0
  let H = 0
  let dpr = 1
  let ox = 0
  let oy = 0
  let n = 0
  let x0 = 0
  // Heights at the grid's (n + 1)² corners. Kept between resizes and only
  // replaced when a bigger card needs a bigger grid.
  let rest = new Float32Array(0)
  let z = new Float32Array(0)
  let colours: Colours | null = null

  // Springs on the hill: where it stands (continuous, k 100 · c 18) and how high.
  const spring = (x: number): Spring => ({ x, v: 0, t: x })
  const hx = spring(0)
  const hy = spring(0)
  const amp = spring(0)
  const step = (s: Spring, dt: number, k = 100, c = 18): boolean => {
    if (reduced.matches) {
      s.x = s.t
      s.v = 0
      return false
    }
    s.v += (-k * (s.x - s.t) - c * s.v) * dt
    s.x += s.v * dt
    if (Math.abs(s.x - s.t) < 0.05 && Math.abs(s.v) < 0.05) {
      s.x = s.t
      s.v = 0
      return false
    }
    return true
  }

  function readColours() {
    const style = getComputedStyle(canvas)
    const ink = toRGB(style.getPropertyValue('--text'))
    const paper = toRGB(style.getPropertyValue('--surface'))
    const mix = (t: number) =>
      `rgb(${ink.map((c, i) => Math.round(paper[i] + (c - paper[i]) * t)).join(',')})`
    // Line strength steps with height: index 0 is flat, 7 is the top of the hill.
    colours = {
      paper: mix(0),
      minor: Array.from({ length: SHADES }, (_, k) => mix(0.12 + k * 0.045)),
      major: Array.from({ length: SHADES }, (_, k) => mix(0.24 + k * 0.05)),
    }
  }

  let pointerIn = false

  /** Fits the grid to a w × h card. Does nothing when nothing changed. */
  function layout(w: number, h: number) {
    const nextDpr = Math.min(2, devicePixelRatio || 1)
    if (w === W && h === H && nextDpr === dpr) return
    W = w
    H = h
    dpr = nextDpr
    // Setting a canvas's size clears and reallocates it, so only when it changes.
    const pw = Math.round(W * dpr)
    const ph = Math.round(H * dpr)
    if (canvas.width !== pw) canvas.width = pw
    if (canvas.height !== ph) canvas.height = ph
    ox = W / 2
    oy = H / 2
    ;({ x0, n } = gridFor(W, H))
    const corners = (n + 1) * (n + 1)
    if (rest.length < corners) {
      rest = new Float32Array(corners)
      z = new Float32Array(corners)
    }
    // Rest: two low swells, off centre, so the sheet is never flat.
    const [ax, ay] = ground(W * 0.34, H * 0.3, ox, oy)
    const [bx, by] = ground(W * 0.7, H * 0.72, ox, oy)
    const sa = 2 * (5 * CELL) ** 2
    const sb = 2 * (4 * CELL) ** 2
    for (let j = 0; j <= n; j++) {
      const y = x0 + j * CELL
      for (let i = 0; i <= n; i++) {
        const x = x0 + i * CELL
        rest[j * (n + 1) + i] =
          1.4 * CELL * Math.exp(-((x - ax) ** 2 + (y - ay) ** 2) / sa) +
          0.9 * CELL * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / sb)
      }
    }
    if (!pointerIn) {
      const [cx, cy] = ground(W * 0.55, H * 0.5, ox, oy)
      hx.x = hx.t = cx
      hy.x = hy.t = cy
    }
  }

  /** The heights to draw this frame: the rest heights alone while the hill is down. */
  function heights(): Float32Array {
    const a = amp.x
    if (a === 0) return rest
    const N1 = n + 1
    const cx = hx.x
    const cy = hy.x
    for (let j = 0; j <= n; j++) {
      const dy = x0 + j * CELL - cy
      for (let i = 0; i <= n; i++) {
        const k = j * N1 + i
        z[k] = rest[k] + a * hillHeight(x0 + i * CELL - cx, dy)
      }
    }
    return z
  }

  function draw() {
    if (!colours || W === 0 || H === 0) return
    const hs = heights()
    const { paper, minor, major } = colours
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx!.fillStyle = paper
    ctx!.fillRect(0, 0, W, H)
    ctx!.lineWidth = 1
    ctx!.lineJoin = 'round'
    const N1 = n + 1
    const top = LIFT * 1.1
    const shade = (h: number) => Math.max(0, Math.min(SHADES - 1, Math.round((h / top) * (SHADES - 1))))
    // The cell's four edges, gathered so neighbours in one colour share a stroke.
    // Each cell is stroked before the next is filled, so occlusion is kept.
    // Setting a style parses it, so only when it changes.
    let pathColour = ''
    let strokeColour = ''
    const edge = (px: number, py: number, qx: number, qy: number, colour: string) => {
      if (colour !== pathColour) {
        if (pathColour) ctx!.stroke()
        if (strokeColour !== colour) ctx!.strokeStyle = strokeColour = colour
        ctx!.beginPath()
        pathColour = colour
      }
      ctx!.moveTo(px, py)
      ctx!.lineTo(qx, qy)
    }
    // Back to front: the far corner has the smallest i + j.
    for (let s = 0; s <= 2 * (n - 1); s++) {
      const iMax = Math.min(n - 1, s)
      for (let i = Math.max(0, s - n + 1); i <= iMax; i++) {
        const j = s - i
        const x = x0 + i * CELL
        const y = x0 + j * CELL
        const za = hs[j * N1 + i]
        const zb = hs[j * N1 + i + 1]
        const zc = hs[(j + 1) * N1 + i + 1]
        const zd = hs[(j + 1) * N1 + i]
        // Corners a (x, y), b (x + 1, y), c (x + 1, y + 1), d (x, y + 1), projected.
        const ax = ox + (x - y) * COS30
        const bx = ax + CELL * COS30
        const dx = ax - CELL * COS30
        const cx = ax
        const base = oy + (x + y) * SIN30
        const ay = base - za
        const by = base + CELL * SIN30 - zb
        const cy = base + CELL - zc
        const dy = base + CELL * SIN30 - zd
        if (bx < -2 || dx > W + 2) continue
        if (Math.max(ay, by, cy, dy) < -2 || Math.min(ay, by, cy, dy) > H + 2) continue
        ctx!.beginPath()
        ctx!.moveTo(ax, ay)
        ctx!.lineTo(bx, by)
        ctx!.lineTo(cx, cy)
        ctx!.lineTo(dx, dy)
        ctx!.closePath()
        ctx!.fill()
        // Major every fourth line, brighter as it rises.
        const gi = Math.round(x / CELL)
        const gj = Math.round(y / CELL)
        pathColour = ''
        edge(ax, ay, bx, by, (gj % MAJOR === 0 ? major : minor)[shade((za + zb) / 2)])
        edge(dx, dy, cx, cy, ((gj + 1) % MAJOR === 0 ? major : minor)[shade((zd + zc) / 2)])
        edge(ax, ay, dx, dy, (gi % MAJOR === 0 ? major : minor)[shade((za + zd) / 2)])
        edge(bx, by, cx, cy, ((gi + 1) % MAJOR === 0 ? major : minor)[shade((zb + zc) / 2)])
        ctx!.stroke()
      }
    }
  }

  // One loop, only while something changed or a spring moves, and never while
  // the card is off screen. Resizes and theme changes ask for a frame rather
  // than drawing, so a frame lays out and draws at most once.
  let raf = 0
  let last = 0
  let visible = true
  let pendingSize: { w: number; h: number } | null = null
  let recolour = false

  function tick(now: number) {
    const dt = Math.min(0.032, (now - last) / 1000 || 0.016)
    last = now
    if (pendingSize) {
      layout(pendingSize.w, pendingSize.h)
      pendingSize = null
    }
    if (recolour) {
      readColours()
      recolour = false
    }
    const moving = [step(hx, dt), step(hy, dt), step(amp, dt, 60, 14)].some(Boolean)
    draw()
    raf = moving && visible ? requestAnimationFrame(tick) : 0
  }
  function wake() {
    if (!raf && visible) {
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }
  }

  function onPointerMove(e: PointerEvent) {
    const r = canvas.getBoundingClientRect()
    const [x, y] = ground(e.clientX - r.left, e.clientY - r.top, ox, oy)
    hx.t = x
    hy.t = y
    if (!pointerIn) {
      pointerIn = true
      // Arriving from outside, the hill starts where the pointer is.
      if (amp.x < 0.05) {
        hx.x = x
        hy.x = y
      }
      amp.t = 1
    }
    wake()
  }
  function onPointerLeave() {
    pointerIn = false
    amp.t = 0
    wake()
  }
  function onThemeChange() {
    recolour = true
    wake()
  }

  panel.addEventListener('pointermove', onPointerMove)
  panel.addEventListener('pointerleave', onPointerLeave)

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    if (visible) wake()
  })
  io.observe(canvas)

  const ro = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    if (width === W && height === H && Math.min(2, devicePixelRatio || 1) === dpr) return
    pendingSize = { w: width, h: height }
    wake()
  })
  // Watching device pixels too catches a move to a screen of another density.
  try {
    ro.observe(canvas, { box: 'device-pixel-content-box' })
  } catch {
    ro.observe(canvas)
  }

  const mo = new MutationObserver(onThemeChange)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
  darkScheme.addEventListener('change', onThemeChange)

  const box = canvas.getBoundingClientRect()
  readColours()
  layout(box.width, box.height)
  draw()

  return {
    destroy() {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      visible = false
      panel.removeEventListener('pointermove', onPointerMove)
      panel.removeEventListener('pointerleave', onPointerLeave)
      io.disconnect()
      ro.disconnect()
      mo.disconnect()
      darkScheme.removeEventListener('change', onThemeChange)
    },
  }
}
