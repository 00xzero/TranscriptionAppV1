import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import CaptureDetails from './CaptureDetails'
import KeyTermsInput from './KeyTermsInput'

const micSelectId = 'capture-mic-select'

interface RecordAudioPanelProps {
  title: string
  setTitle: (value: string) => void
  keyTerms: string[]
  keyTermInput: string
  setKeyTermInput: (value: string) => void
  keyTermsError: string | null
  handleKeyTermKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleAddTermClick: () => void
  removeTerm: (index: number) => void
  isUploading: boolean
}

export default function RecordAudioPanel({
  title,
  setTitle,
  keyTerms,
  keyTermInput,
  setKeyTermInput,
  keyTermsError,
  handleKeyTermKeyDown,
  handleAddTermClick,
  removeTerm,
  isUploading,
}: RecordAudioPanelProps) {
  const noop = () => {}

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="block text-[10px] font-mono uppercase tracking-wider opacity-60">Microphone</p>

        <div className="space-y-1">
          <Label className="text-xs font-medium opacity-80" htmlFor={micSelectId}>Input device</Label>
          <Select value="default" onValueChange={noop}>
            <SelectTrigger
              id={micSelectId}
              aria-label="Microphone input device"
              className="w-full bg-white/50 dark:bg-[#222]/50 border-[#D1CEC5] dark:border-[#444] rounded-sm px-3 py-2 text-sm"
            >
              <SelectValue placeholder="Default microphone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default microphone</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={noop}
            aria-label="Test microphone"
            className="text-xs font-medium px-3 py-2 rounded-sm shadow-xs transition-all active:scale-95 border border-[#D1CEC5] dark:border-[#444] bg-white/50 dark:bg-[#222]/50 hover:bg-ink/5 dark:hover:bg-white/5"
          >
            Test microphone
          </button>
          <div className="flex-1 ml-3">
            <div
              role="meter"
              aria-label="Microphone input level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={0}
              className="h-1.5 w-full rounded-full bg-ink/10 dark:bg-white/10 overflow-hidden"
            >
              <div className="h-full w-0 bg-trust-blue/60" />
            </div>
          </div>
        </div>
      </div>

      <CaptureDetails
        title={title}
        setTitle={setTitle}
        isUploading={isUploading}
      />
      <KeyTermsInput
        keyTerms={keyTerms}
        keyTermInput={keyTermInput}
        setKeyTermInput={setKeyTermInput}
        keyTermsError={keyTermsError}
        isUploading={isUploading}
        onKeyDown={handleKeyTermKeyDown}
        onAddClick={handleAddTermClick}
        onRemoveTerm={removeTerm}
      />
    </div>
  )
}
