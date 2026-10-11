import { SPEAKER_COLOR_FALLBACK } from '@/lib/speakers/palette'
import { cn } from '@/lib/utils'
import { formatShare, type SpeakerOverviewRow } from '../hooks/useSpeakerOverview'

type BarRow = Pick<SpeakerOverviewRow, 'key' | 'label' | 'color' | 'share' | 'shareLabel' | 'isUnknown'>

/**
 * Below this share a speaker joins "Others". The bar is 80px wide, so 5% is
 * about 4px: anything thinner is a sliver nobody can see or point at.
 */
export const OTHERS_BELOW_SHARE = 0.05

/**
 * Who has the floor, as one stacked bar in each speaker's colour. Grey chunks
 * (voices nobody has linked, then Unknown) follow, so how much is still
 * unnamed reads as one grey stretch; everyone under 5% closes the bar as a
 * single "Others" chunk, in a warm neutral so it is not mistaken for unnamed.
 */
export function TalkShareBar({ rows, className }: { rows: readonly BarRow[]; className?: string }) {
  const grey = (row: BarRow) => row.isUnknown ? 2 : row.color === SPEAKER_COLOR_FALLBACK ? 1 : 0
  const spoken = rows.filter((row) => row.share > 0)
  const chunks = spoken.filter((row) => row.share >= OTHERS_BELOW_SHARE).sort((a, b) => grey(a) - grey(b))
  const small = spoken.filter((row) => row.share < OTHERS_BELOW_SHARE)
  const othersShare = small.reduce((sum, row) => sum + row.share, 0)
  if (chunks.length === 0 && small.length === 0) return null

  const parts = chunks.map((row) => `${row.label} ${row.shareLabel}`)
  // One quiet speaker is still named; "Others" is for two or more.
  if (small.length > 0) parts.push(`${small.length === 1 ? small[0].label : 'Others'} ${formatShare(othersShare)}`)
  return (
    <span
      role="img"
      aria-label={`Talk time: ${parts.join(', ')}`}
      className={cn('flex h-[7px] w-20 shrink-0 gap-px overflow-hidden rounded-full', className)}
    >
      {chunks.map((row) => (
        <span key={row.key} className="h-full" style={{ flexGrow: row.share, backgroundColor: row.color }} />
      ))}
      {small.length > 0 && (
        // Muted text at 40%: darker than the paper in light mode, lighter than the page in
        // dark, and still apart from the cool grey of unnamed voices in both.
        <span data-testid="talk-share-others" className="h-full bg-muted/40" style={{ flexGrow: othersShare }} />
      )}
    </span>
  )
}
