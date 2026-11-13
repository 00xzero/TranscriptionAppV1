export function savedCaptureMessage(outcome: string | null): string | null {
  if (outcome === 'saved_needs_retry') {
    return 'Upload completed and transcript was saved, but transcription did not start automatically. Click Transcribe to retry.'
  }
  if (outcome === 'saved_status_unknown') {
    return 'Upload completed and transcript was saved, but transcription status is unknown due to a network interruption. Check the transcript status before retrying.'
  }
  return null
}
