export type FigureName = 'drawer' | 'rolodex' | 'typewriter'

export interface FigureControls {
  /** A pointer over the drawing itself, in client coordinates: the part under it answers; over no part, it rests. */
  point(clientX: number, clientY: number): void
  /** The figure's answer to the empty state's action. */
  preview(): void
  /** Back to rest. */
  release(): void
  /** One reach and back, as the page opens. Skipped under prefers-reduced-motion. */
  arrive(): void
  /** Removes the drawing and stops its motion. */
  destroy(): void
}

/**
 * Draws the figure into host; the page drives it through the controls. `tight`
 * crops the figure's frame to the drawing itself, so it fills a larger box.
 */
export function mountFigure(name: FigureName, host: HTMLElement, options?: { tight?: boolean }): FigureControls
