"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { LeavePhase } from '../hooks/useLeaveEditor'

const TEXT: Record<LeavePhase, { heading: string; description: string }> = {
  saving: { heading: 'Saving your changes…', description: "You'll go as soon as they're saved." },
  slow: { heading: "Your changes aren't saved yet", description: 'Saving is taking longer than usual. It keeps going while you stay.' },
  offline: { heading: "Your changes aren't saved yet", description: "The editor can't reach the server. It keeps trying while you stay." },
  failed: { heading: "Your changes aren't saved yet", description: 'Saving them failed.' },
}

/** Shown while leaving the editor waits for its changes to be saved. */
export default function LeaveEditorDialog({ phase, hasUnsaved, onStay, onLeave, onCopy }: {
  phase: LeavePhase | null
  /** Whether there is typed text to copy. */
  hasUnsaved: boolean
  onStay(): void
  onLeave(): void
  onCopy(): void
}) {
  const text = phase ? TEXT[phase] : null
  return (
    <AlertDialog open={phase !== null} onOpenChange={(open) => { if (!open) onStay() }}>
      <AlertDialogContent className="overflow-hidden p-0">
        <div className="px-6 pt-6 pb-5">
          <AlertDialogTitle className="mb-2 font-sans text-sm font-semibold not-italic text-foreground">
            {text?.heading}
          </AlertDialogTitle>
          <AlertDialogDescription aria-live="polite" className="text-sm leading-relaxed text-muted">
            {text?.description}
          </AlertDialogDescription>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border bg-subtle px-6 py-4">
          {phase !== 'saving' && hasUnsaved && (
            <Button type="button" variant="ghost" className="mr-auto" onClick={onCopy}>Copy text</Button>
          )}
          <AlertDialogCancel>Stay</AlertDialogCancel>
          {phase !== 'saving' && (
            <AlertDialogAction onClick={onLeave}>Leave without saving</AlertDialogAction>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
