'use client'

import React, { forwardRef, useCallback, useEffect, useRef, useState, useImperativeHandle } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { formatClockTime } from '@/lib/utils'
import { isSafariBrowser } from '@/lib/recording/safariPrewarm'

/**
 * Native HTMLAudioElement-backed player.
 * Set `audioEngineOnly` when an external visualization (Waveform.tsx) owns
 * the visible scrubber — only the <audio> element is rendered, no UI state.
 */
const TIMEUPDATE_QUANTIZE_MS = 100
const SAFARI_WEBM_PRIME_TIME_SECONDS = 0.001

function isLikelyWebmSource(src: string): boolean {
  try {
    const pathname = new URL(src, typeof window === 'undefined' ? 'http://localhost' : window.location.href).pathname
    return decodeURIComponent(pathname).toLowerCase().endsWith('.webm')
  } catch {
    return src.split('?')[0]?.toLowerCase().endsWith('.webm') ?? false
  }
}

function shouldPrimeSafariWebmPlayback(src: string): boolean {
  if (typeof navigator === 'undefined') return false
  return isLikelyWebmSource(src) && isSafariBrowser(navigator.userAgent, navigator.vendor)
}

export interface AudioPlayerProps {
  /** URL of the audio file */
  src: string
  /** Called when audio is ready to play */
  onReady?: () => void
  /** Called on error loading audio */
  onError?: (error: string) => void
  /** Called on play state change */
  onPlayingChange?: (playing: boolean) => void
  /** Called on time update (current time in seconds) */
  onTimeUpdate?: (currentTime: number) => void
  /** Called when a finite duration is resolved from metadata, seekable ranges, or durationHint */
  onDurationChange?: (duration: number) => void
  /** Called when seek operation completes */
  onSeeked?: (time: number) => void
  /** Initial playback rate */
  initialPlaybackRate?: number
  /** Known project duration when container metadata is missing or non-finite. */
  durationHint?: number | null
  /** Hide transport controls (when FloatingPlayerDeck is visible) */
  hideControls?: boolean
  /**
   * Render only the underlying <audio> element — no progress bar, no controls,
   * nothing focusable. Use when an external visualization (e.g. Waveform.tsx)
   * owns the visible scrubber and we just need the audio engine.
   */
  audioEngineOnly?: boolean
  /** Called when the user starts dragging the progress bar */
  onDragStart?: () => void
  /** Called when the user ends dragging the progress bar */
  onDragEnd?: () => void
  /** Called with the immediate preview time while scrubbing */
  onScrubPreview?: (currentTime: number) => void
  /** Called with the immediate preview fraction while scrubbing */
  onScrubPreviewFraction?: (fraction: number) => void
}

export interface AudioPlayerRef {
  play: () => void
  pause: () => void
  togglePlay: () => void
  seekToMs: (ms: number) => void
  beginScrub: () => void
  scrubToFraction: (fraction: number) => void
  scrubToMs: (ms: number) => void
  endScrub: () => void
  seekRelative: (seconds: number) => void
  setPlaybackRate: (rate: number) => void
  getCurrentTime: () => number
  getDuration: () => number
  isPlaying: () => boolean
  isReady: () => boolean
  /** Get the underlying audio element for session recovery */
  getAudioElement: () => HTMLAudioElement | null
}

