import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const titleInputId = 'capture-title-input'

interface CaptureDetailsProps {
  title: string
  setTitle: (value: string) => void
  isUploading: boolean
}

export default function CaptureDetails({ title, setTitle, isUploading }: CaptureDetailsProps) {
  return (
    <div className="space-y-4 pt-2 border-t border-[#D1CEC5] dark:border-white/10">
      <p className="block text-[10px] font-mono uppercase tracking-wider opacity-60 mt-4">Transcript Details</p>

      <div className="space-y-1">
        <Label className="text-xs font-medium opacity-80" htmlFor={titleInputId}>Title</Label>
        <input
          id={titleInputId}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Client Interview - January 2026"
          disabled={isUploading}
          className="w-full bg-white/50 dark:bg-[#222]/50 border border-[#D1CEC5] dark:border-[#444] rounded-sm px-3 py-2 text-sm focus:outline-hidden focus:border-trust-blue focus:bg-white dark:focus:bg-[#222] transition-colors placeholder:text-ink/30 dark:placeholder:text-white/20 disabled:opacity-50"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs font-medium opacity-80">
          Language <span className="text-[10px] font-mono opacity-50 ml-1">(coming soon)</span>
        </Label>
        <Select disabled>
          <SelectTrigger aria-label="Language" className="w-full bg-white/50 dark:bg-[#222]/50 border-[#D1CEC5] dark:border-[#444] rounded-sm px-3 py-2 text-sm cursor-not-allowed opacity-60">
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
          <p className="text-[10px] text-ink/40 dark:text-white/40">Automatically identify speakers</p>
        </div>
        <Switch disabled checked aria-label="Speaker diarization" className="data-[state=checked]:bg-ember-red" />
      </div>
    </div>
  )
}
