import { forwardRef } from 'react'
import { SpeakerAvatarGroup } from '@/components/Projects/SpeakerAvatarGroup'
import { countLabel } from '@/components/Projects/format'
import { cn } from '@/lib/utils'
import type { SpeakerOverview } from '../hooks/useSpeakerOverview'
import { TalkShareBar } from './TalkShareBar'

/**
 * The editor header's speaker summary: the most talkative faces and a talk-share
 * bar. It is the button that opens the speakers sidebar, so the circles' own
 * tooltips stay hover-only and the button carries the accessible name.
 */
export const SpeakerSummaryButton = forwardRef<HTMLButtonElement, {
  overview: SpeakerOverview
  expanded: boolean
  controlsId: string
  onToggle: () => void
}>(function SpeakerSummaryButton({ overview, expanded, controlsId, onToggle }, ref) {
  if (overview.rows.length === 0) return null
  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={controlsId}
      aria-label={`Speakers: ${countLabel(overview.headerCount, 'speaker', 'speakers')}`}
      className={cn(
        '-my-1 inline-flex cursor-pointer items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 normal-case tracking-normal transition-colors',
        'hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-blue/60',
        expanded && 'bg-subtle'
      )}
    >
      <SpeakerAvatarGroup speakers={overview.headerSpeakers} totalCount={overview.headerCount} size="editor" />
      <TalkShareBar rows={overview.rows} />
    </button>
  )
})
