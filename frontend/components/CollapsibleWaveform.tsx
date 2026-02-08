'use client'

import React from 'react'

interface CollapsibleWaveformProps {
  collapsed: boolean
  audioProgress: number
  onExpandClick: () => void
  children: React.ReactNode
}

export default function CollapsibleWaveform({
  collapsed,
  audioProgress,
  onExpandClick,
  children,
}: CollapsibleWaveformProps) {
  return (
    <div className="relative">
      {/* Mini progress bar — visible when collapsed */}
      {collapsed && (
        <button
          type="button"
          onClick={onExpandClick}
          className="w-full h-1.5 bg-ink/10 dark:bg-white/10 cursor-pointer group hover:bg-ink/15 dark:hover:bg-white/15 transition-colors"
          aria-label="Expand waveform"
        >
          <div
            className="h-full bg-trust-blue transition-all duration-150 group-hover:bg-trust-blue/90"
            style={{ width: `${audioProgress}%` }}
          />
        </button>
      )}

      {/* Expandable waveform container */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${collapsed ? 'max-h-0 opacity-0' : 'max-h-48 opacity-100'
          }`}
      >
        <div className="relative bg-paper dark:bg-black border-b border-ink/10 dark:border-white/10">
          {/* Gradient fades on edges */}
          <div className="absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-paper dark:from-black to-transparent z-10 pointer-events-none" />
          <div className="absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-paper dark:from-black to-transparent z-10 pointer-events-none" />

          {/* Waveform content */}
          <div className="px-6 py-4">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
