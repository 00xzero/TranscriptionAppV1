"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { getAudioContextConstructor } from '@/lib/recording/audioContext'
import { PREFERRED_DEVICE_KEY } from '@/lib/recording/preferredDevice'
import { buildRecordingMicConstraints } from '@/lib/recording/micConstraints'

export { PREFERRED_DEVICE_KEY }

export interface MicDevice {
  deviceId: string
  label: string
}

export type MicTestError =
  | { kind: 'permission_denied'; message: string }
  | { kind: 'no_devices'; message: string }
  | { kind: 'unsupported'; message: string }
  | { kind: 'unknown'; message: string }

export interface MicTestState {
  permissionGranted: boolean
  devices: MicDevice[]
  selectedDeviceId: string | null
  level: number
  error: MicTestError | null
  requesting: boolean
  stream: MediaStream | null
}

export interface MicTestApi extends MicTestState {
  request: () => Promise<MicRequestResult>
  changeDevice: (deviceId: string | null) => Promise<AcquiredMic | null>
  /** Mark the stream as transferred to the recorder so cleanup doesn't stop tracks. */
  transferStream: () => MediaStream | null
  release: () => void
}

export interface AcquiredMic {
  stream: MediaStream
  deviceId: string | null
}

export type MicRequestResult =
  | { ok: true; acquired: AcquiredMic }
  | { ok: false; error: MicTestError }

function readSavedDeviceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(PREFERRED_DEVICE_KEY)
  } catch {
    return null
  }
}

function persistDeviceId(id: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (id) {
      window.localStorage.setItem(PREFERRED_DEVICE_KEY, id)
    } else {
      window.localStorage.removeItem(PREFERRED_DEVICE_KEY)
    }
  } catch {
    // localStorage may be disabled — non-fatal
  }
}

