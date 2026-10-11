import { TEXT_LIMITS } from '@/contracts/limits'
import { transcriptTitleTooLong } from '@/core/transcripts/title'
import { captureTitleInputId } from './shared'
import { CharacterCount } from '@/components/ui/character-count'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import CaptureProjectField from './CaptureProjectField'

const titleCountId = 'capture-title-count'

interface CaptureDetailsProps {
  projectId: string | null
  onProjectChange: (projectId: string | null) => void
  title: string
  setTitle: (value: string) => void
  /** Set after a submit attempt was blocked by an over-long title. */
  titleError: string | null
  disabled: boolean
}

export default function CaptureDetails({
  projectId,
  onProjectChange,
  title,
  setTitle,
  titleError,
  disabled,
}: CaptureDetailsProps) {
  return (
    <div className="space-y-4 pt-2 border-t border-border">
      <p className="block text-[10px] font-mono uppercase tracking-wider opacity-60 mt-4">Transcript Details</p>

      <div className="space-y-1">
        {/* The count shares the label's line, so it needs no row of its own: the
            fields below keep an even rhythm and nothing moves while typing. */}
        <div className="flex items-center justify-between gap-3">
          <Label className="text-xs font-medium opacity-80" htmlFor={captureTitleInputId}>Title</Label>
          {/* Its 20px line would make this row taller than the other labels. */}
          <CharacterCount id={titleCountId} length={title.trim().length} max={TEXT_LIMITS.transcriptTitle} className="-my-0.5" />
        </div>
        <Input
          id={captureTitleInputId}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Client Interview - January 2026"
          aria-describedby={titleCountId}
          aria-invalid={transcriptTitleTooLong(title) ? true : undefined}
          disabled={disabled}
        />
        {titleError && <p role="alert" className="text-xs text-ember-red">{titleError}</p>}
      </div>

      <CaptureProjectField projectId={projectId} onProjectChange={onProjectChange} disabled={disabled} />

      <div className="space-y-1">
        <Label className="text-xs font-medium opacity-80">
          Language <span className="text-[10px] font-mono opacity-50 ml-1">(coming soon)</span>
        </Label>
        <Select disabled>
          <SelectTrigger aria-label="Language" className="w-full bg-field/50 border-border rounded-sm px-3 py-2 text-sm cursor-not-allowed opacity-60">
            <SelectValue placeholder="English (US)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en-us">English (US)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div>
          <p className="text-xs font-medium opacity-80">
            Speaker Diarization <span className="text-[10px] font-mono opacity-50">(coming soon)</span>
          </p>
          <p className="text-[10px] text-foreground/40">Automatically identify speakers</p>
        </div>
        <Switch disabled checked aria-label="Speaker diarization" className="data-[state=checked]:bg-ember-red" />
      </div>
    </div>
  )
}
