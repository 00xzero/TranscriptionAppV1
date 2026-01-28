import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react'

/**
 * Mock AudioPlayer component for Jest tests.
 * Simulates the AudioPlayer behavior without actual audio playback.
 */
const MockAudioPlayer = forwardRef(function MockAudioPlayer(
    { src, onReady, onError, onPlayingChange, onTimeUpdate, initialPlaybackRate = 1.0 }: {
        src: string
        onReady?: () => void
        onError?: (error: string) => void
        onPlayingChange?: (playing: boolean) => void
        onTimeUpdate?: (currentTime: number) => void
        initialPlaybackRate?: number
        peaks?: number[]
    },
    ref
) {
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
        },
        seekRelative: (seconds: number) => {
            const newTime = Math.max(0, Math.min(currentTime + seconds, duration))
            setCurrentTime(newTime)
            onTimeUpdate?.(newTime)
        },
        setPlaybackRate: (rate: number) => {
            setPlaybackRate(rate)
        },
        getCurrentTime: () => currentTime,
        getDuration: () => duration,
        isPlaying: () => playing,
        isReady: () => readyRef.current,
    }), [playing, currentTime, duration, onPlayingChange, onTimeUpdate])

    // Simulate ready event after mount
    useEffect(() => {
        if (src) {
            readyRef.current = true
            onReady?.()
        }
    }, [src, onReady])

    return (
        <div data-testid="audio-player" data-src={src}>
            <div data-testid="audio-controls">
                <button onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
            </div>
            <div data-testid="audio-status">
                Time: {currentTime.toFixed(1)}s / {duration}s | Rate: {playbackRate}x
            </div>
        </div>
    )
})

export default MockAudioPlayer
export type { AudioPlayerRef } from '../components/AudioPlayer'