export function useMicTest(): MicTestApi {
  const [permissionGranted, setPermissionGranted] = useState(false)
  const [devices, setDevices] = useState<MicDevice[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<MicTestError | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastLevelRef = useRef(0)
  const transferredRef = useRef(false)
  const requestGenerationRef = useRef(0)

  const stopTracks = useCallback((s: MediaStream) => {
    s.getTracks().forEach((t) => {
      try { t.stop() } catch { /* ignore */ }
    })
  }, [])

  const stopMeter = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect() } catch { /* ignore */ }
      sourceRef.current = null
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect() } catch { /* ignore */ }
      analyserRef.current = null
    }
    if (audioCtxRef.current) {
      const ctx = audioCtxRef.current
      audioCtxRef.current = null
      ctx.close().catch(() => {})
    }
    lastLevelRef.current = 0
    setLevel(0)
  }, [])

  const stopStream = useCallback(() => {
    if (streamRef.current && !transferredRef.current) {
      stopTracks(streamRef.current)
    }
    streamRef.current = null
    setStream(null)
  }, [stopTracks])

  const startMeter = useCallback((s: MediaStream) => {
    const AudioContextCtor = getAudioContextConstructor()
    if (!AudioContextCtor) return

    stopMeter()
    const ctx = new AudioContextCtor()
    const source = ctx.createMediaStreamSource(s)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)

    audioCtxRef.current = ctx
    sourceRef.current = source
    analyserRef.current = analyser

    const buffer = new Uint8Array(analyser.fftSize)

    const tick = () => {
      if (!analyserRef.current) return
      analyserRef.current.getByteTimeDomainData(buffer)
      let peak = 0
      for (let i = 0; i < buffer.length; i++) {
        const v = Math.abs(buffer[i] - 128) / 128
        if (v > peak) peak = v
      }
      const next = Math.min(100, Math.round(peak * 140))
      if (next !== lastLevelRef.current) {
        lastLevelRef.current = next
        setLevel(next)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stopMeter])

  const enumerate = useCallback(async (currentDeviceId: string | null) => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return
    }
    const list = await navigator.mediaDevices.enumerateDevices()
    const inputs: MicDevice[] = list
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label || 'Microphone',
      }))
    setDevices(inputs)

    const saved = readSavedDeviceId()
    let resolvedId = currentDeviceId
    if (saved && inputs.some((d) => d.deviceId === saved)) {
      resolvedId = resolvedId ?? saved
    } else if (saved && !inputs.some((d) => d.deviceId === saved)) {
      persistDeviceId(null)
    }
    if (resolvedId == null && inputs.length > 0) {
      resolvedId = inputs[0].deviceId
    }
    setSelectedDeviceId(resolvedId)
  }, [])

  const acquireRaw = useCallback(async (deviceId: string | null): Promise<MediaStream> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw { kind: 'unsupported', message: 'Audio recording is not supported in this browser.' } satisfies MicTestError
    }
    try {
      const constraints = buildRecordingMicConstraints(deviceId)
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      const name = (err as { name?: string })?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw {
          kind: 'permission_denied',
          message:
            'Microphone access was denied. Enable mic permission in your browser to continue.',
        } satisfies MicTestError
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw { kind: 'no_devices', message: 'No microphone was found.' } satisfies MicTestError
      }
      throw {
        kind: 'unknown',
        message: (err as Error)?.message ?? 'Failed to access microphone.',
      } satisfies MicTestError
    }
  }, [])

  // Wraps acquireRaw with stale-deviceId fallback: if a saved id no longer
  // matches an available device, clear it and retry without a constraint.
  const acquireWithFallback = useCallback(
    async (deviceId: string | null): Promise<{ stream: MediaStream; deviceId: string | null }> => {
      try {
        const stream = await acquireRaw(deviceId)
        return { stream, deviceId }
      } catch (err) {
        const e = err as MicTestError
        if (e.kind === 'no_devices' && deviceId) {
          persistDeviceId(null)
          const stream = await acquireRaw(null)
          return { stream, deviceId: null }
        }
        throw err
      }
    },
    [acquireRaw]
  )

  // Stop any currently-held, not-yet-transferred stream and tear down the
  // analyser graph. Used before re-acquiring so repeated requests don't leak
  // live mic tracks, and on failure paths so callers don't see a dead stream.
  const dropCurrentStream = useCallback(() => {
    if (streamRef.current && !transferredRef.current) {
      stopTracks(streamRef.current)
    }
    streamRef.current = null
    transferredRef.current = false
    setStream(null)
    stopMeter()
  }, [stopMeter, stopTracks])

  const request = useCallback(async (): Promise<MicRequestResult> => {
    const generation = ++requestGenerationRef.current
    setRequesting(true)
    setError(null)
    // Drop any prior live stream before acquiring a new one — otherwise
    // repeated Test microphone clicks leak open mic tracks.
    dropCurrentStream()
    try {
      const savedId = readSavedDeviceId()
      const { stream: s } = await acquireWithFallback(savedId)
      if (generation !== requestGenerationRef.current) {
        stopTracks(s)
        return {
          ok: false,
          error: { kind: 'unknown', message: 'Microphone request was canceled.' },
        }
      }
      transferredRef.current = false
      streamRef.current = s
      setStream(s)
      setPermissionGranted(true)
      const firstTrack = s.getAudioTracks()[0]
      const actualId = firstTrack?.getSettings?.().deviceId ?? null
      await enumerate(actualId)
      if (generation !== requestGenerationRef.current) {
        return {
          ok: false,
          error: { kind: 'unknown', message: 'Microphone request was canceled.' },
        }
      }
      if (actualId) persistDeviceId(actualId)
      startMeter(s)
      return { ok: true, acquired: { stream: s, deviceId: actualId } }
    } catch (err) {
      if (generation !== requestGenerationRef.current) {
        return {
          ok: false,
          error: { kind: 'unknown', message: 'Microphone request was canceled.' },
        }
      }
      const e = err as MicTestError
      setError(e)
      setPermissionGranted(e.kind !== 'permission_denied' && permissionGranted)
      // Ensure we don't expose a dead stream after a failed acquire.
      dropCurrentStream()
      return { ok: false, error: e }
    } finally {
      if (generation === requestGenerationRef.current) {
        setRequesting(false)
      }
    }
  }, [acquireWithFallback, dropCurrentStream, enumerate, permissionGranted, startMeter, stopTracks])

  const changeDevice = useCallback(async (deviceId: string | null): Promise<AcquiredMic | null> => {
    const generation = ++requestGenerationRef.current
    setRequesting(true)
    setError(null)
    // Stop the previous stream so its tracks don't keep running alongside the
    // new one. If acquire fails, dropCurrentStream() ensures we don't surface
    // a stopped stream as the current one.
    dropCurrentStream()
    try {
      const { stream: s, deviceId: resolvedId } = await acquireWithFallback(deviceId)
      if (generation !== requestGenerationRef.current) {
        stopTracks(s)
        return null
      }
      const selectedId = deviceId === null ? null : resolvedId
      transferredRef.current = false
      streamRef.current = s
      setStream(s)
      setSelectedDeviceId(selectedId)
      persistDeviceId(selectedId)
      startMeter(s)
      return { stream: s, deviceId: selectedId }
    } catch (err) {
      if (generation !== requestGenerationRef.current) {
        return null
      }
      setError(err as MicTestError)
      dropCurrentStream()
      return null
    } finally {
      if (generation === requestGenerationRef.current) {
        setRequesting(false)
      }
    }
  }, [acquireWithFallback, dropCurrentStream, startMeter, stopTracks])

  const transferStream = useCallback((): MediaStream | null => {
    transferredRef.current = true
    const s = streamRef.current
    stopMeter()
    // Keep streamRef so getTracks() etc. still work on the returned stream,
    // but mark transferred so release() won't stop the tracks.
    return s
  }, [stopMeter])

  const release = useCallback(() => {
    requestGenerationRef.current += 1
    stopMeter()
    stopStream()
    setRequesting(false)
  }, [stopMeter, stopStream])

  useEffect(() => {
    return () => {
      stopMeter()
      stopStream()
    }
  }, [stopMeter, stopStream])

  return {
    permissionGranted,
    devices,
    selectedDeviceId,
    level,
    error,
    requesting,
    stream,
    request,
    changeDevice,
    transferStream,
    release,
  }
}
