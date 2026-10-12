/** Keep readable Unicode names without path separators or header punctuation. */
export function normalizeDownloadTitle(title: string): string {
  const normalized = title.normalize('NFC')
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return Array.from(normalized).slice(0, 100).join('') || 'Transcript'
}

/** Prefer the UTF-8 name, while accepting older servers and malformed headers. */
export function getDownloadFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null
  const encoded = contentDisposition.match(/(?:^|;)\s*filename\*\s*=\s*UTF-8'[^']*'([^;]*)/i)
  if (encoded) {
    try {
      const filename = decodeURIComponent(encoded[1].trim())
      if (filename) return filename
    } catch {
      // A malformed extended name must not prevent an otherwise valid download.
    }
  }
  const plain = contentDisposition.match(/(?:^|;)\s*filename\s*=\s*(?:"([^"\r\n]*)"|([^;\r\n]*))/i)
  return (plain?.[1] ?? plain?.[2])?.trim() || null
}
