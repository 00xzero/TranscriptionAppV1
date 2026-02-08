'use client'

import React from 'react'

interface FloatingPlayerDeckProps {
  currentTime: number
  duration: number
  playing: boolean
  playbackRate: number
  onTogglePlay: () => void
  onSeekRelative: (sec: number) => void
  onRateChange: (rate: number) => void
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '00:00:00'
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

function formatRate(rate: number): string {
  if (!isFinite(rate) || isNaN(rate)) return '1'
  return Number(rate.toFixed(2)).toString()
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

export default function FloatingPlayerDeck({
  currentTime,
  duration,
  playing,
  playbackRate,
  onTogglePlay,
  onSeekRelative,
  onRateChange,
}: FloatingPlayerDeckProps) {
  const nextRate = () => {
    const currentIdx = RATES.indexOf(playbackRate)
    const nextIdx = currentIdx === -1 ? 2 : (currentIdx + 1) % RATES.length
    onRateChange(RATES[nextIdx])
  }

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 w-[90%] md:w-[600px] bg-white/45 dark:bg-[#1A1A1A]/45 backdrop-blur-md rounded-2xl shadow-float border border-[#D1CEC5] dark:border-white/10 px-5 py-3">
      <div className="flex items-center justify-between">
        {/* Left: Time display */}
        <div className="font-mono text-xs select-none min-w-[80px]">
          <span className="text-trust-blue">{formatTime(currentTime)}</span>
          <span className="text-ink/40 dark:text-paper/40"> / {formatTime(duration)}</span>
        </div>

        {/* Center: Transport controls */}
        <div className="flex items-center gap-3">
          {/* Rewind -5s */}
          <button
            type="button"
            onClick={() => onSeekRelative(-5)}
            className="p-1.5 rounded-full hover:bg-ink/10 dark:hover:bg-paper/10 transition-colors text-ink dark:text-paper"
            aria-label="Rewind 5 seconds"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="19,20 9,12 19,4" />
              <line x1="5" y1="19" x2="5" y2="5" />
            </svg>
          </button>

          {/* Play / Pause */}
          <button
            type="button"
            onClick={onTogglePlay}
            className="w-10 h-10 rounded-full bg-trust-blue hover:bg-trust-blue/90 text-white flex items-center justify-center transition-colors shadow-sm"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="8,5 20,12 8,19" />
              </svg>
            )}
          </button>

          {/* Forward +5s */}
          <button
            type="button"
            onClick={() => onSeekRelative(5)}
            className="p-1.5 rounded-full hover:bg-ink/10 dark:hover:bg-paper/10 transition-colors text-ink dark:text-paper"
            aria-label="Forward 5 seconds"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5,4 15,12 5,20" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </button>
        </div>

        {/* Right: Playback rate */}
        <button
          type="button"
          onClick={nextRate}
          className="font-mono text-xs px-2.5 py-1 rounded-lg bg-ink/5 dark:bg-paper/5 hover:bg-ink/10 dark:hover:bg-paper/10 text-ink dark:text-paper transition-colors min-w-[48px] text-center"
          aria-label="Change playback rate"
        >
          {formatRate(playbackRate)}x
        </button>
      </div>
    </div>
  )
}
