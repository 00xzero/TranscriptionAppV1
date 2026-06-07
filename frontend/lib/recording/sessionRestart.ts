import { findCodecByMime, selectCodec } from './codecs'
import { buildRecordingMicConstraints } from './micConstraints'
import { PREFERRED_DEVICE_KEY } from './preferredDevice'
import { readDraft, writeDraft } from './sessionDraft'
import {
  attachAndStart,
  RecordingAlreadyActiveError,
} from './sessionActions'
import { stopStreamTracks } from './sessionRuntime'
import { setSnapshot, store } from './sessionStore'
import type { RestartInterruptedResult } from './sessionTypes'

function getMediaErrorName(err: unknown): string | undefined {
  return (err as { name?: string })?.name
}

function isPermissionDeniedError(name: string | undefined): boolean {
  return name === 'NotAllowedError' || name === 'SecurityError'
}

function isMissingSavedDeviceError(name: string | undefined): boolean {
  return name === 'NotFoundError' || name === 'OverconstrainedError'
}

function mediaAcquireFailure(
  name: string | undefined
): RestartInterruptedResult {
  if (isPermissionDeniedError(name)) {
    return {
      ok: false,
      reason: 'permission_denied',
      message:
        'Microphone access was denied. Enable mic permission in your browser to continue.',
    }
  }

  return {
    ok: false,
    reason: 'no_media_devices',
    message: 'No microphone was found.',
  }
}

function clearSavedPreferredDevice(): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(PREFERRED_DEVICE_KEY)
    }
  } catch {
    // ignore
  }
}

// Real interrupted-restart path. Re-requests mic permission, re-selects codec,
// and starts a fresh recording with the preserved metadata — without sending
// the user back through Capture (per spec).
export async function restartInterruptedRecording(
  maxBytes: number
): Promise<RestartInterruptedResult> {
  if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      reason: 'no_media_devices',
      message: 'Audio recording is not supported in this environment.',
    }
  }

  const draft = readDraft()
  const snap = store.snapshot
  const preservedTitle = snap.title ?? draft?.title ?? null
  const preservedGeneratedTitle =
    snap.generatedTitle ?? draft?.generatedTitle ?? null
  const preservedKeyTerms =
    snap.keyTerms.length > 0 ? snap.keyTerms : draft?.keyTerms ?? []
  const preservedDeviceId = store.runtime.deviceId ?? draft?.deviceId ?? null
  const preservedCodecMime =
    store.runtime.codecMime ?? draft?.codecMime ?? null

  async function tryAcquire(deviceId: string | null): Promise<MediaStream> {
    const constraints = buildRecordingMicConstraints(deviceId)
    return navigator.mediaDevices.getUserMedia(constraints)
  }

  let stream: MediaStream
  let resolvedDeviceId = preservedDeviceId
  try {
    stream = await tryAcquire(preservedDeviceId)
  } catch (err) {
    const name = getMediaErrorName(err)
    if (preservedDeviceId && isMissingSavedDeviceError(name)) {
      // Saved device is gone — clear and retry with the browser default.
      clearSavedPreferredDevice()
      resolvedDeviceId = null
      try {
        stream = await tryAcquire(null)
      } catch (fallbackErr) {
        return mediaAcquireFailure(getMediaErrorName(fallbackErr))
      }
    } else {
      return mediaAcquireFailure(name)
    }
  }

  const codec = findCodecByMime(preservedCodecMime) ?? selectCodec()
  if (!codec) {
    stopStreamTracks(stream)
    return {
      ok: false,
      reason: 'no_codec',
      message: "Audio recording isn't supported in this browser.",
    }
  }

  try {
    attachAndStart({
      stream,
      codec,
      title: preservedTitle,
      keyTerms: preservedKeyTerms,
      deviceId: resolvedDeviceId,
      maxBytes,
    })
    if (preservedGeneratedTitle) {
      setSnapshot({ ...store.snapshot, generatedTitle: preservedGeneratedTitle })
      writeDraft({
        title: preservedTitle,
        generatedTitle: preservedGeneratedTitle,
        keyTerms: preservedKeyTerms,
        codecMime: codec.mime,
        deviceId: resolvedDeviceId,
      })
    }
  } catch (err) {
    // Clean up the freshly acquired stream — it has no owner if attach throws.
    stopStreamTracks(stream)
    if (err instanceof RecordingAlreadyActiveError) {
      return {
        ok: false,
        reason: 'already_active',
        message: err.message,
      }
    }
    return {
      ok: false,
      reason: 'attach_failed',
      message:
        (err as Error)?.message ??
        'Could not start the recorder. Try again.',
    }
  }

  return { ok: true }
}
