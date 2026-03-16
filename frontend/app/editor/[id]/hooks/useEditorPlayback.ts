import { useCallback, useRef, useState } from 'react'
import type { AudioPlayerRef } from '@/components/AudioPlayer'
import { useAudioSessionRecovery } from '@/hooks/useAudioSessionRecovery'

export function useEditorPlayback({
  projectId,
  audioSrc,
  setAudioSrc,
  setStatus,
  syncActiveSegment,
  findActiveSegmentId,
  activeIds,
  setActiveIds,
  isFollowMode,
  ensureActiveSegmentVisible,
  isScrubbingRef,
  setWaveformCollapsed,
  transcriptScrollRef,
  setSeekLock,
  clearSeekLock,
}: {
  projectId: string
  audioSrc: string | null
  setAudioSrc: (src: string | null) => void
  setStatus: (status: string) => void
  syncActiveSegment: (tMs: number) => string | undefined
  findActiveSegmentId: (tMs: number) => string | undefined
  activeIds: { segId?: string; wordKey?: string }
  setActiveIds: React.Dispatch<React.SetStateAction<{ segId?: string; wordKey?: string }>>
  isFollowMode: boolean
  ensureActiveSegmentVisible: (segId: string) => void
  isScrubbingRef: React.MutableRefObject<boolean>
  setWaveformCollapsed: (collapsed: boolean) => void
  transcriptScrollRef: React.MutableRefObject<HTMLDivElement | null>
  setSeekLock: () => void
  clearSeekLock: () => void
}) {
  const audioPlayerRef = useRef<AudioPlayerRef | null>(null)
  const wasPlayingBeforeScrubRef = useRef(false)
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

  const seekToMs = useCallback((targetMs: number, { skipLock = false }: { skipLock?: boolean } = {}) => {
    const player = audioPlayerRef.current
    if (!player) return
    if (!readyRef.current) {
      pendingSeekRef.current = targetMs
      return
    }
    if (!skipLock) {
      setSeekLock()
    } else {
      clearSeekLock()
    }
    player.seekToMs(targetMs)
  }, [setSeekLock, clearSeekLock])

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
    if (!isScrubbingRef.current) {
      syncActiveSegment(Math.floor(currentTime * 1000))
    }
  }, [syncActiveSegment, isScrubbingRef])
  const handleScrubPreview = useCallback((currentTime: number) => {
    const player = audioPlayerRef.current
    const dur = player?.getDuration?.() || audioDuration
    setAudioCurrentTime(currentTime)
    setAudioDuration(dur)
    setAudioProgress(dur > 0 ? (currentTime / dur) * 100 : 0)
    syncActiveSegment(Math.floor(currentTime * 1000))
  }, [audioDuration, syncActiveSegment])

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

  const onWordClick = useCallback((ms: number) => {
    seekToMs(ms)
  }, [seekToMs])

  const onSegmentClick = useCallback((segId: string, ms: number) => {
    setActiveIds({ segId, wordKey: undefined })
    seekToMs(ms)
  }, [seekToMs, setActiveIds])

  const syncTranscriptToPlayer = useCallback(() => {
    const player = audioPlayerRef.current
    if (!player) return undefined
    const currentTime = player.getCurrentTime()
    const dur = player.getDuration()
    setAudioCurrentTime(currentTime)
    setAudioDuration(dur)
    setAudioProgress(dur > 0 ? (currentTime / dur) * 100 : 0)
    return syncActiveSegment(Math.floor(currentTime * 1000))
  }, [syncActiveSegment])

  const handleMiniScrubStart = useCallback(() => {
    isScrubbingRef.current = true
    clearSeekLock()
    const player = audioPlayerRef.current
    if (player && player.isPlaying()) {
      wasPlayingBeforeScrubRef.current = true
      player.pause()
    } else {
      wasPlayingBeforeScrubRef.current = false
    }
    player?.beginScrub()
  }, [isScrubbingRef, clearSeekLock])

  const handleMiniScrub = useCallback((fraction: number) => {
    const player = audioPlayerRef.current
    if (!player) return
    if (isScrubbingRef.current) {
      player.scrubToFraction(fraction)
      return
    }
    const targetMs = fraction * (player.getDuration() || audioDuration) * 1000
    seekToMs(targetMs, { skipLock: true })
  }, [audioDuration, seekToMs, isScrubbingRef])

  const handleMiniScrubEnd = useCallback(() => {
    const player = audioPlayerRef.current
    if (!player) {
      isScrubbingRef.current = false
      return
    }
    player.endScrub()
    isScrubbingRef.current = false
    const container = transcriptScrollRef.current
    if (container) {
      setWaveformCollapsed(container.scrollTop > 50)
    }
    const segId = syncTranscriptToPlayer() ?? activeIds.segId
    if (isFollowMode && segId) {
      ensureActiveSegmentVisible(segId)
    }
    if (wasPlayingBeforeScrubRef.current) {
      wasPlayingBeforeScrubRef.current = false
      player.play()
    }
  }, [activeIds.segId, ensureActiveSegmentVisible, isFollowMode, syncTranscriptToPlayer, isScrubbingRef, transcriptScrollRef, setWaveformCollapsed])

  const handlePlayerDragStart = useCallback(() => {
    isScrubbingRef.current = true
    clearSeekLock()
  }, [isScrubbingRef, clearSeekLock])

  const handlePlayerDragEnd = useCallback(() => {
    isScrubbingRef.current = false
    const container = transcriptScrollRef.current
    if (container) {
      setWaveformCollapsed(container.scrollTop > 50)
    }
    const segId = syncTranscriptToPlayer() ?? activeIds.segId
    if (isFollowMode && segId) {
      ensureActiveSegmentVisible(segId)
    }
  }, [activeIds.segId, ensureActiveSegmentVisible, isFollowMode, syncTranscriptToPlayer, isScrubbingRef, transcriptScrollRef, setWaveformCollapsed])

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
