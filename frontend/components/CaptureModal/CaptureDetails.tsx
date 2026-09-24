import { TEXT_LIMITS } from '@/contracts/limits'
import { transcriptTitleTooLong } from '@/core/transcripts/title'
import { captureTitleInputId } from './shared'
import { CharacterCount } from '@/components/ui/character-count'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const titleCountId = 'capture-title-count'

interface CaptureDetailsProps {
  title: string
  setTitle: (value: string) => void
  /** Set after a submit attempt was blocked by an over-long title. */
  titleError: string | null
  isUploading: boolean
}

export default function CaptureDetails({ title, setTitle, titleError, isUploading }: CaptureDetailsProps) {
  return (
    <div className="space-y-4 pt-2 border-t border-border">
      <p className="block text-[10px] font-mono uppercase tracking-wider opacity-60 mt-4">Transcript Details</p>

      <div className="space-y-1">
        <Label className="text-xs font-medium opacity-80" htmlFor={captureTitleInputId}>Title</Label>
        <Input
          id={captureTitleInputId}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Client Interview - January 2026"
          aria-describedby={titleCountId}
          aria-invalid={transcriptTitleTooLong(title) ? true : undefined}
          disabled={isUploading}
        />
        <div className="flex items-start justify-between gap-3">
          {titleError ? <p role="alert" className="text-xs text-ember-red">{titleError}</p> : <span />}
          <CharacterCount id={titleCountId} length={title.trim().length} max={TEXT_LIMITS.transcriptTitle} />
        </div>
      </div>

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
