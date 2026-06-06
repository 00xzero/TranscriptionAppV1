type AudioContextConstructor = typeof AudioContext

export function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: AudioContextConstructor })
      .webkitAudioContext ||
    null
  )
}

export function hasAudioContext(): boolean {
  return getAudioContextConstructor() !== null
}