const AudioPlayer = forwardRef<AudioPlayerRef, AudioPlayerProps>(function AudioPlayer({
  src,
  onReady,
  onError,
  onPlayingChange,
  onTimeUpdate,
  onDurationChange,
  onSeeked,
  initialPlaybackRate = 1.0,
  durationHint,
  hideControls = false,
  audioEngineOnly = false,
  onDragStart,
  onDragEnd,
  onScrubPreview,
  onScrubPreviewFraction,
}: AudioPlayerProps, ref) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const progressRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRateState] = useState(initialPlaybackRate)
  const [isDragging, setIsDragging] = useState(false)
  const readyRef = useRef(false)
  const pendingSeekRef = useRef<number | null>(null)
  const wasPlayingBeforeDragRef = useRef(false)
  const isScrubbingRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const latestScrubTimeRef = useRef(0)
  const pendingScrubFractionRef = useRef<number | null>(null)
  const lastEmittedTimeRef = useRef(-Infinity)
  const lastEmittedDurationRef = useRef(0)
  const didPrimeSafariWebmRef = useRef(false)
  const [previewFraction, setPreviewFraction] = useState<number | null>(null)

  const clampFraction = useCallback((nextFraction: number) => {
    if (!Number.isFinite(nextFraction)) return 0
    return Math.max(0, Math.min(nextFraction, 1))
  }, [])

  const cancelPendingScrubFrame = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const clampTime = useCallback((nextTime: number, maxDuration = duration) => {
    const maxTime = Number.isFinite(maxDuration) ? maxDuration : 0
    return Math.max(0, Math.min(nextTime, maxTime))
  }, [duration])

  const clearPendingScrubFraction = useCallback(() => {
    pendingScrubFractionRef.current = null
    setPreviewFraction(null)
  }, [])

  const resolveDuration = useCallback((audio: HTMLAudioElement) => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      return audio.duration
    }
    if (audio.seekable.length > 0) {
      const seekableEnd = audio.seekable.end(audio.seekable.length - 1)
      if (Number.isFinite(seekableEnd) && seekableEnd > 0) {
        return seekableEnd
      }
    }
    if (durationHint != null && Number.isFinite(durationHint) && durationHint > 0) {
      return durationHint
    }
    return 0
  }, [durationHint])

  const getResolvedDuration = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return duration
    return resolveDuration(audio)
  }, [duration, resolveDuration])

  const primeSafariWebmPlayback = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (didPrimeSafariWebmRef.current) return
    if (!shouldPrimeSafariWebmPlayback(src)) return

    didPrimeSafariWebmRef.current = true
    if (audio.currentTime > 0) return

    try {
      const resolvedDuration = resolveDuration(audio)
      if (resolvedDuration > 0 && resolvedDuration <= SAFARI_WEBM_PRIME_TIME_SECONDS) return
      audio.currentTime = SAFARI_WEBM_PRIME_TIME_SECONDS
    } catch (err) {
      console.warn('[AudioPlayer] Safari WebM playback prime failed:', err)
    }
  }, [resolveDuration, src])

  const commitDuration = useCallback((resolvedDuration: number) => {
    if (!Number.isFinite(resolvedDuration) || resolvedDuration <= 0) {
      return false
    }

    setDuration(resolvedDuration)
    if (Math.abs(resolvedDuration - lastEmittedDurationRef.current) > 0.001) {
      lastEmittedDurationRef.current = resolvedDuration
      onDurationChange?.(resolvedDuration)
    }
    return true
  }, [onDurationChange])

  const queuePendingScrubFraction = useCallback((nextFraction: number) => {
    const clamped = clampFraction(nextFraction)
    pendingScrubFractionRef.current = clamped
    pendingSeekRef.current = null
    latestScrubTimeRef.current = 0
    setPreviewFraction(clamped)
    onScrubPreviewFraction?.(clamped)
  }, [clampFraction, onScrubPreviewFraction])

  const flushScrubSeek = useCallback(() => {
    cancelPendingScrubFrame()
    const audio = audioRef.current
    if (!audio) return
    const clamped = clampTime(latestScrubTimeRef.current)
    latestScrubTimeRef.current = clamped
    audio.currentTime = clamped
    setCurrentTime(clamped)
  }, [cancelPendingScrubFrame, clampTime])

  const beginScrub = useCallback(() => {
    isScrubbingRef.current = true
  }, [])

  const scrubToTime = useCallback((nextTime: number, maxDuration = duration) => {
    const audio = audioRef.current
    if (!audio) return
    const clamped = clampTime(nextTime, maxDuration)
    clearPendingScrubFraction()
    latestScrubTimeRef.current = clamped
    setCurrentTime(clamped)
    if (maxDuration > 0) {
      onScrubPreviewFraction?.(clamped / maxDuration)
    }
    onScrubPreview?.(clamped)
    cancelPendingScrubFrame()
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const latest = clampTime(latestScrubTimeRef.current, maxDuration)
      latestScrubTimeRef.current = latest
      if (audioRef.current) {
        audioRef.current.currentTime = latest
      }
    })
  }, [cancelPendingScrubFrame, clampTime, clearPendingScrubFraction, duration, onScrubPreview, onScrubPreviewFraction])

  const scrubToFraction = useCallback((fraction: number, resolvedDuration?: number) => {
    const audio = audioRef.current
    const clampedFraction = clampFraction(fraction)
    const nextDuration = resolvedDuration
      ?? (audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration)

    if (nextDuration > 0) {
      scrubToTime(clampedFraction * nextDuration, nextDuration)
      return
    }

    queuePendingScrubFraction(clampedFraction)
  }, [clampFraction, duration, queuePendingScrubFraction, scrubToTime])

  const endScrub = useCallback(() => {
    flushScrubSeek()
    isScrubbingRef.current = false
  }, [flushScrubSeek])

  // Expose imperative methods
  useImperativeHandle(ref, () => ({
    play: () => audioRef.current?.play(),
    pause: () => audioRef.current?.pause(),
    togglePlay: () => {
      const audio = audioRef.current
      if (!audio) return
      if (audio.paused) {
        audio.play()
      } else {
        audio.pause()
      }
    },
    seekToMs: (ms: number) => {
      const audio = audioRef.current
      if (!audio) return
      if (!readyRef.current) {
        pendingSeekRef.current = ms
        return
      }
      const resolvedDuration = getResolvedDuration()
      const clampedSec = Math.max(
        0,
        Math.min(ms / 1000, resolvedDuration > 0 ? resolvedDuration : Infinity)
      )
      audio.currentTime = clampedSec
    },
    beginScrub,
    scrubToFraction: (fraction: number) => {
      scrubToFraction(fraction)
    },
    scrubToMs: (ms: number) => {
      scrubToTime(ms / 1000)
    },
    endScrub,
    seekRelative: (seconds: number) => {
      const audio = audioRef.current
      if (!audio) return
      const resolvedDuration = getResolvedDuration()
      const newTime = Math.max(
        0,
        Math.min(audio.currentTime + seconds, resolvedDuration > 0 ? resolvedDuration : Infinity)
      )
      audio.currentTime = newTime
    },
    setPlaybackRate: (rate: number) => {
      if (audioRef.current) {
        audioRef.current.playbackRate = rate
        setPlaybackRateState(rate)
      }
    },
    getCurrentTime: () => audioRef.current?.currentTime || 0,
    getDuration: getResolvedDuration,
    isPlaying: () => !audioRef.current?.paused,
    isReady: () => readyRef.current,
    getAudioElement: () => audioRef.current,
  }), [beginScrub, endScrub, getResolvedDuration, scrubToFraction, scrubToTime])

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleLoadedMetadata = () => {
      const resolvedDuration = resolveDuration(audio)
      commitDuration(resolvedDuration)
      const pendingFraction = pendingScrubFractionRef.current
      if (pendingFraction !== null && resolvedDuration > 0) {
        scrubToFraction(pendingFraction, resolvedDuration)
      }
    }

    const handleReady = () => {
      if (!readyRef.current) {
        readyRef.current = true
        setReady(true)
        audio.playbackRate = playbackRate
        primeSafariWebmPlayback()
        onReady?.()
        // Process pending seek if any
        if (pendingSeekRef.current !== null) {
          const seekMs = pendingSeekRef.current
          pendingSeekRef.current = null
          audio.currentTime = Math.max(0, seekMs / 1000)
        }
      }
    }

    const handleDurationChange = () => {
      const resolvedDuration = resolveDuration(audio)
      commitDuration(resolvedDuration)
    }

    const handleTimeUpdate = () => {
      if (isScrubbingRef.current) return
      const t = audio.currentTime
      // Quantize to ~10Hz so we don't re-render on sub-100ms ticks.
      if (Math.abs(t - lastEmittedTimeRef.current) * 1000 < TIMEUPDATE_QUANTIZE_MS) return
      lastEmittedTimeRef.current = t
      if (!audioEngineOnly) setCurrentTime(t)
      onTimeUpdate?.(t)
    }

    const handlePlay = () => {
      setPlaying(true)
      onPlayingChange?.(true)
    }

    const handlePause = () => {
      setPlaying(false)
      onPlayingChange?.(false)
    }

    const handleSeeked = () => {
      onSeeked?.(audio.currentTime)
    }

    const handleError = () => {
      const errorMsg = audio.error?.message || 'Failed to load audio'
      onError?.(errorMsg)
    }

    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('durationchange', handleDurationChange)
    audio.addEventListener('canplay', handleReady)
    audio.addEventListener('canplaythrough', handleReady)
    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('seeked', handleSeeked)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('durationchange', handleDurationChange)
      audio.removeEventListener('canplay', handleReady)
      audio.removeEventListener('canplaythrough', handleReady)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('seeked', handleSeeked)
      audio.removeEventListener('error', handleError)
    }
  }, [audioEngineOnly, onReady, onError, onPlayingChange, onTimeUpdate, onSeeked, playbackRate, resolveDuration, scrubToFraction, commitDuration, primeSafariWebmPlayback])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const resolvedDuration = resolveDuration(audio)
    if (resolvedDuration <= 0) return

    commitDuration(resolvedDuration)
    const pendingFraction = pendingScrubFractionRef.current
    if (pendingFraction !== null) {
      scrubToFraction(pendingFraction, resolvedDuration)
    }
  }, [durationHint, resolveDuration, scrubToFraction, commitDuration])

  // Toggling audioEngineOnly replaces the underlying <audio> element, so the
  // new element needs a fresh readiness cycle (same as when src changes).
  useEffect(() => {
    readyRef.current = false
    setReady(false)
    setCurrentTime(0)
    setDuration(0)
    lastEmittedDurationRef.current = 0
    didPrimeSafariWebmRef.current = false
    pendingSeekRef.current = null
    latestScrubTimeRef.current = 0
    lastEmittedTimeRef.current = -Infinity
    clearPendingScrubFraction()
    isScrubbingRef.current = false
    cancelPendingScrubFrame()
    setIsDragging(false)
    wasPlayingBeforeDragRef.current = false
  }, [audioEngineOnly, cancelPendingScrubFrame, clearPendingScrubFraction, src])

  useEffect(() => {
    return () => {
      cancelPendingScrubFrame()
      clearPendingScrubFraction()
    }
  }, [cancelPendingScrubFrame, clearPendingScrubFraction])

  const fractionFromClientX = useCallback((clientX: number) => {
    const progressBar = progressRef.current
    if (!progressBar) return 0

    const rect = progressBar.getBoundingClientRect()
    if (!rect.width || !Number.isFinite(rect.width)) return 0

    return clampFraction((clientX - rect.left) / rect.width)
  }, [clampFraction])

  // Progress bar click/drag handling
  const updateSeekFromEvent = useCallback((clientX: number) => {
    const fraction = fractionFromClientX(clientX)
    scrubToFraction(fraction)
  }, [fractionFromClientX, scrubToFraction])

  const handleProgressClick = useCallback((e: React.MouseEvent) => {
    updateSeekFromEvent(e.clientX)
  }, [updateSeekFromEvent])

  const handleProgressMouseDown = useCallback((e: React.MouseEvent) => {
    const audio = audioRef.current
    if (audio && !audio.paused) {
      wasPlayingBeforeDragRef.current = true
      audio.pause()
    } else {
      wasPlayingBeforeDragRef.current = false
    }
    beginScrub()
    setIsDragging(true)
    onDragStart?.()
    updateSeekFromEvent(e.clientX)
  }, [beginScrub, onDragStart, updateSeekFromEvent])

  const seekToTime = useCallback((nextTime: number) => {
    const audio = audioRef.current
    if (!audio) return
    const clamped = clampTime(nextTime)
    audio.currentTime = clamped
    setCurrentTime(clamped)
    onTimeUpdate?.(clamped)
  }, [clampTime, onTimeUpdate])

  const handleProgressKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const smallStep = 2
    const largeStep = 10

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault()
        seekToTime(currentTime + smallStep)
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault()
        seekToTime(currentTime - smallStep)
        break
      case 'PageUp':
        e.preventDefault()
        seekToTime(currentTime + largeStep)
        break
      case 'PageDown':
        e.preventDefault()
        seekToTime(currentTime - largeStep)
        break
      case 'Home':
        e.preventDefault()
        seekToTime(0)
        break
      case 'End':
        e.preventDefault()
        seekToTime(duration)
        break
      default:
        break
    }
  }, [currentTime, duration, seekToTime])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      updateSeekFromEvent(e.clientX)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      endScrub()
      onDragEnd?.()
      if (wasPlayingBeforeDragRef.current) {
        wasPlayingBeforeDragRef.current = false
        audioRef.current?.play()
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [endScrub, isDragging, onDragEnd, updateSeekFromEvent])

  const progress = previewFraction !== null
    ? previewFraction * 100
    : duration > 0 ? (currentTime / duration) * 100 : 0

  // Engine-only: render bare <audio> so there's no second focusable scrubber.
  if (audioEngineOnly) {
    return <audio ref={audioRef} src={src} preload="metadata" />
  }

  return (
    <div className="space-y-3">
      {/* Audio element (hidden) */}
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Progress bar container */}
      <div
        ref={progressRef}
        className="relative h-12 bg-ink/10 dark:bg-paper/10 rounded-sm cursor-pointer select-none"
        onClick={handleProgressClick}
        onMouseDown={handleProgressMouseDown}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        aria-label="Audio progress"
        title="Audio progress"
        tabIndex={0}
        onKeyDown={handleProgressKeyDown}
      >
        {/* Background track */}
        <div className="absolute inset-0 bg-ink/5 dark:bg-paper/5 rounded-sm" />

        {/* Progress fill */}
        <div
          className={`absolute inset-y-0 left-0 bg-trust-blue rounded-l ${isDragging ? 'transition-none' : 'transition-all duration-75'}`}
          style={{ width: `${progress}%` }}
        />

        {/* Scrubber handle */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-paper dark:bg-ink rounded-full shadow-lg ${isDragging ? 'transition-none' : 'transition-all duration-75'}`}
          style={{ left: `calc(${progress}% - 6px)` }}
        />
      </div>

      {/* Time display */}
      <div className="flex items-center justify-between text-sm text-muted font-mono">
        <span>{formatClockTime(currentTime, 'never')}</span>
        <span>{formatClockTime(duration, 'never')}</span>
      </div>

      {/* Controls — hidden when FloatingPlayerDeck is active */}
      {!hideControls && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="px-3 py-1.5 rounded-sm bg-trust-blue text-white disabled:opacity-50 hover:bg-trust-blue/90 transition-colors"
            disabled={!ready}
            onClick={() => audioRef.current && (audioRef.current.paused ? audioRef.current.play() : audioRef.current.pause())}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-sm bg-surface-alt hover:bg-ink/10 dark:hover:bg-paper/10 transition-colors"
            onClick={() => {
              if (audioRef.current) {
                audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 2)
              }
            }}
            title="Rewind 2 seconds"
          >
            -2s
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-sm bg-surface-alt hover:bg-ink/10 dark:hover:bg-paper/10 transition-colors"
            onClick={() => {
              if (audioRef.current && duration) {
                audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 2)
              }
            }}
            title="Forward 2 seconds"
          >
            +2s
          </button>
          <div className="ml-2 flex items-center gap-1">
            <Label className="text-sm text-muted">Rate</Label>
            <Select
              value={String(playbackRate)}
              onValueChange={(v) => {
                const rate = parseFloat(v)
                if (audioRef.current) {
                  audioRef.current.playbackRate = rate
                }
                setPlaybackRateState(rate)
              }}
            >
              <SelectTrigger className="h-auto w-auto border border-base rounded-sm px-2 py-1 text-sm bg-surface" aria-label="Playback rate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(r => (
                  <SelectItem key={r} value={String(r)}>{r.toFixed(2)}x</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  )
})

export default AudioPlayer
