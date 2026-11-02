'use client'

import { useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { CharacterCount } from '@/components/ui/character-count'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { mapPeopleWriteError, type WriteSubject } from '@/lib/people/errors'
import { nameLength } from './format'

type PersonNameDialogProps = {
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** The field's accessible name. */
  label: string
  initialName?: string
  maxLength: number
  subject: WriteSubject
  /** The submit button's text for the name as typed, e.g. Create or Create another. */
  submitLabel: (name: string) => string
  pendingLabel: string
  /** Rejects to show an error in the dialog; resolves to close it. */
  onSubmit: (name: string) => Promise<void>
  /** Shown under the field for the name as typed, e.g. existing namesakes. */
  children?: (name: string) => ReactNode
}

/**
 * One name field: create a person, rename a person, rename an organisation.
 * Mount it only while open, so every opening starts from `initialName`.
 * Names are trimmed and 1 to `maxLength` characters (spec §4); a name left
 * unchanged closes without writing.
 */
export function PersonNameDialog({
  onOpenChange,
  title,
  description,
  label,
  initialName = '',
  maxLength,
  subject,
  submitLabel,
  pendingLabel,
  onSubmit,
  children,
}: PersonNameDialogProps) {
  const [name, setName] = useState(initialName)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const counterId = useId()

  const handleOpenChange = (open: boolean) => {
    if (pending && !open) return
    onOpenChange(open)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (nameLength(trimmed) === 0) {
      setError('Enter a name.')
      return
    }
    if (nameLength(trimmed) > maxLength) {
      setError(`Names must be ${maxLength} characters or fewer.`)
      return
    }
    if (trimmed === initialName) {
      onOpenChange(false)
      return
    }
    setPending(true)
    setError(null)
    try {
      await onSubmit(trimmed)
      onOpenChange(false)
    } catch (caught) {
      setError(mapPeopleWriteError(caught, subject))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-6 pb-5 pt-6">
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1">{description}</DialogDescription>
            </div>
            <Input
              autoFocus
              aria-label={label}
              value={name}
              aria-describedby={counterId}
              aria-invalid={error ? true : undefined}
              disabled={pending}
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
            />
            <div className="-mt-2 flex items-start justify-between gap-3">
              {error ? <p role="alert" className="text-sm text-ember-red">{error}</p> : <span />}
              <CharacterCount id={counterId} length={nameLength(name)} max={maxLength} />
            </div>
            {children?.(name)}
          </div>
          <div className="flex justify-end gap-3 border-t border-border bg-subtle px-6 py-4">
            <Button type="button" variant="ghost" disabled={pending} onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? pendingLabel : submitLabel(name)}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
