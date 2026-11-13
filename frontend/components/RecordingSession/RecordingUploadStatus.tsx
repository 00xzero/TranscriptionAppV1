import { Progress } from '@/components/ui/progress'
import { formatUploadedBytes } from '@/lib/utils'
import type { SessionSnapshot } from '@/lib/recording/sessionTypes'
import { RECORDING_UPLOAD_MESSAGES } from '@/lib/recording/uploadProgress'

export default function RecordingUploadStatus({
  phase,
  bytes,
  fallback = 'Uploading…',
}: {
  phase: SessionSnapshot['uploadPhase']
  bytes: SessionSnapshot['uploadBytes']
  fallback?: string
}) {
  const byteLabel = bytes ? formatUploadedBytes(bytes.sent, bytes.total) : null
  const message = phase && phase !== 'uploading'
    ? RECORDING_UPLOAD_MESSAGES[phase]
    : bytes && bytes.sent >= bytes.total
      ? 'Starting transcription…'
      : byteLabel ? `Uploading… ${byteLabel}` : phase ? RECORDING_UPLOAD_MESSAGES[phase] : fallback

  return (
    <div className="flex w-full flex-col gap-2" data-testid={bytes ? 'recording-upload-progress' : 'recording-spinner'}>
      {bytes && (
        <Progress
          value={bytes.sent}
          max={Math.max(1, bytes.total)}
          getValueLabel={() => `${byteLabel} uploaded`}
          aria-label="Upload progress"
          className="rounded-full"
        />
      )}
      <div className="flex items-center gap-3 text-sm tabular-nums text-muted">
        {!bytes && (
          <div aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-ember-red border-t-transparent" />
        )}
        <span role={bytes && phase === 'uploading' ? undefined : 'status'}>{message}</span>
      </div>
    </div>
  )
}
