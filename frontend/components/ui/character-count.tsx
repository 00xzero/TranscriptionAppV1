'use client'

import { useEffect, useState } from 'react'
import NumberFlow from '@number-flow/react'
import { CHARACTER_COUNT_THRESHOLD } from '@/contracts/limits'
import { cn } from '@/lib/utils'

type CharacterCountProps = {
  /** Point the input's aria-describedby here so the limit is read with the field. */
  id: string
  length: number
  max: number
  className?: string
}

/**
 * The count rolls digit by digit like an odometer, up while typing and down while
 * deleting (NumberFlow's default trend). Kept short so it never lags fast typing;
 * NumberFlow swaps instantly when the user prefers reduced motion.
 */
const ROLL_TIMING = { duration: 180, easing: 'ease-out' } as const
const ROLL_FADE_TIMING = { duration: 120, easing: 'ease-out' } as const

/** Screen readers hear the count once typing pauses, not on every keystroke. */
const ANNOUNCE_AFTER_TYPING_MS = 1000

function characters(count: number) {
  return `${count} ${count === 1 ? 'character' : 'characters'}`
}

/**
 * Counter for a length-limited text input, following GOV.UK's character count:
 * hidden until CHARACTER_COUNT_THRESHOLD of the limit is used, and the input lets
 * users type past the limit (no maxLength) so pasted text is never silently cut.
 * The owning form blocks saving while the value is over.
 */
export function CharacterCount({ id, length, max, className }: CharacterCountProps) {
  const visible = length >= Math.ceil(max * CHARACTER_COUNT_THRESHOLD)
  const over = length - max
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!visible) setAnnouncement('')
      else if (over > 0) setAnnouncement(`${characters(over)} too many`)
      else setAnnouncement(`${characters(max - length)} remaining`)
    }, ANNOUNCE_AFTER_TYPING_MS)
    return () => window.clearTimeout(timeout)
  }, [visible, over, length, max])

  return (
    <div className={cn('shrink-0 font-mono text-xs tabular-nums', className)}>
      <span id={id} className="sr-only">
        Up to {max} characters.
      </span>
      {/*
        Stays in the layout while hidden so the form does not jump when it appears;
        it fades in and out instead. Crossing the limit adds the pulse class, so the
        pulse plays once each time the count goes over and eases the colour to red.
      */}
      <span
        aria-hidden="true"
        data-testid="character-count"
        className={cn(
          'inline-block transition-[opacity,color] duration-300 ease-out',
          visible ? 'opacity-100' : 'opacity-0',
          over > 0 ? 'animate-[limitPulse_320ms_ease-out] text-ember-red' : 'text-muted'
        )}
      >
        <NumberFlow
          value={length}
          transformTiming={ROLL_TIMING}
          spinTiming={ROLL_TIMING}
          opacityTiming={ROLL_FADE_TIMING}
        />
        /{max}
      </span>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  )
}
