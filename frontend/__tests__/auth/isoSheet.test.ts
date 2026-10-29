import { CELL, LIFT, RADIUS, gridFor, ground, hillHeight, project } from '@/components/auth/iso-sheet'

describe('iso sheet geometry', () => {
  it('reads a screen point back to the ground point that projects onto it', () => {
    const [ox, oy] = [400, 300]
    for (const [x, y] of [[0, 0], [120, -45], [-300, 260], [17.5, 900]]) {
      const [px, py] = project(x, y, 0, ox, oy)
      const [gx, gy] = ground(px, py, ox, oy)
      expect(gx).toBeCloseTo(x, 9)
      expect(gy).toBeCloseTo(y, 9)
    }
  })

  it('projects the ground in true isometric', () => {
    // One step along either axis moves 30° below the horizontal, mirrored.
    const [ax, ay] = project(CELL, 0, 0, 0, 0)
    const [bx, by] = project(0, CELL, 0, 0, 0)
    expect(Math.atan2(ay, ax)).toBeCloseTo(Math.PI / 6, 9)
    expect(bx).toBeCloseTo(-ax, 9)
    expect(by).toBeCloseTo(ay, 9)
  })

  it('lifts a point straight up the screen by its height', () => {
    const [px, py] = project(50, 80, 20, 10, 10)
    const [fx, fy] = project(50, 80, 0, 10, 10)
    expect(px).toBe(fx)
    expect(py).toBe(fy - 20)
  })

  it('stands the hill highest at its centre', () => {
    expect(hillHeight(0, 0)).toBeCloseTo(LIFT, 9)
    for (const d of [CELL / 2, CELL, RADIUS / 2, RADIUS]) {
      expect(hillHeight(d, 0)).toBeLessThan(LIFT)
    }
  })

  it('is round', () => {
    const d = RADIUS * 0.8
    expect(hillHeight(d, 0)).toBeCloseTo(hillHeight(0, d), 9)
    expect(hillHeight(d / Math.SQRT2, d / Math.SQRT2)).toBeCloseTo(hillHeight(d, 0), 9)
  })

  it('dips slightly in a trough around the hill', () => {
    const lowest = Math.min(...Array.from({ length: 400 }, (_, k) => hillHeight((k / 100) * RADIUS, 0)))
    expect(lowest).toBeLessThan(0)
    expect(lowest).toBeGreaterThan(-0.06 * LIFT)
  })

  it('is flat far away', () => {
    expect(Math.abs(hillHeight(10 * RADIUS, 0))).toBeLessThan(1e-6)
  })

  it('lays a grid whose ground covers every corner of the card', () => {
    const [w, h] = [900, 760]
    const { x0, n } = gridFor(w, h)
    const end = x0 + n * CELL
    for (const [a, b] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      for (const g of ground(a, b, w / 2, h / 2)) {
        expect(g).toBeGreaterThan(x0)
        expect(g).toBeLessThan(end)
      }
    }
  })
})
