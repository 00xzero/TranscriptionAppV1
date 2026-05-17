import { useMemo } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import CaptureDetails from './CaptureDetails'
import KeyTermsInput from './KeyTermsInput'
import type { MicTestApi } from '@/lib/hooks/useMicTest'

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
  micTest: MicTestApi
  codecSupported: boolean | null
  recordingActive: boolean
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
  micTest,
  codecSupported,
  recordingActive,
}: RecordAudioPanelProps) {
  const selectValue = micTest.selectedDeviceId ?? 'default'
  const selectItems = useMemo(() => {
    if (!micTest.permissionGranted || micTest.devices.length === 0) {
      return [{ value: 'default', label: 'Default microphone' }]
    }
    return micTest.devices.map((d) => ({ value: d.deviceId, label: d.label }))
  }, [micTest.devices, micTest.permissionGranted])

  const handleDeviceChange = (value: string) => {
    if (value === 'default') return
    void micTest.changeDevice(value)
  }

  const handleTestClick = () => {
    void micTest.request()
  }

  const meterValue = Math.max(0, Math.min(100, micTest.level))
  const micControlsDisabled =
    isUploading || recordingActive || codecSupported === false

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="block text-[10px] font-mono uppercase tracking-wider opacity-60">Microphone</p>

        {codecSupported === false && (
          <div
            role="alert"
            className="rounded-sm border border-ember-red/40 bg-ember-red/10 px-3 py-2 text-xs text-ink dark:text-paper"
          >
            Audio recording isn&apos;t supported in this browser.
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs font-medium opacity-80" htmlFor={micSelectId}>Input device</Label>
          <Select
            value={selectValue}
            onValueChange={handleDeviceChange}
            disabled={micControlsDisabled}
          >
            <SelectTrigger
              id={micSelectId}
              aria-label="Microphone input device"
              className="w-full bg-white/50 dark:bg-[#222]/50 border-[#D1CEC5] dark:border-[#444] rounded-sm px-3 py-2 text-sm"
            >
              <SelectValue placeholder="Default microphone" />
            </SelectTrigger>
            <SelectContent>
              {selectItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={handleTestClick}
            disabled={micControlsDisabled || micTest.requesting}
            aria-label="Test microphone"
            className="text-xs font-medium px-3 py-2 rounded-sm shadow-xs transition-all active:scale-95 border border-[#D1CEC5] dark:border-[#444] bg-white/50 dark:bg-[#222]/50 hover:bg-ink/5 dark:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {micTest.requesting ? 'Requesting…' : 'Test microphone'}
          </button>
          <div className="flex-1 ml-3">
            <div
              role="meter"
              aria-label="Microphone input level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={meterValue}
              className="h-1.5 w-full rounded-full bg-ink/10 dark:bg-white/10 overflow-hidden"
            >
              <div
                className="h-full bg-trust-blue/60 transition-[width] duration-75"
                style={{ width: `${meterValue}%` }}
              />
            </div>
          </div>
        </div>

        {micTest.error && (
          <div
            role="alert"
            className="rounded-sm border border-ember-red/40 bg-ember-red/10 px-3 py-2 text-xs text-ink dark:text-paper"
          >
            {micTest.error.message}
          </div>
        )}
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
