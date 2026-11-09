import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScrubEndReason } from '@/lib/audio/useScrubGesture'
import type { AudioPlayerRef } from '@/components/AudioPlayer'
import { createPlaybackClock } from '../playbackClock'
import { toast } from '@/components/ui/toaster'
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
  const [playbackClock] = useState(createPlaybackClock)
  const holdingPosition = useRef(false)
  const setPositionHold = useCallback((hold: boolean) => {
    holdingPosition.current = hold
    // Recovery owns any seek that was queued before the player became ready.
    if (hold) pendingSeekRef.current = null
    if (!hold && playbackClock.getMs() !== null) playbackClock.refresh()
  }, [playbackClock])
  const lastPosition = useCallback(() => {
    const ms = playbackClock.getMs()
    return ms === null ? undefined : ms / 1000
  }, [playbackClock])
  const reportRecoveryFailure = useCallback((retry: () => void) => {
    setPlaying(false)
    toast({ title: "Couldn't load the audio", variant: 'error', action: { label: 'Retry', onClick: retry } })
  }, [])

  // While playing, the clock follows the audio every frame. When playback
  // stops, one last read captures where it stopped; before anything has
  // played or seeked there is no position to show, so none is read.
  useEffect(() => {
    if (playing) {
      playbackClock.start()
      return () => playbackClock.stop()
    }
    if (playbackClock.getMs() !== null) playbackClock.refresh()
  }, [playing, playbackClock])
  const handleAudioPlayerRef = useCallback((player: AudioPlayerRef | null) => {
    audioPlayerRef.current = player
    const audio = player?.getAudioElement?.() ?? null
    playbackClock.attach(player ? () =>
      holdingPosition.current || audio?.error ? null : Math.floor(player.getCurrentTime() * 1000)
    : null)
    setAudioElement(audio)
  }, [playbackClock])

  const handleUrlRefreshed = useCallback((url: string) => {
    // A signer can return the same URL within its timestamp granularity.
    if (url === audioSrc) audioPlayerRef.current?.reload()
    else setAudioSrc(url)
  }, [audioSrc, setAudioSrc])

  const { toggleWhileRecovering, captureSeek, seekWhileHeld, confirmSeek } = useAudioSessionRecovery({
    transcriptId,
    audioSrc,
    audioElement,
    onUrlRefreshed: handleUrlRefreshed,
    onRecoveryError: reportRecoveryFailure,
    onPositionHold: setPositionHold,
    lastPosition,
    wasPlaying: () => playing,
    onResumeRejected: () => setPlaying(false),
  })

  const seekToMs = useCallback((targetMs: number) => {
    const player = audioPlayerRef.current
    if (!player) return
    if (captureSeek(targetMs / 1000)) return
    if (!readyRef.current) {
      pendingSeekRef.current = targetMs
      return
    }
    player.seekToMs(targetMs)
  }, [captureSeek])

  const handleAudioReady = useCallback(() => {
    readyRef.current = true
    setStatus('Ready')
    if (holdingPosition.current || audioElement?.error) return
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
  }, [seekToMs, setStatus, audioElement])

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
    if (holdingPosition.current || audioElement?.error) return
    // A floor under the frame loop, which browsers throttle in hidden or
    // occluded windows; before anything has played or seeked there is no
    // position to show yet.
    if (playbackClock.getMs() !== null) playbackClock.refresh()
    setAudioCurrentTime(currentTime)
    const player = audioPlayerRef.current
    const dur = player?.getDuration?.() || 0
    setAudioDuration(dur)
    updateAudioProgress(currentTime, dur)
    onAudioTick(Math.floor(currentTime * 1000))
  }, [onAudioTick, playbackClock, updateAudioProgress, audioElement])

  // The media element's `seeked` fires once its position has really moved:
  // after word and segment seeks, each scrub write, and the final scrub flush.
  // Scrub previews arrive before their write lands, so they never refresh.
  const handleSeeked = useCallback(() => {
    if (audioPlayerRef.current?.isReady()) confirmSeek()
    playbackClock.refresh()
  }, [confirmSeek, playbackClock])

  const handleAudioDurationChange = useCallback((duration: number) => {
    if (holdingPosition.current || audioElement?.error) return
    const player = audioPlayerRef.current
    const currentTime = player?.getCurrentTime?.() ?? 0
    setAudioDuration(duration)
    updateAudioProgress(currentTime, duration)
  }, [audioElement, updateAudioProgress])

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
    if (toggleWhileRecovering(playing)) {
      if (playing) setPlaying(false)
    } else {
      player.togglePlay()
    }
  }, [playing, toggleWhileRecovering])

  const seekRelative = useCallback((sec: number) => {
    const player = audioPlayerRef.current
    if (!player) return
    // While recovery holds a position, the element's own time is not it.
    if (seekWhileHeld((held) => held + sec)) return
    player.seekRelative(sec)
  }, [seekWhileHeld])

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
    seekWhileHeld(targetMs / 1000)
    startSeek()
    player.seekToFraction(fraction)
    commitSeek(targetMs, { lockSeek: false })
  }, [audioDuration, commitSeek, previewSeek, startSeek, seekWhileHeld])

  const handleMiniScrub = useCallback((fraction: number) => {
    const player = audioPlayerRef.current ?? scrubPlayerRef.current
    if (!player || !seekGestureActiveRef.current) return
    lastPreviewMsRef.current = Math.floor(fraction * (player.getDuration() || audioDuration) * 1000)
    player.scrubToFraction(fraction)
  }, [audioDuration])

  const finishEditorSeek = useCallback((reason: ScrubEndReason, lockSeek = true) => {
    if (!seekGestureActiveRef.current) return
    const player = audioPlayerRef.current
    // During recovery the drag's target replaces the held position; the
    // element's own time is not the position the user sees.
    const held = reason !== 'teardown' && seekWhileHeld(lastPreviewMsRef.current / 1000)
    const currentMs = held || reason === 'teardown' || !player
      ? lastPreviewMsRef.current
      : Math.floor(player.getCurrentTime() * 1000)
    seekGestureActiveRef.current = false
    scrubPlayerRef.current = null
    setExpandedPlayerScrubbing(false)
    if (lockSeek) commitSeek(currentMs)
    else commitSeek(currentMs, { lockSeek: false })
    if (reason !== 'teardown') setWaveformCollapsed(shouldCollapseWaveform())
  }, [commitSeek, shouldCollapseWaveform, setWaveformCollapsed, seekWhileHeld])

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
    playbackClock,
    handleAudioReady,
    handleAudioError,
    handlePlayingChange,
    handleTimeUpdate,
    handleSeeked,
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
