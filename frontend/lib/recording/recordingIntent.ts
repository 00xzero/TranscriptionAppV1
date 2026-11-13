/** A persisted key must fit the create contract and be safe in a path and header. */
export function isValidRecordingIntent(intent: string | null): intent is string {
  return intent !== null && /^[A-Za-z0-9._-]{1,200}$/.test(intent)
}

/** A valid intent produces the same Storage filename across stop and recovery. */
export function recordingMediaFilename(intent: string | null, codecExtension: string | null): string {
  const stem = isValidRecordingIntent(intent) ? `recording-${intent}` : 'recording'
  return `${stem}.${codecExtension ?? 'webm'}`
}
