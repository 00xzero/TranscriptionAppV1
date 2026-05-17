export interface CodecSelection {
  mime: string
  extension: 'webm' | 'mp4'
}

const PRIORITY: CodecSelection[] = [
  { mime: 'audio/webm;codecs=opus', extension: 'webm' },
  { mime: 'audio/mp4', extension: 'mp4' },
  { mime: 'audio/webm', extension: 'webm' },
]

export function selectCodec(): CodecSelection | null {
  if (typeof window === 'undefined') return null
  if (typeof window.MediaRecorder === 'undefined') return null

  for (const candidate of PRIORITY) {
    try {
      if (window.MediaRecorder.isTypeSupported(candidate.mime)) {
        return candidate
      }
    } catch {
      // Some browsers throw on unrecognized MIMEs — treat as unsupported.
    }
  }

  return null
}

export function findCodecByMime(mime: string | null | undefined): CodecSelection | null {
  if (!mime) return null
  if (typeof window === 'undefined') return null
  if (typeof window.MediaRecorder === 'undefined') return null

  try {
    if (window.MediaRecorder.isTypeSupported(mime)) {
      const match = PRIORITY.find((c) => c.mime === mime)
      if (match) return match
      const extension: 'webm' | 'mp4' = mime.startsWith('audio/mp4') ? 'mp4' : 'webm'
      return { mime, extension }
    }
  } catch {
    // fall through
  }

  return null
}
