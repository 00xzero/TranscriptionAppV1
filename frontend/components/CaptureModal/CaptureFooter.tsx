import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { UploadBytes } from '@/lib/capture/useCapture'
import { formatUploadedBytes } from './shared'

interface CaptureFooterProps {
  isUploading: boolean
  isActionInProgress?: boolean
  isRecordMode?: boolean
  canSubmit: boolean
  onClose: () => void
  onSubmit: () => void
  buttonText: string
  disabledTooltip?: string
  /** Set while a file uploads: a bar on the footer's top edge and the count in the hint. */
  uploadBytes?: UploadBytes | null
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
  uploadBytes,
}: CaptureFooterProps) {
  const nativeTitle = disabledTooltip ?? (canSubmit
    ? isRecordMode ? 'Start Recording' : 'Begin transcription'
    : 'Select a file to continue')
  const isDisabled = !canSubmit || isActionInProgress

  const submitButton = (
    <Button
      variant="transcribe"
      size="sm"
      onClick={onSubmit}
      disabled={isDisabled}
      title={nativeTitle}
      className="min-w-[180px] rounded px-4 py-2"
    >
      {isUploading && (
        <svg className="-ml-1 mr-2 inline h-3 w-3 animate-spin text-solid-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      )}
      {buttonText}
    </Button>
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

  // A phone-width dialog has no room for the hint beside the actions, so it
  // sits above them until the dialog reaches its full width.
  const uploadedLabel = uploadBytes ? formatUploadedBytes(uploadBytes.sent, uploadBytes.total) : null

  return (
    <div className="relative flex flex-col gap-3 border-t border-border bg-subtle p-6 sm:flex-row sm:items-center sm:justify-between dark:bg-surface-alt">
      {uploadBytes && (
        <Progress
          value={uploadBytes.sent}
          max={Math.max(1, uploadBytes.total)}
          getValueLabel={() => `${uploadedLabel} uploaded`}
          aria-label="Upload progress"
          className="absolute inset-x-0 -top-px"
        />
      )}
      <div className="flex items-center gap-2 opacity-50">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-[10px] leading-tight tabular-nums sm:w-32 md:w-auto">
          {uploadedLabel ?? '60-min file ≈ 5 min process'}
        </span>
      </div>
      <div className="flex items-center justify-end gap-3">
        <button
          onClick={onClose}
          disabled={isActionInProgress}
          title="Cancel capture"
          className="text-xs font-medium transition-colors hover:text-foreground/70 disabled:opacity-50"
        >
          Cancel
        </button>
        {submitSlot}
      </div>
    </div>
  )
}
