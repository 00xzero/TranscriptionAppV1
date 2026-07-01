import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface CaptureFooterProps {
  isUploading: boolean
  isActionInProgress?: boolean
  isRecordMode?: boolean
  canSubmit: boolean
  onClose: () => void
  onSubmit: () => void
  buttonText: string
  disabledTooltip?: string
}

export default function CaptureFooter({
  isUploading,
  isActionInProgress = isUploading,
  isRecordMode = false,
  canSubmit,
  onClose,
  onSubmit,
  buttonText,
  disabledTooltip,
}: CaptureFooterProps) {
  const nativeTitle = disabledTooltip ?? (canSubmit
    ? isRecordMode ? 'Start Recording' : 'Begin transcription'
    : 'Select a file to continue')
  const isDisabled = !canSubmit || isActionInProgress

  const submitButton = (
    <button
      onClick={onSubmit}
      disabled={isDisabled}
      title={nativeTitle}
      className={`min-w-[180px] text-xs font-medium px-4 py-2 rounded shadow-xs transition-all active:scale-95 ${canSubmit
        ? 'bg-transcribe text-white/90 border border-transcribe-hover hover:bg-transcribe-hover hover:text-white'
        : 'bg-transcribe/50 text-white/50 border border-transcribe-hover/50 cursor-not-allowed'
        }`}
    >
      {isUploading && (
        <svg className="animate-spin -ml-1 mr-2 h-3 w-3 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      )}
      {buttonText}
    </button>
  )

  const submitSlot = disabledTooltip && isDisabled ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          {submitButton}
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabledTooltip}</TooltipContent>
    </Tooltip>
  ) : (
    submitButton
  )

  return (
    <div className="p-6 bg-ink/5 dark:bg-[#0f0f0f] border-t border-[#D1CEC5] dark:border-white/5 flex items-center justify-between">
      <div className="flex items-center gap-2 opacity-50">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-[10px] w-32 md:w-auto leading-tight">60-min file ≈ 5 min process</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          disabled={isActionInProgress}
          title="Cancel capture"
          className="text-xs font-medium hover:text-ink/70 dark:hover:text-white/70 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        {submitSlot}
      </div>
    </div>
  )
}
