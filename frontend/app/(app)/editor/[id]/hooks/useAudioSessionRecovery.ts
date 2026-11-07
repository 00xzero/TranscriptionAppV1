'use client'

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { pageAccountFetch } from '@/lib/auth/account-bound-fetch'
import { isAccountChangedError } from '@/lib/auth/account-boundary'

const URL_STALE_THRESHOLD_MS = 50 * 60 * 1000
const STABLE_SOURCE_MS = 60_000
const PLAY_WAIT_MS = 5_000

interface RecoveryOptions {
  transcriptId: string
  audioSrc: string | null
  audioElement: HTMLAudioElement | null
  onUrlRefreshed: (url: string) => void
  onRecoveryError?: (retry: () => void) => void
  onPositionHold?: (hold: boolean) => void
  lastPosition?: () => number | undefined
  wasPlaying?: () => boolean
  onResumeRejected?: () => void
}

type Recovery = {
  audio: HTMLAudioElement
  transcriptId: string
  usedAutomaticAttempt: boolean
  loadedAt?: number
  reported: boolean
  playIntent?: boolean
  restore?: { position: number; play: boolean }
  attempt?: AbortController
  playWaitExpired?: boolean
  removeSourceListeners?: () => void
}

/** Refreshes signed URLs and restores playback across source swaps. */
export function useAudioSessionRecovery({
  transcriptId, audioSrc, audioElement, onUrlRefreshed, onRecoveryError, onPositionHold, lastPosition, wasPlaying, onResumeRejected,
}: RecoveryOptions) {
  const session = useRef<Recovery | null>(null)
  const urlFetchedAt = useRef(Date.now())
  const callbacks = useRef({ onUrlRefreshed, onRecoveryError, onPositionHold, lastPosition, wasPlaying, onResumeRejected })
  useLayoutEffect(() => {
    callbacks.current = { onUrlRefreshed, onRecoveryError, onPositionHold, lastPosition, wasPlaying, onResumeRejected }
  }, [onUrlRefreshed, onRecoveryError, onPositionHold, lastPosition, wasPlaying, onResumeRejected])

  useEffect(() => {
    if (audioSrc) urlFetchedAt.current = Date.now()
  }, [audioSrc])

  useLayoutEffect(() => {
    if (!audioElement) return
    const current: Recovery = { audio: audioElement, transcriptId, usedAutomaticAttempt: false, reported: false }
    session.current = current
    return () => {
      session.current = null
      current.attempt?.abort()
      current.removeSourceListeners?.()
      callbacks.current.onPositionHold?.(false)
    }
  }, [audioElement, transcriptId])

  const refreshAudioUrl = useCallback(async function refresh(manual = false, resume = false) {
    const current = session.current
    if (!current || current.audio !== audioElement || current.transcriptId !== transcriptId) return
    const { audio } = current

    const holdPosition = () => {
      current.restore ??= {
        position: audio.currentTime || (audio.error && callbacks.current.lastPosition?.()) || 0,
        play: !audio.paused || (!!audio.error && !!callbacks.current.wasPlaying?.()),
      }
      callbacks.current.onPositionHold?.(true)
    }
    const reportFailure = () => {
      if (!audio.error || current.reported) return
      current.reported = true
      callbacks.current.onRecoveryError?.(() => {
        if (session.current === current && current.reported && audio.error) void refresh(true)
      })
    }
    const releasePosition = () => {
      current.restore = undefined
      current.playIntent = undefined
      callbacks.current.onPositionHold?.(false)
    }

    if (audio.error) holdPosition()
    if (resume) current.playIntent = true
    if (current.attempt) return

    const stable = current.loadedAt !== undefined && Date.now() - current.loadedAt >= STABLE_SOURCE_MS
    // Consume the load's credit even when this failure is suppressed.
    current.loadedAt = undefined
    if (!manual && current.usedAutomaticAttempt && !stable) {
      reportFailure()
      return
    }

    current.removeSourceListeners?.()
    current.usedAutomaticAttempt = true
    current.reported = false
    const attempt = new AbortController()
    current.attempt = attempt
    try {
      const response = await pageAccountFetch(`/api/transcripts/${transcriptId}/media-url`, { signal: attempt.signal })
      if (!response.ok) throw new Error(`Failed to refresh media URL: ${response.status}`)
      const { url } = await response.json()
      if (session.current !== current) return

      holdPosition()
      let newSourceStarted = false
      const playWait = window.setTimeout(() => { current.playWaitExpired = true }, PLAY_WAIT_MS)
      const releaseAttempt = () => {
        window.clearTimeout(playWait)
        if (current.attempt === attempt) current.attempt = undefined
        current.playWaitExpired = false
      }
      const finish = () => {
        releaseAttempt()
        audio.removeEventListener('loadstart', started)
        audio.removeEventListener('loadedmetadata', restorePosition)
        audio.removeEventListener('loadeddata', loaded)
        audio.removeEventListener('error', failed)
        audio.removeEventListener('abort', failed)
        current.removeSourceListeners = undefined
      }
      const started = () => { newSourceStarted = true }
      const restorePosition = () => {
        if (!newSourceStarted || session.current !== current || current.attempt !== attempt) return
        const restore = current.restore
        const play = current.playIntent ?? restore?.play
        if (restore) audio.currentTime = restore.position
        releaseAttempt()
        releasePosition()
        if (play) void audio.play().catch(() => {
          if (session.current === current) callbacks.current.onResumeRejected?.()
        })
      }
      const loaded = () => {
        if (!newSourceStarted || session.current !== current) return
        // Metadata releases the position hold. Media data starts the retry window.
        restorePosition()
        current.loadedAt = Date.now()
        current.reported = false
        finish()
      }
      const failed = () => {
        if (!newSourceStarted) return
        finish()
        if (audio.error) reportFailure()
        else releasePosition()
      }
      audio.addEventListener('loadstart', started)
      audio.addEventListener('loadedmetadata', restorePosition)
      audio.addEventListener('loadeddata', loaded)
      audio.addEventListener('error', failed)
      audio.addEventListener('abort', failed)
      current.removeSourceListeners = finish
      urlFetchedAt.current = Date.now()
      callbacks.current.onUrlRefreshed(url)
    } catch (error) {
      if (session.current !== current) return
      current.removeSourceListeners?.()
      current.attempt = undefined
      if (isAccountChangedError(error)) {
        session.current = null
        return
      }
      console.warn('[useAudioSessionRecovery] Failed to refresh URL:', error)
      if (audio.error) {
        holdPosition()
        reportFailure()
      } else {
        releasePosition()
      }
    }
  }, [audioElement, transcriptId])

  useEffect(() => {
    if (!audioElement) return
    const stale = () => Date.now() - urlFetchedAt.current > URL_STALE_THRESHOLD_MS
    const onVisible = () => {
      if (document.visibilityState === 'visible' && audioSrc && (stale() || audioElement.error)) {
        void refreshAudioUrl()
      }
    }
    const onStalled = () => { if (stale()) void refreshAudioUrl() }
    const onError = () => { void refreshAudioUrl() }
    document.addEventListener('visibilitychange', onVisible)
    audioElement.addEventListener('stalled', onStalled)
    audioElement.addEventListener('error', onError)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      audioElement.removeEventListener('stalled', onStalled)
      audioElement.removeEventListener('error', onError)
    }
  }, [audioElement, audioSrc, refreshAudioUrl])

  /** True when recovery owns the control press. A pending source may load late. */
  const toggleWhileRecovering = useCallback((playing: boolean) => {
    const current = session.current
    if (!current || (!current.restore && !current.audio.error)) return false
    if (current.playWaitExpired && !current.audio.error) {
      // Let the gesture reach the media element. Keep the late seek restore,
      // but let this press own playback instead of replaying the old intent.
      current.playIntent = false
      return false
    }
    if (playing) {
      current.playIntent = false
      current.audio.pause()
    } else {
      void refreshAudioUrl(true, true)
    }
    return true
  }, [refreshAudioUrl])

  return { toggleWhileRecovering }
}
