import { useCallback, useRef } from 'react'
import SpeakerPopoverContent from '@/components/SpeakerPopoverContent'
import { Popover, PopoverAnchor, PopoverContent, PopoverFrozenWhileClosed } from '@/components/ui/popover'
import type { EditorPeopleContext } from '@/contracts/db'
import type { useSpeakerAssignments } from '../hooks/useSpeakerAssignments'

type SpeakerPicker = Pick<ReturnType<typeof useSpeakerAssignments>,
  'speakerPopover' | 'closeSpeakerPopover' | 'anchorRef' | 'takeCloseReason' | 'lastTriggerElementRef' |
  'presentation' | 'currentSpeaker' | 'scopes' | 'removable' | 'selectTarget' | 'removeSpeaker' |
  'renameLocal' | 'renameLinkedPerson' | 'labelForSpeaker' | 'displayForSpeaker'
>

export function EditorSpeakerPopover({ transcriptId, peopleContext, speakerHook, showInSpeakers }: {
  transcriptId: string
  peopleContext: EditorPeopleContext
  speakerHook: SpeakerPicker
  showInSpeakers: () => void
}) {
  const open = speakerHook.speakerPopover !== null
  const didInteractOutsidePopoverRef = useRef(false)
  // True while the popover holds a name over the length limit; an outside click
  // then leaves it open rather than discarding the typed name.
  const holdSpeakerPopoverOpenRef = useRef(false)
  const setHoldSpeakerPopoverOpen = useCallback((hold: boolean) => {
    holdSpeakerPopoverOpenRef.current = hold
  }, [])

  return (
    <Popover
      open={open}
      onOpenChange={(open) => {
        if (!open) {
          const reason = didInteractOutsidePopoverRef.current ? 'outside' : 'dismiss'
          didInteractOutsidePopoverRef.current = false
          speakerHook.closeSpeakerPopover(reason)
        }
      }}
    >
      <PopoverAnchor virtualRef={speakerHook.anchorRef} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-[min(20rem,calc(100vw-2rem))] overflow-hidden p-0"
        aria-label="Speaker assignment"
        // Prevent Radix auto-focus; SpeakerPopoverContent focuses its
        // own search input on mount (SpeakerPopoverContent.tsx useEffect)
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (holdSpeakerPopoverOpenRef.current) {
            event.preventDefault()
            return
          }
          // Radix dismisses after the click, so a press on a speaker name
          // would close the picker that name's click just opened. The click
          // decides instead: another name moves the picker, the same one
          // closes it (handleAvatarClick).
          if (event.detail.originalEvent.type === 'pointerdown'
            && event.target instanceof Element && event.target.closest('[data-speaker-trigger]')) {
            event.preventDefault()
            return
          }
          didInteractOutsidePopoverRef.current = true
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()

          const reason = speakerHook.takeCloseReason()
          const shouldRestoreFocus = reason !== 'outside' && reason !== 'external'
          const triggerElement = speakerHook.lastTriggerElementRef.current

          if (shouldRestoreFocus && triggerElement?.isConnected) {
            window.setTimeout(() => triggerElement.focus(), 0)
          }

          didInteractOutsidePopoverRef.current = false
        }}
      >
        <PopoverFrozenWhileClosed open={open}>
          <SpeakerPopoverContent
            key={speakerHook.speakerPopover?.segmentId}
            transcriptId={transcriptId}
            presentation={speakerHook.presentation}
            peopleContext={peopleContext}
            currentSpeaker={speakerHook.currentSpeaker}
            scopes={speakerHook.scopes}
            removable={speakerHook.removable}
            onSelectTarget={speakerHook.selectTarget}
            onRemove={speakerHook.removeSpeaker}
            onRenameLocal={speakerHook.renameLocal}
            onRenamePerson={speakerHook.renameLinkedPerson}
            labelForSpeaker={speakerHook.labelForSpeaker}
            displayForSpeaker={speakerHook.displayForSpeaker}
            onHoldOpenChange={setHoldSpeakerPopoverOpen}
            onShowInSpeakers={showInSpeakers}
          />
        </PopoverFrozenWhileClosed>
      </PopoverContent>
    </Popover>
  )
}
