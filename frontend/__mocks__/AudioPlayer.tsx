import React, { useImperativeHandle, useRef, useState, useEffect } from 'react'
import type { AudioPlayerProps, AudioPlayerRef } from '../components/AudioPlayer'

/**
 * Mock AudioPlayer component for Jest tests.
 * Simulates the AudioPlayer behavior without actual audio playback.
 */
function MockAudioPlayer({
  ref,
  src,
  onReady,
  onPlayingChange,
  onTimeUpdate,
  onSeeked,
  onScrubPreview,
  onScrubPreviewFraction,
  initialPlaybackRate = 1.0,
  hideControls = false,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration] = useState(60)
  const [playbackRate, setPlaybackRate] = useState(initialPlaybackRate)
  const readyRef = useRef(false)

  useImperativeHandle(ref, () => ({
    play: () => {
      setPlaying(true)
      onPlayingChange?.(true)
    },
    pause: () => {
      setPlaying(false)
      onPlayingChange?.(false)
    },
    togglePlay: () => {
      const newState = !playing
      setPlaying(newState)
      onPlayingChange?.(newState)
    },
    seekToMs: (ms: number) => {
      const newTime = Math.max(0, Math.min(ms / 1000, duration))
      setCurrentTime(newTime)
      onTimeUpdate?.(newTime)
      onSeeked?.(newTime)
    },
    beginScrub: () => { },
    scrubToFraction: (fraction: number) => {
      const newTime = Math.max(0, Math.min(fraction, 1)) * duration
      setCurrentTime(newTime)
      onScrubPreviewFraction?.(Math.max(0, Math.min(fraction, 1)))
      onScrubPreview?.(newTime)
    },
    scrubToMs: (ms: number) => {
      const newTime = Math.max(0, Math.min(ms / 1000, duration))
      setCurrentTime(newTime)
      onScrubPreviewFraction?.(duration > 0 ? newTime / duration : 0)
      onScrubPreview?.(newTime)
    },
    endScrub: () => {
      onTimeUpdate?.(currentTime)
      onSeeked?.(currentTime)
    },
    seekRelative: (seconds: number) => {
      const newTime = Math.max(0, Math.min(currentTime + seconds, duration))
      setCurrentTime(newTime)
      onTimeUpdate?.(newTime)
      onSeeked?.(newTime)
    },
    setPlaybackRate: (rate: number) => {
      setPlaybackRate(rate)
    },
    getCurrentTime: () => currentTime,
    getDuration: () => duration,
    isPlaying: () => playing,
    isReady: () => readyRef.current,
    getAudioElement: () => audioRef.current,
  }), [playing, currentTime, duration, onPlayingChange, onTimeUpdate, onSeeked, onScrubPreview, onScrubPreviewFraction])

  // Simulate ready event after mount
  useEffect(() => {
    if (src) {
      readyRef.current = true
      onReady?.()
    }
  }, [src, onReady])

  return (
    <div data-testid="audio-player" data-src={src}>
      <audio ref={audioRef} />
      {!hideControls && (
        <div data-testid="audio-controls">
          <button onClick={() => {
            const nextPlaying = !playing
            onPlayingChange?.(nextPlaying)
            setPlaying(nextPlaying)
          }}>{playing ? 'Pause' : 'Play'}</button>
        </div>
      )}
      <div data-testid="audio-status">
        Time: {currentTime.toFixed(1)}s / {duration}s | Rate: {playbackRate}x
      </div>
    </div>
  )
}

export default MockAudioPlayer
export type { AudioPlayerRef } from '../components/AudioPlayer'
