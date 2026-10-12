import { useCallback, useRef, useState } from 'react'
import type { ScrubEndReason } from '@/lib/audio/useScrubGesture'
import type { AudioPlayerRef } from '@/components/AudioPlayer'
import { useAudioSessionRecovery } from './useAudioSessionRecovery'

export function useEditorPlayback({
  transcriptId,
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
  shouldCollapseWaveform,
}: {
  transcriptId: string
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
  shouldCollapseWaveform: () => boolean
}) {
  const audioPlayerRef = useRef<AudioPlayerRef | null>(null)
  const wasPlayingBeforeScrubRef = useRef(false)
  const seekGestureActiveRef = useRef(false)
  const scrubPlayerRef = useRef<AudioPlayerRef | null>(null)
  const lastPreviewMsRef = useRef(0)
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [audioProgress, setAudioProgress] = useState(0)
  const [audioCurrentTime, setAudioCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1.0)
  const [expandedPlayerScrubbing, setExpandedPlayerScrubbing] = useState(false)
  const readyRef = useRef(false)
  const pendingSeekRef = useRef<number | null>(null)
  const handleAudioPlayerRef = useCallback((player: AudioPlayerRef | null) => {
    audioPlayerRef.current = player
    setAudioElement(player?.getAudioElement?.() ?? null)
  }, [])

  useAudioSessionRecovery({
    transcriptId,
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

  const updateAudioProgress = useCallback((currentTime: number, dur: number) => {
    setAudioProgress(dur > 0 ? (currentTime / dur) * 100 : 0)
  }, [])

  const handleTimeUpdate = useCallback((currentTime: number) => {
    setAudioCurrentTime(currentTime)
    const player = audioPlayerRef.current
    const dur = player?.getDuration?.() || 0
    setAudioDuration(dur)
    updateAudioProgress(currentTime, dur)
    onAudioTick(Math.floor(currentTime * 1000))
  }, [onAudioTick, updateAudioProgress])

  const handleAudioDurationChange = useCallback((duration: number) => {
    const player = audioPlayerRef.current
    const currentTime = player?.getCurrentTime?.() ?? 0
    setAudioDuration(duration)
    updateAudioProgress(currentTime, duration)
  }, [updateAudioProgress])

  const handleScrubPreview = useCallback((currentTime: number) => {
    const player = audioPlayerRef.current
    const dur = player?.getDuration?.() || audioDuration
    lastPreviewMsRef.current = Math.floor(currentTime * 1000)
    setAudioCurrentTime(currentTime)
    setAudioDuration(dur)
    updateAudioProgress(currentTime, dur)
    previewSeek(Math.floor(currentTime * 1000))
  }, [audioDuration, previewSeek, updateAudioProgress])

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

  const handleMiniSeekStart = useCallback(() => {
    const player = audioPlayerRef.current
    if (!player || seekGestureActiveRef.current) return
    scrubPlayerRef.current = player
    lastPreviewMsRef.current = Math.floor(player.getCurrentTime() * 1000)
    seekGestureActiveRef.current = true
    startSeek()
  }, [startSeek])

  const handleMiniScrubStart = useCallback(() => {
    const player = audioPlayerRef.current
    if (!player) return
    handleMiniSeekStart()
    wasPlayingBeforeScrubRef.current = player.isPlaying()
    if (wasPlayingBeforeScrubRef.current) player.pause()
    player.beginScrub()
  }, [handleMiniSeekStart])

  const handleMiniSeek = useCallback((fraction: number) => {
    const player = audioPlayerRef.current
    if (!player) return
    const targetMs = fraction * (player.getDuration() || audioDuration) * 1000
    lastPreviewMsRef.current = Math.floor(targetMs)
    if (seekGestureActiveRef.current) {
      // Keep the seek open until pointer release. A commit here would let
      // follow scrolling hide/replace the control before a drag can start.
      player.seekToFraction(fraction)
      previewSeek(Math.floor(targetMs))
      return
    }
    // Keyboard seeks are atomic and have no pointer transaction to retain.
    startSeek()
    player.seekToFraction(fraction)
    commitSeek(targetMs, { lockSeek: false })
  }, [audioDuration, commitSeek, previewSeek, startSeek])

  const handleMiniScrub = useCallback((fraction: number) => {
    const player = audioPlayerRef.current ?? scrubPlayerRef.current
    if (!player || !seekGestureActiveRef.current) return
    lastPreviewMsRef.current = Math.floor(fraction * (player.getDuration() || audioDuration) * 1000)
    player.scrubToFraction(fraction)
  }, [audioDuration])

  const finishEditorSeek = useCallback((reason: ScrubEndReason, lockSeek = true) => {
    if (!seekGestureActiveRef.current) return
    const player = audioPlayerRef.current
    const currentMs = reason === 'teardown' || !player
      ? lastPreviewMsRef.current
      : Math.floor(player.getCurrentTime() * 1000)
    seekGestureActiveRef.current = false
    scrubPlayerRef.current = null
    setExpandedPlayerScrubbing(false)
    if (lockSeek) commitSeek(currentMs)
    else commitSeek(currentMs, { lockSeek: false })
    if (reason !== 'teardown') setWaveformCollapsed(shouldCollapseWaveform())
  }, [commitSeek, shouldCollapseWaveform, setWaveformCollapsed])

  const handleMiniScrubEnd = useCallback((_fraction?: number, reason: ScrubEndReason = 'release') => {
    if (!seekGestureActiveRef.current) return
    const player = reason === 'teardown' ? scrubPlayerRef.current : audioPlayerRef.current ?? scrubPlayerRef.current
    const resume = wasPlayingBeforeScrubRef.current && reason !== 'teardown'
    wasPlayingBeforeScrubRef.current = false
    player?.endScrub()
    finishEditorSeek(reason)
    if (resume) player?.play()
  }, [finishEditorSeek])

  const handleMiniSeekEnd = useCallback((_fraction?: number, reason: ScrubEndReason = 'release') => {
    finishEditorSeek(reason, false)
  }, [finishEditorSeek])

  const handleExpandedSeekStart = useCallback(() => {
    if (!audioPlayerRef.current) return
    setExpandedPlayerScrubbing(true)
    handleMiniSeekStart()
  }, [handleMiniSeekStart])

  const handleExpandedScrubStart = useCallback(() => {
    if (!audioPlayerRef.current) return
    setExpandedPlayerScrubbing(true)
    handleMiniScrubStart()
  }, [handleMiniScrubStart])

  const handleExpandedScrubEnd = handleMiniScrubEnd

  const handlePlayerDragStart = handleExpandedSeekStart

  // AudioPlayer flushes its own seek before notifying the editor.
  const handlePlayerDragEnd = useCallback((_fraction?: number, reason: ScrubEndReason = 'release') => {
    finishEditorSeek(reason)
  }, [finishEditorSeek])

  return {
    handleAudioPlayerRef,
    playing,
    audioProgress,
    audioCurrentTime,
    audioDuration,
    playbackRate,
    expandedPlayerScrubbing,
    handleAudioReady,
    handleAudioError,
    handlePlayingChange,
    handleTimeUpdate,
    handleAudioDurationChange,
    handleScrubPreview,
    handleScrubPreviewFraction,
    togglePlay,
    seekRelative,
    seekToMs,
    onRateChange,
    onWordClick,
    onSegmentClick,
    handleMiniSeek,
    handleMiniSeekStart,
    handleMiniSeekEnd,
    handleExpandedSeekStart,
    handleMiniScrubStart,
    handleMiniScrub,
    handleMiniScrubEnd,
    handleExpandedScrubStart,
    handleExpandedScrubEnd,
    handlePlayerDragStart,
    handlePlayerDragEnd,
  }
}
