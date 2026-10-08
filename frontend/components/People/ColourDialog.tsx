'use client'

import { useState } from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { mapPeopleWriteError } from '@/lib/people/errors'
import { SPEAKER_COLOR_NAMES, SPEAKER_COLORS } from '@/lib/speakers/palette'

/**
 * Change colour (spec §4, §8): the person's preferred colour, from the speaker
 * palette. Inside a transcript it still yields to whoever claimed it first.
 */
export function ColourDialog({ name, current, onOpenChange, onChoose }: {
  name: string
  current: string
  onOpenChange: (open: boolean) => void
  /** Rejects to show an error in the dialog; resolves to close it. */
  onChoose: (color: string) => Promise<void>
}) {
  const [color, setColor] = useState(current)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (color === current) {
      onOpenChange(false)
      return
    }
    setPending(true)
    setError(null)
    try {
      await onChoose(color)
      onOpenChange(false)
    } catch (caught) {
      setError(mapPeopleWriteError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!pending) onOpenChange(open) }}>
      <DialogContent className="overflow-hidden p-0">
        <form onSubmit={save}>
          <div className="space-y-4 px-6 pb-5 pt-6">
            <div>
              <DialogTitle>Change colour</DialogTitle>
              <DialogDescription className="mt-1">
                {name}&apos;s avatar colour. In a transcript where someone else already has it, {name} takes the next free one.
              </DialogDescription>
            </div>
            <RadioGroupPrimitive.Root
              aria-label="Colour"
              value={color}
              onValueChange={setColor}
              disabled={pending}
              className="flex flex-wrap gap-3"
            >
              {SPEAKER_COLORS.map((swatch) => (
                <RadioGroupPrimitive.Item
                  key={swatch}
                  value={swatch}
                  aria-label={SPEAKER_COLOR_NAMES[swatch]}
                  className="flex h-9 w-9 items-center justify-center rounded-full ring-offset-2 ring-offset-[var(--surface)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-trust-blue/60 data-[state=checked]:ring-2 data-[state=checked]:ring-foreground"
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
          <div className="flex justify-end gap-3 border-t border-border bg-subtle px-6 py-4">
            <Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending}>{pending ? 'Saving…' : 'Save colour'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
