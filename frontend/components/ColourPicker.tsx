'use client'

import { useState, type ReactNode } from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { Check } from 'lucide-react'
import { mapPeopleWriteError } from '@/lib/people/errors'
import { SPEAKER_COLOR_NAMES, SPEAKER_COLORS } from '@/lib/speakers/palette'

/**
 * Change colour, shown in a popover: one of the speaker palette's colours, for
 * a person (spec §4, §8) or a tag. Choosing a swatch applies it.
 */
export function ColourPicker({ current, onChoose, hint, describeError = (error) => mapPeopleWriteError(error) }: {
  current: string
  /** Rejects to show an error in the picker; the caller closes it once this resolves. */
  onChoose: (color: string) => Promise<void>
  /** A line above the swatches. */
  hint?: ReactNode
  /** The message for a rejected choice. */
  describeError?: (error: unknown) => string
}) {
  // The swatch being saved; otherwise the picker shows `current`, which can
  // change under it (a reload after a change made elsewhere).
  const [choice, setChoice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pending = choice !== null
  const color = choice ?? current

  const choose = async (next: string) => {
    if (pending || next === current) return
    setChoice(next)
    setError(null)
    try {
      await onChoose(next)
    } catch (caught) {
      setError(describeError(caught))
    } finally {
      setChoice(null)
    }
  }

  return (
    <div className="space-y-3">
      {hint && <p className="text-xs text-muted">{hint}</p>}
      <RadioGroupPrimitive.Root
        aria-label="Colour"
        value={color}
        onValueChange={(next) => void choose(next)}
        disabled={pending}
        className="grid grid-cols-5 gap-2"
      >
        {SPEAKER_COLORS.map((swatch) => (
          <RadioGroupPrimitive.Item
            key={swatch}
            value={swatch}
            aria-label={SPEAKER_COLOR_NAMES[swatch]}
            title={SPEAKER_COLOR_NAMES[swatch]}
            className="flex h-9 w-9 items-center justify-center justify-self-center rounded-full ring-offset-2 ring-offset-[var(--surface)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-trust-blue/60 data-[state=checked]:ring-2 data-[state=checked]:ring-foreground"
            style={{ backgroundColor: swatch }}
          >
            <RadioGroupPrimitive.Indicator>
              <Check className="h-4 w-4 text-solid-foreground" aria-hidden="true" />
            </RadioGroupPrimitive.Indicator>
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
      {error && <p role="alert" className="text-sm text-ember-red">{error}</p>}
    </div>
  )
}
