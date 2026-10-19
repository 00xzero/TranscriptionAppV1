import { useRef } from 'react'
import {
  TRANSCRIPTION_LANGUAGES,
  TRANSCRIPTION_LANGUAGE_LABELS,
  TranscriptionLanguageSchema,
  fillerWordsApply,
  type TranscriptionOptions,
} from '@/contracts/transcription-options'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const languageSelectId = 'capture-language'
// Just past the content's 150ms opening animation.
const OPEN_SETTLE_MS = 170

interface CaptureAdvancedOptionsProps {
  options: TranscriptionOptions
  onOptionsChange: (options: TranscriptionOptions) => void
  disabled: boolean
}

/** The closed row's one line: the language and speakers, then anything else changed. */
export function summarizeTranscriptionOptions(options: TranscriptionOptions): string {
  const parts = [
    TRANSCRIPTION_LANGUAGE_LABELS[options.language],
    options.detect_speakers ? 'speakers on' : 'speakers off',
  ]
  if (fillerWordsApply(options.language) && !options.keep_filler_words) parts.push('no um/uh')
  if (options.mask_profanity) parts.push('profanity masked')
  return parts.join(' · ')
}

function OptionSwitch({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string
  hint: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-xs font-medium opacity-80">{label}</p>
        <p className="text-[10px] text-foreground/40">{hint}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
        className="data-[state=checked]:bg-ember-red"
      />
    </div>
  )
}

// Closed whenever the dialog opens: the dialog's content mounts afresh each time.
export default function CaptureAdvancedOptions({ options, onOptionsChange, disabled }: CaptureAdvancedOptionsProps) {
  const set = (patch: Partial<TranscriptionOptions>) => onOptionsChange({ ...options, ...patch })
  const fillersApply = fillerWordsApply(options.language)
  const itemRef = useRef<HTMLDivElement>(null)

  // The section sits at the foot of the dialog's scroll area, so once open it
  // is brought into view rather than left below the fold.
  const revealWhenOpened = (value: string) => {
    if (!value) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    window.setTimeout(() => {
      itemRef.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
    }, reduced ? 0 : OPEN_SETTLE_MS)
  }

  return (
    <Accordion type="single" collapsible onValueChange={revealWhenOpened} className="border-t border-border">
      <AccordionItem ref={itemRef} value="advanced" className="border-b-0">
        <AccordionTrigger className="mt-2">
          <span className="text-[10px] font-mono uppercase tracking-wider opacity-60">Advanced</span>
          <span className="ml-auto truncate text-[11px] text-foreground/40">{summarizeTranscriptionOptions(options)}</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 pt-2">
          <div className="space-y-1">
            <Label className="text-xs font-medium opacity-80" htmlFor={languageSelectId}>Language</Label>
            <Select
              value={options.language}
              onValueChange={(value) => {
                const language = TranscriptionLanguageSchema.safeParse(value)
                if (language.success) set({ language: language.data })
              }}
              disabled={disabled}
            >
              <SelectTrigger id={languageSelectId} className="w-full bg-field/50 border-border rounded-sm px-3 py-2 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSCRIPTION_LANGUAGES.map((language) => (
                  <SelectItem key={language} value={language}>
                    {TRANSCRIPTION_LANGUAGE_LABELS[language]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {options.language === 'multi' && (
              <p className="text-[10px] text-foreground/40">
                For audio that switches between English, Spanish, French, German, Portuguese, Italian, Dutch, Japanese, Hindi and Russian.
              </p>
            )}
          </div>

          <OptionSwitch
            label="Detect speakers"
            hint="Split the transcript by who's talking"
            checked={options.detect_speakers}
            onCheckedChange={(checked) => set({ detect_speakers: checked })}
            disabled={disabled}
          />
          <OptionSwitch
            label="Keep filler words"
            hint={fillersApply ? 'Keep "um" and "uh"' : 'English only'}
            checked={fillersApply && options.keep_filler_words}
            onCheckedChange={(checked) => set({ keep_filler_words: checked })}
            disabled={disabled || !fillersApply}
          />
          <OptionSwitch
            label="Mask profanity"
            hint="Swear words become ****"
            checked={options.mask_profanity}
            onCheckedChange={(checked) => set({ mask_profanity: checked })}
            disabled={disabled}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
