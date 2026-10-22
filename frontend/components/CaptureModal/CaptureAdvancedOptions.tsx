import { useRef } from 'react'
import {
  TRANSCRIPTION_ENGINES,
  TRANSCRIPTION_ENGINE_BRANDS,
  TRANSCRIPTION_ENGINE_LABELS,
  TRANSCRIPTION_LANGUAGES,
  TRANSCRIPTION_LANGUAGE_LABELS,
  TranscriptionEngineSchema,
  TranscriptionLanguageSchema,
  type TranscriptionOptions,
} from '@/contracts/transcription-options'
import { fillerWordsAlwaysKept, fillerWordsApply, profanityMaskingApplies } from '@/core/transcription/engines/capabilities'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const engineSelectId = 'capture-engine'
const languageSelectId = 'capture-language'
// Just past the content's 150ms opening animation.
const OPEN_SETTLE_MS = 170

interface CaptureAdvancedOptionsProps {
  options: TranscriptionOptions
  onOptionsChange: (options: TranscriptionOptions) => void
  disabled: boolean
}

/** The closed row's one line: the engine, language and speakers, then anything else changed. */
export function summarizeTranscriptionOptions(options: TranscriptionOptions): string {
  const parts = [
    TRANSCRIPTION_ENGINE_LABELS[options.engine],
    TRANSCRIPTION_LANGUAGE_LABELS[options.language],
    options.detect_speakers ? 'speakers on' : 'speakers off',
  ]
  if (fillerWordsApply(options.engine, options.language) && !options.keep_filler_words) parts.push('no um/uh')
  if (profanityMaskingApplies(options.engine, options.language) && options.mask_profanity) parts.push('profanity masked')
  return parts.join(' · ')
}

/** The hint a switch shows when the chosen engine can't do what it does. */
function unavailableHint(options: TranscriptionOptions): string {
  return `Not available with ${TRANSCRIPTION_ENGINE_BRANDS[options.engine]}`
}

/** What the filler words switch says under its label. */
function fillerWordsHint(options: TranscriptionOptions): string {
  if (fillerWordsAlwaysKept(options.engine, options.language)) {
    return `Always kept with ${TRANSCRIPTION_ENGINE_BRANDS[options.engine]}`
  }
  if (fillerWordsApply(options.engine, options.language)) return 'Keep "um" and "uh"'
  return options.engine === 'deepgram' ? 'English only' : unavailableHint(options)
}

/** Mixed languages: which ones each engine follows. */
const MULTI_LANGUAGE_HINTS: Record<TranscriptionOptions['engine'], string> = {
  deepgram: 'For audio that switches between English, Spanish, French, German, Portuguese, Italian, Dutch, Japanese, Hindi and Russian.',
  soniox: 'For audio that switches between languages. Each passage is transcribed in the language spoken.',
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
  const fillersApply = fillerWordsApply(options.engine, options.language)
  const fillersAlwaysKept = fillerWordsAlwaysKept(options.engine, options.language)
  const profanityApplies = profanityMaskingApplies(options.engine, options.language)
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
            <Label className="text-xs font-medium opacity-80" htmlFor={engineSelectId}>Engine</Label>
            <Select
              value={options.engine}
              onValueChange={(value) => {
                const engine = TranscriptionEngineSchema.safeParse(value)
                if (engine.success) set({ engine: engine.data })
              }}
              disabled={disabled}
            >
              <SelectTrigger id={engineSelectId} className="w-full bg-field/50 border-border rounded-sm px-3 py-2 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSCRIPTION_ENGINES.map((engine) => (
                  <SelectItem key={engine} value={engine}>
                    {TRANSCRIPTION_ENGINE_LABELS[engine]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
              <p className="text-[10px] text-foreground/40">{MULTI_LANGUAGE_HINTS[options.engine]}</p>
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
            hint={fillerWordsHint(options)}
            checked={fillersAlwaysKept || (fillersApply && options.keep_filler_words)}
            onCheckedChange={(checked) => set({ keep_filler_words: checked })}
            disabled={disabled || !fillersApply}
          />
          <OptionSwitch
            label="Mask profanity"
            hint={profanityApplies ? 'Swear words become ****' : unavailableHint(options)}
            checked={profanityApplies && options.mask_profanity}
            onCheckedChange={(checked) => set({ mask_profanity: checked })}
            disabled={disabled || !profanityApplies}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
