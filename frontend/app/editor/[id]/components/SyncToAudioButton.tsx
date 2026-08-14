import React from 'react'

export default function SyncToAudioButton({
  visible,
  syncDirection,
  onSync,
}: {
  visible: boolean
  syncDirection: 'up' | 'down'
  onSync: () => void
}) {
  if (!visible) return null
  return (
    <button
      className="absolute bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-subtle-border bg-control px-4 py-2 text-foreground shadow-float backdrop-blur-md transition-colors hover:bg-control-hover"
      title="Sync transcript to current audio position"
      onClick={onSync}
    >
      {syncDirection === 'up' ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      )}
      Sync to audio
    </button>
  )
}
