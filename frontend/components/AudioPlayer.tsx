'use client'

import React, { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'

/**
 * Lightweight audio player component using native HTMLAudioElement.
 * Replaces WaveSurfer.js to eliminate WebAudio memory overhead.
 * 
 * Features:
 * - Simple progress bar with drag-to-seek
 * - Play/Pause, seek controls
 * - Playback rate adjustment
 * - Current time / Duration display
 * 
 * Designed to be stackable with Option B (server-side waveform peaks)
 * by accepting an optional `peaks` prop for future waveform visualization.
 */

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
  /** Called when seek operation completes */
  onSeeked?: (time: number) => void
  /** Initial playback rate */
  initialPlaybackRate?: number
  /** Pre-rendered peaks for future waveform (Option B ready) */
  peaks?: number[]
}

export interface AudioPlayerRef {
  play: () => void
  pause: () => void
  togglePlay: () => void
  seekToMs: (ms: number) => void
  seekRelative: (seconds: number) => void
  setPlaybackRate: (rate: number) => void
  getCurrentTime: () => number
  getDuration: () => number
  isPlaying: () => boolean
  isReady: () => boolean
  /** Get the underlying audio element for session recovery */
  getAudioElement: () => HTMLAudioElement | null
}

const AudioPlayer = forwardRef<AudioPlayerRef, AudioPlayerProps>(({
  src,
  onReady,
  onError,
  onPlayingChange,
  onTimeUpdate,
  onSeeked,
  initialPlaybackRate = 1.0,
  peaks,
}, ref) => {
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
      const clampedSec = Math.max(0, Math.min(ms / 1000, audio.duration || Infinity))
      audio.currentTime = clampedSec
    },
    seekRelative: (seconds: number) => {
      const audio = audioRef.current
      if (!audio) return
      const newTime = Math.max(0, Math.min(audio.currentTime + seconds, audio.duration || 0))
      audio.currentTime = newTime
    },
    setPlaybackRate: (rate: number) => {
      if (audioRef.current) {
        audioRef.current.playbackRate = rate
        setPlaybackRateState(rate)
      }
    },
    getCurrentTime: () => audioRef.current?.currentTime || 0,
    getDuration: () => audioRef.current?.duration || 0,
    isPlaying: () => !audioRef.current?.paused,
    isReady: () => readyRef.current,
    getAudioElement: () => audioRef.current,
  }), [])

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleLoadedMetadata = () => {
      setDuration(audio.duration)
    }

    const handleCanPlayThrough = () => {
      if (!readyRef.current) {
        readyRef.current = true
        setReady(true)
        audio.playbackRate = playbackRate
        onReady?.()
        // Process pending seek if any
        if (pendingSeekRef.current !== null) {
          const seekMs = pendingSeekRef.current
          pendingSeekRef.current = null
          audio.currentTime = Math.max(0, seekMs / 1000)
        }
      }
    }

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      onTimeUpdate?.(audio.currentTime)
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
    audio.addEventListener('canplaythrough', handleCanPlayThrough)
    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('seeked', handleSeeked)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('canplaythrough', handleCanPlayThrough)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('seeked', handleSeeked)
      audio.removeEventListener('error', handleError)
    }
  }, [onReady, onError, onPlayingChange, onTimeUpdate, onSeeked, playbackRate])

  // Reset ready state when src changes
  useEffect(() => {
    readyRef.current = false
    setReady(false)
    setCurrentTime(0)
    setDuration(0)
    pendingSeekRef.current = null
  }, [src])

  // Progress bar click/drag handling
  const updateSeekFromEvent = useCallback((clientX: number) => {
    const audio = audioRef.current
    const progressBar = progressRef.current
    if (!audio || !progressBar || !duration) return

    const rect = progressBar.getBoundingClientRect()
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    audio.currentTime = percent * duration
  }, [duration])

  const handleProgressClick = useCallback((e: React.MouseEvent) => {
    updateSeekFromEvent(e.clientX)
  }, [updateSeekFromEvent])

  const handleProgressMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true)
    updateSeekFromEvent(e.clientX)
  }, [updateSeekFromEvent])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      updateSeekFromEvent(e.clientX)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, updateSeekFromEvent])

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || isNaN(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="space-y-3">
      {/* Audio element (hidden) */}
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Progress bar container */}
      <div
        ref={progressRef}
        className="relative h-12 bg-gray-800 rounded cursor-pointer select-none"
        onClick={handleProgressClick}
        onMouseDown={handleProgressMouseDown}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        aria-label="Audio progress"
        tabIndex={0}
      >
        {/* Background track */}
        <div className="absolute inset-0 bg-gray-700 rounded" />

        {/* Progress fill */}
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-600 to-blue-500 rounded-l transition-all duration-75"
          style={{ width: `${progress}%` }}
        />

        {/* Scrubber handle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg transition-all duration-75"
          style={{ left: `calc(${progress}% - 6px)` }}
        />

        {/* Optional: Future waveform visualization slot (Option B ready) */}
        {peaks && peaks.length > 0 && (
          <div className="absolute inset-0 overflow-hidden rounded">
            {/* Placeholder for waveform rendering with pre-computed peaks */}
          </div>
        )}
      </div>

      {/* Time display */}
      <div className="flex items-center justify-between text-sm text-gray-400">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50 hover:bg-blue-700 transition-colors"
          disabled={!ready}
          onClick={() => audioRef.current && (audioRef.current.paused ? audioRef.current.play() : audioRef.current.pause())}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          className="px-3 py-1.5 rounded bg-surface-alt hover:bg-gray-700 transition-colors"
          onClick={() => {
            if (audioRef.current) {
              audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 2)
            }
          }}
        >
          -2s
        </button>
        <button
          className="px-3 py-1.5 rounded bg-surface-alt hover:bg-gray-700 transition-colors"
          onClick={() => {
            if (audioRef.current && duration) {
              audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 2)
            }
          }}
        >
          +2s
        </button>
        <div className="ml-2 flex items-center gap-1">
          <label className="text-sm text-muted">Rate</label>
          <select
            className="border border-base rounded px-2 py-1 text-sm bg-surface text-current focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            value={playbackRate}
            onChange={(e) => {
              const rate = parseFloat(e.target.value)
              if (audioRef.current) {
                audioRef.current.playbackRate = rate
              }
              setPlaybackRateState(rate)
            }}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(r => (
              <option key={r} value={r}>{r.toFixed(2)}x</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
})

AudioPlayer.displayName = 'AudioPlayer'

export default AudioPlayer
