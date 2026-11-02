import { useCallback, useState, type KeyboardEvent } from 'react'

/**
 * Keyboard for a combobox over a list of options: Arrow Up and Down move the
 * highlight, Enter chooses the highlighted option. The field keeps focus and
 * points at the highlight with aria-activedescendant; the highlight stays on
 * the last option when the list shrinks under it.
 */
export function useListboxKeys<T>(options: readonly T[], onChoose: (option: T) => void) {
  const [active, setActive] = useState(0)
  // The stored index can outlive a longer list: read it against this one.
  const clamp = useCallback((index: number) => Math.max(0, Math.min(index, options.length - 1)), [options.length])
  const highlighted: T | undefined = options[clamp(active)]

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => clamp(clamp(index) + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => clamp(clamp(index) - 1)) }
    else if (event.key === 'Enter' && highlighted !== undefined) { event.preventDefault(); onChoose(highlighted) }
  }, [clamp, highlighted, onChoose])

  return {
    highlighted,
    onKeyDown,
    /** Back to the first option, e.g. when the query changes. */
    reset: useCallback(() => setActive(0), []),
    /** Highlight an option under the pointer. */
    point: useCallback((option: T) => setActive(options.indexOf(option)), [options]),
  }
}
