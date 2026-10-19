/** Lets the submit handlers move focus to the title field when it is over the limit. */
export const captureTitleInputId = 'capture-title-input'

/** "48 of 182 MB": the part sent, in the whole file's unit. */
export function formatUploadedBytes(sentBytes: number, totalBytes: number): string {
  const [totalShown, unit] = formatFileSize(totalBytes).split(' ')
  // Rounded down until it is all in, so the count never says done too early.
  if (sentBytes >= totalBytes) return `${totalShown} of ${totalShown} ${unit}`
  const scale = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[unit] ?? 1
  const sent = sentBytes / scale
  const shown = unit === 'GB' ? (Math.floor(sent * 10) / 10).toFixed(1) : String(Math.floor(sent))
  return `${shown} of ${totalShown} ${unit}`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
