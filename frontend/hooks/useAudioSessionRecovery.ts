'use client'

import { useEffect, useRef, useCallback } from 'react'

/**
 * Hook to detect when user returns to the tab after idle time and
 * refresh the audio URL if it may have expired.
 * 
 * Supabase signed URLs expire after 1 hour. This hook:
 * 1. Tracks when the URL was last fetched
 * 2. On visibility change (tab becomes visible), checks if URL is stale
 * 3. Fetches a fresh URL and preserves playback position
 */

// URL is considered stale if older than 50 minutes (buffer before 60-min expiry)
const URL_STALE_THRESHOLD_MS = 50 * 60 * 1000
const RECOVERY_WAIT_TIMEOUT_MS = 5000

interface UseAudioSessionRecoveryOptions {
  /** Project ID to fetch fresh URL for */
  projectId: string
  /** Current audio source URL */
  audioSrc: string | null
  /** Audio element to manage (from AudioPlayer) */
  audioElement: HTMLAudioElement | null
  /** Callback when a fresh URL is fetched */
  onUrlRefreshed: (newUrl: string) => void
  /** Optional callback for recovery errors */
  onRecoveryError?: (error: string) => void
}

export function useAudioSessionRecovery({
  projectId,
  audioSrc,
  audioElement,
  onUrlRefreshed,
  onRecoveryError,
}: UseAudioSessionRecoveryOptions) {
  // Track when the current URL was fetched
  const urlFetchedAtRef = useRef<number>(Date.now())
  const isRecoveringRef = useRef(false)
  const pendingRecoveryCleanupRef = useRef<(() => void) | null>(null)

  const clearPendingRecoveryWait = useCallback(() => {
    pendingRecoveryCleanupRef.current?.()
    pendingRecoveryCleanupRef.current = null
  }, [])

  // Update timestamp when audioSrc changes (new fetch)
  useEffect(() => {
    if (audioSrc) {
      urlFetchedAtRef.current = Date.now()
    }
  }, [audioSrc])

  useEffect(() => {
    return () => {
      clearPendingRecoveryWait()
      isRecoveringRef.current = false
    }
  }, [clearPendingRecoveryWait])

  const refreshAudioUrl = useCallback(async () => {
    if (isRecoveringRef.current) return
    isRecoveringRef.current = true

    const audio = audioElement
    const wasPlaying = audio ? !audio.paused : false
    const savedPosition = audio?.currentTime ?? 0

    try {
      const res = await fetch(`/api/projects/${projectId}/media-url`)
      if (!res.ok) {
        throw new Error(`Failed to refresh media URL: ${res.status}`)
      }
      const { url } = await res.json()
      
      // Update the timestamp
      urlFetchedAtRef.current = Date.now()
      
      // Notify parent to update audioSrc state
      onUrlRefreshed(url)

      // Wait a tick for the new src to be applied, then restore position
      if (audio) {
        const currentAudio = audio
        clearPendingRecoveryWait()
        let finished = false
        let recoveryTimeoutId: number | null = null

        const cleanupListeners = () => {
          currentAudio.removeEventListener('loadeddata', handleLoaded)
          currentAudio.removeEventListener('error', handleErrorOrAbort)
          currentAudio.removeEventListener('abort', handleErrorOrAbort)
        }

        const finishRecoveryWait = () => {
          if (finished) return
          finished = true
          if (recoveryTimeoutId !== null) {
            window.clearTimeout(recoveryTimeoutId)
            recoveryTimeoutId = null
          }
          cleanupListeners()
          if (pendingRecoveryCleanupRef.current === finishRecoveryWait) {
            pendingRecoveryCleanupRef.current = null
          }
          isRecoveringRef.current = false
        }

        const handleLoaded = () => {
          currentAudio.currentTime = savedPosition
          if (wasPlaying) {
            currentAudio.play().catch(() => {
              // Autoplay may be blocked, user can click play manually
            })
          }
          finishRecoveryWait()
        }

        const handleErrorOrAbort = () => {
          finishRecoveryWait()
        }

        currentAudio.addEventListener('loadeddata', handleLoaded)
        currentAudio.addEventListener('error', handleErrorOrAbort)
        currentAudio.addEventListener('abort', handleErrorOrAbort)
        pendingRecoveryCleanupRef.current = finishRecoveryWait
        recoveryTimeoutId = window.setTimeout(() => {
          if (finished) return
          // Allow future recovery attempts if reload is slow, but keep the event
          // listeners so a late `loadeddata` can still restore position/playback.
          recoveryTimeoutId = null
          isRecoveringRef.current = false
        }, RECOVERY_WAIT_TIMEOUT_MS)
      } else {
        isRecoveringRef.current = false
      }
    } catch (err) {
      console.error('[useAudioSessionRecovery] Failed to refresh URL:', err)
      onRecoveryError?.(err instanceof Error ? err.message : 'Failed to refresh audio')
      isRecoveringRef.current = false
    }
  }, [projectId, audioElement, onUrlRefreshed, onRecoveryError, clearPendingRecoveryWait])

  // Check if URL is stale
  const isUrlStale = useCallback(() => {
    const age = Date.now() - urlFetchedAtRef.current
    return age > URL_STALE_THRESHOLD_MS
  }, [])

  // Handle visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      if (!audioSrc) return

      // Check if URL is stale OR if audio has errored
      const audio = audioElement
      const hasError = audio?.error != null
      
      if (isUrlStale() || hasError) {
        console.log('[useAudioSessionRecovery] Tab visible, refreshing stale/errored audio URL')
        refreshAudioUrl()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [audioSrc, audioElement, isUrlStale, refreshAudioUrl])

  // Also handle audio stalled/error events as fallback
  useEffect(() => {
    const audio = audioElement
    if (!audio) return

    const handleStalled = () => {
      // Only recover if URL is also stale (avoid false positives from network hiccups)
      if (isUrlStale()) {
        console.log('[useAudioSessionRecovery] Audio stalled with stale URL, refreshing')
        refreshAudioUrl()
      }
    }

    const handleError = () => {
      console.log('[useAudioSessionRecovery] Audio error, attempting recovery')
      refreshAudioUrl()
    }

    audio.addEventListener('stalled', handleStalled)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('stalled', handleStalled)
      audio.removeEventListener('error', handleError)
    }
  }, [audioElement, isUrlStale, refreshAudioUrl])
}
