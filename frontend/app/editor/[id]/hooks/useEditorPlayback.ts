import { useCallback, useRef, useState } from 'react'
import type { AudioPlayerRef } from '@/components/AudioPlayer'
import { useAudioSessionRecovery } from '@/hooks/useAudioSessionRecovery'

export function useEditorPlayback({
  projectId,
  audioSrc,
  setAudioSrc,
  setStatus,
  onAudioTick,
  startSeek,
  previewSeek,
  commitSeek,
  onWordSeek,
  onSegmentSeek,
  setWaveformCollapsed,
  transcriptScrollRef,
}: {
  projectId: string
  audioSrc: string | null
  setAudioSrc: (src: string | null) => void
  setStatus: (status: string) => void
  onAudioTick: (tMs: number) => string | undefined
  startSeek: () => void
  previewSeek: (tMs: number) => string | undefined
  commitSeek: (tMs: number, opts?: { lockSeek?: boolean }) => string | undefined
  onWordSeek: (segId: string) => void
  onSegmentSeek: (segId: string) => void
  setWaveformCollapsed: (collapsed: boolean) => void
  transcriptScrollRef: React.RefObject<HTMLDivElement | null>
}) {
  const audioPlayerRef = useRef<AudioPlayerRef | null>(null)
  const wasPlayingBeforeScrubRef = useRef(false)
  const seekGestureActiveRef = useRef(false)
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [audioProgress, setAudioProgress] = useState(0)
  const [audioCurrentTime, setAudioCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1.0)
  const readyRef = useRef(false)
  const pendingSeekRef = useRef<number | null>(null)
  const handleAudioPlayerRef = useCallback((player: AudioPlayerRef | null) => {
    audioPlayerRef.current = player
    setAudioElement(player?.getAudioElement?.() ?? null)
  }, [])

  useAudioSessionRecovery({
    projectId,
    audioSrc,
    audioElement,
    onUrlRefreshed: (newUrl) => setAudioSrc(newUrl),
    onRecoveryError: (error) => console.warn('[Editor] Audio recovery failed:', error),
  })

  const seekToMs = useCallback((targetMs: number) => {
    const player = audioPlayerRef.current
    if (!player) return
    if (!readyRef.current) {
      pendingSeekRef.current = targetMs
      return
    }
    player.seekToMs(targetMs)
  }, [])

  const handleAudioReady = useCallback(() => {
    readyRef.current = true
    setReady(true)
    setStatus('Ready')
    const player = audioPlayerRef.current
    const currentTime = player?.getCurrentTime?.() ?? 0
    const dur = player?.getDuration?.() ?? 0
    setAudioCurrentTime(currentTime)
    setAudioDuration(dur)
    setAudioProgress(dur > 0 ? (currentTime / dur) * 100 : 0)
    const pendingSeekMs = pendingSeekRef.current
    if (pendingSeekMs !== null) {
      pendingSeekRef.current = null
      seekToMs(pendingSeekMs)
    }
  }, [seekToMs, setStatus])

  const handleAudioError = useCallback((error: string) => {
    setStatus(`Error: ${error}`)
  }, [setStatus])

  const handlePlayingChange = useCallback((isPlaying: boolean) => {
    setPlaying(isPlaying)
  }, [])
  const handleTimeUpdate = useCallback((currentTime: number) => {
    setAudioCurrentTime(currentTime)
    const player = audioPlayerRef.current
    const dur = player?.getDuration?.() || 0
    setAudioDuration(dur)
    setAudioProgress(dur > 0 ? (currentTime / dur) * 100 : 0)
    onAudioTick(Math.floor(currentTime * 1000))
  }, [onAudioTick])
  const handleScrubPreview = useCallback((currentTime: number) => {
    const player = audioPlayerRef.current
    const dur = player?.getDuration?.() || audioDuration
    setAudioCurrentTime(currentTime)
    setAudioDuration(dur)
    setAudioProgress(dur > 0 ? (currentTime / dur) * 100 : 0)
    previewSeek(Math.floor(currentTime * 1000))
  }, [audioDuration, previewSeek])

  const handleScrubPreviewFraction = useCallback((fraction: number) => {
    setAudioProgress(Math.max(0, Math.min(fraction, 1)) * 100)
  }, [])

  const togglePlay = useCallback(() => {
    const player = audioPlayerRef.current
    if (!player) return
    player.togglePlay()
  }, [])

  const seekRelative = useCallback((sec: number) => {
    const player = audioPlayerRef.current
    if (!player) return
    player.seekRelative(sec)
  }, [])

  const onRateChange = useCallback((r: number) => {
    setPlaybackRate(r)
    const player = audioPlayerRef.current
    if (player) player.setPlaybackRate(r)
  }, [])

  const onWordClick = useCallback((segId: string, ms: number) => {
    onWordSeek(segId)
    seekToMs(ms)
  }, [onWordSeek, seekToMs])

  const onSegmentClick = useCallback((segId: string, ms: number) => {
    onSegmentSeek(segId)
    seekToMs(ms)
  }, [onSegmentSeek, seekToMs])

  const handleMiniScrubStart = useCallback(() => {
    const player = audioPlayerRef.current
    if (!player) return
    seekGestureActiveRef.current = true
    startSeek()
    if (player.isPlaying()) {
      wasPlayingBeforeScrubRef.current = true
      player.pause()
    } else {
      wasPlayingBeforeScrubRef.current = false
    }
    player.beginScrub()
  }, [startSeek])

  const handleMiniScrub = useCallback((fraction: number) => {
    const player = audioPlayerRef.current
    if (!player) return
    if (seekGestureActiveRef.current) {
      player.scrubToFraction(fraction)
      return
    }
    const targetMs = fraction * (player.getDuration() || audioDuration) * 1000
    commitSeek(targetMs, { lockSeek: false })
    seekToMs(targetMs)
  }, [audioDuration, commitSeek, seekToMs])

  const handleMiniScrubEnd = useCallback(() => {
    const player = audioPlayerRef.current
    if (!player) {
      seekGestureActiveRef.current = false
      return
    }
    player.endScrub()
    const currentMs = Math.floor(player.getCurrentTime() * 1000)
    seekGestureActiveRef.current = false
    const container = transcriptScrollRef.current
    if (container) {
      setWaveformCollapsed(container.scrollTop > 50)
    }
    commitSeek(currentMs)
    if (wasPlayingBeforeScrubRef.current) {
      wasPlayingBeforeScrubRef.current = false
      player.play()
    }
  }, [commitSeek, transcriptScrollRef, setWaveformCollapsed])

  const handlePlayerDragStart = useCallback(() => {
    seekGestureActiveRef.current = true
    startSeek()
  }, [startSeek])

  const handlePlayerDragEnd = useCallback(() => {
    seekGestureActiveRef.current = false
    const container = transcriptScrollRef.current
    if (container) {
      setWaveformCollapsed(container.scrollTop > 50)
    }
    const player = audioPlayerRef.current
    if (!player) return
    commitSeek(Math.floor(player.getCurrentTime() * 1000))
  }, [commitSeek, transcriptScrollRef, setWaveformCollapsed])

  return {
    handleAudioPlayerRef,
    playing,
    audioProgress,
    audioCurrentTime,
    audioDuration,
    playbackRate,
    handleAudioReady,
    handleAudioError,
    handlePlayingChange,
    handleTimeUpdate,
    handleScrubPreview,
    handleScrubPreviewFraction,
    togglePlay,
    seekRelative,
    onRateChange,
    onWordClick,
    onSegmentClick,
    handleMiniScrubStart,
    handleMiniScrub,
    handleMiniScrubEnd,
    handlePlayerDragStart,
    handlePlayerDragEnd,
  }
}
