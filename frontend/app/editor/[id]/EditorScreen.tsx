"use client"
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { useScrubberFocus } from '@/lib/audio/useScrubberFocus'
import AudioPlayer from '@/components/AudioPlayer'
import SpeakerPopoverContent from '@/components/SpeakerPopoverContent'
import ExportModal from '@/components/ExportModal'
import FindReplaceModal from '@/components/FindReplaceModal'
import CollapsibleWaveform, { MiniWaveformProgress } from '@/components/CollapsibleWaveform'
import FloatingPlayerDeck from '@/components/FloatingPlayerDeck'
import Waveform from '@/components/Waveform'
import { Popover, PopoverAnchor, PopoverContent, PopoverFrozenWhileClosed } from '@/components/ui/popover'
import { LoadingStatus } from '@/components/ui/loading-status'
import { toast } from '@/components/ui/toaster'
import { TranscriptActionDialogs } from '@/components/TranscriptActionDialogs'
import { useTranscriptsData } from '@/lib/projects/ProjectsProvider'
import { transcriptActionTarget } from '@/lib/transcripts/actions'
import { useTranscriptActions } from '@/lib/transcripts/useTranscriptActions'
import TranscriptList from './components/TranscriptList'
import SyncToAudioButton from './components/SyncToAudioButton'
import EditorHeader from './components/EditorHeader'
import { SpeakerSummaryButton } from './components/SpeakerSummaryButton'
import { SpeakersSidebar, type SpeakersSidebarHandle } from './components/SpeakersSidebar'
import { useEditorData, wordTimingsFailedToast } from './hooks/useEditorData'
import { useTranscriptTitleEditing } from './hooks/useTranscriptTitleEditing'
import { useTranscriptMutations } from './hooks/useTranscriptMutations'
import { useSpeakerAssignments } from './hooks/useSpeakerAssignments'
import { useEditorWriteQueue } from './hooks/useEditorWriteQueue'
import { useLiveStore } from './hooks/useLiveStore'
import { useSegmentSplit } from './hooks/useSegmentSplit'
import { useTranscriptSync } from './hooks/useTranscriptSync'
import { useEditorPlayback } from './hooks/useEditorPlayback'
import { useTranscriptSearch } from './hooks/useTranscriptSearch'
import { useEditorKeyboardShortcuts } from './hooks/useEditorKeyboardShortcuts'
import { useSpeakerOverview } from './hooks/useSpeakerOverview'
import { useKeepReadingPosition } from './hooks/useKeepReadingPosition'
import { createSegmentLocator } from './utils'
import { useSegmentHolds } from './hooks/useSegmentHolds'
import { useEditorHistory, type HistoryTarget } from './hooks/useEditorHistory'
import { useTextHistory } from './hooks/useTextHistory'
import { useLeaveEditor } from './hooks/useLeaveEditor'
import LeaveEditorDialog from './components/LeaveEditorDialog'
import { SendClosed, useUntilAnswered } from '@/lib/editor/untilAnswered'
import { publishUndoControls } from '@/lib/editor/undoControls'
import { fetchTranscriptById } from '@/lib/supabase/queries'
import { TRANSCRIPTION_ENGINE_LABELS } from '@/contracts/transcription-options'

const noSegmentOnServer = () => undefined
const noPositionOnServer = () => false

export default function EditorScreen({ transcriptId }: { transcriptId: string }) {
  const router = useRouter()
  const { mutateTranscripts } = useTranscriptsData()

  // 1. Data layer. Words that arrive out of step with the segments shown, or
  // that failed to load, come back with a reload of both, set up below once
  // the write queue and the text drafts exist.
  const reloadContentRef = useRef<() => void>(() => {})
  const reloadContent = useCallback(() => reloadContentRef.current(), [])
  const data = useEditorData(transcriptId, reloadContent)
  const actionTarget = transcriptActionTarget({
    id: transcriptId,
    title: data.transcriptTitle,
    project_id: data.transcriptProjectId,
  }, `Untitled (${transcriptId.slice(0, 8)}...)`)
  const transcriptActions = useTranscriptActions()

  // 2. Mutation hooks. Every write (text saves, speaker actions, splits,
  // titles) runs through one queue, and reads segments and words from the live
  // stores. Each write is sent until the database answers it; every one
  // recognises its own earlier success, so a resend is always safe.
  const enqueue = useEditorWriteQueue()
  const { send, reconnecting, isReconnecting } = useUntilAnswered()
  const holds = useSegmentHolds(isReconnecting, reconnecting)
  // The history reveals and refreshes through hooks set up after it.
  const bridge = useRef({ reveal: (_target: HistoryTarget) => {}, refresh: async () => false })
  const reveal = useCallback((target: HistoryTarget) => bridge.current.reveal(target), [])
  const refreshAll = useCallback(() => bridge.current.refresh(), [])
  const history = useEditorHistory({ enqueue, holds, reveal, refresh: refreshAll, isReconnecting, reconnecting })
  const { clear: clearHistory } = history
  const externalChange = useCallback((quiet: boolean) => {
    clearHistory(quiet ? undefined : 'This changed elsewhere')
  }, [clearHistory])
  const segmentsStore = useLiveStore(data.segments, data.setSegments)
  const wordsStore = useLiveStore(data.wordsBySegment, data.setWordsBySegment)
  const editing = useTranscriptMutations({
    transcriptId,
    segments: segmentsStore,
    words: wordsStore,
    enqueue,
    send,
    onExternalChange: externalChange,
  })
  const textHistory = useTextHistory(history, editing)
  // Leaving waits for what the editor has not saved yet.
  const leaving = useLeaveEditor({ queue: enqueue, editing, reconnecting })

  const speakerHook = useSpeakerAssignments({
    transcriptId,
    speakers: data.speakers,
    segments: data.segments,
    segmentsStore,
    peopleContext: data.peopleContext,
    setSpeakers: data.setSpeakers,
    setPeopleContext: data.setPeopleContext,
    enqueue,
    reloadSegments: editing.reloadSegments,
    isLoaded: data.isLoaded,
    send,
    history,
    holds,
  })

  const { reloadSegments } = editing
  useEffect(() => {
    reloadContentRef.current = () => {
      void enqueue(async () => {
        if (!(await reloadSegments())) toast(wordTimingsFailedToast(reloadContent))
      }, 'read').catch((error: unknown) => {
        // A closed editor has nothing to show it on; anything else is a bug.
        if (!(error instanceof SendClosed)) console.error('[editor] failed to reload word timings:', error)
      })
    }
  }, [enqueue, reloadSegments, reloadContent])

  const splitting = useSegmentSplit({ segments: segmentsStore, words: wordsStore, history, editing, send, holds })

  const handleTitleSaved = useCallback((newTitle: string | null) => {
    mutateTranscripts((current) =>
      current.map((transcript) =>
        transcript.id === transcriptId
          ? { ...transcript, title: newTitle }
          : transcript
      )
    )
  }, [mutateTranscripts, transcriptId])

  const title = useTranscriptTitleEditing({
    transcriptId,
    transcriptTitle: data.transcriptTitle,
    setTranscriptTitle: data.setTranscriptTitle,
    onTitleSaved: handleTitleSaved,
    send,
    history,
    holds,
  })

  // 3. Sync
  const sync = useTranscriptSync({
    segments: data.segments,
    editingId: editing.editingId,
    speakerPopover: speakerHook.speakerPopover,
  })

  // Undo and redo show where they changed something: the page scrolls there if
  // it is out of view, and the segments briefly light up.
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(() => new Set())
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])
  useEffect(() => {
    bridge.current = {
      // Runs inside the write queue after a change made elsewhere: segments,
      // then speakers and people alongside the title, each read until answered.
      refresh: async () => {
        if (!(await editing.reloadSegments())) return false
        const [speakersRead, row] = await Promise.all([speakerHook.refresh(), send(() => fetchTranscriptById(transcriptId))])
        if (!speakersRead || !row) return false
        data.setTranscriptTitle(row.title)
        handleTitleSaved(row.title)
        return true
      },
      reveal(target) {
        sync.suspendFollow('ui')
        if (target.title) { sync.handleReturnToTop(); return }
        const ids = target.ids ?? []
        const first = ids[0]
        const index = segmentsStore.get().findIndex((s) => s.id === first)
        if (index >= 0 && !sync.isSegmentSafelyVisible(first)) sync.scrollToSegmentIndex(index)
        setFlashing(new Set(ids))
        if (flashTimer.current) clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => setFlashing(new Set()), 1200)
        if (first && target.selection) editing.openEditorAt(first, target.selection)
      },
    }
  })
  useEffect(() => {
    publishUndoControls({ canUndo: history.canUndo, canRedo: history.canRedo, undoLabel: history.undoLabel,
      redoLabel: history.redoLabel, version: history.version, undo: history.undo, redo: history.redo, undoNames: history.undoNames,
      undoMany: history.undoMany, reconnecting })
    return () => publishUndoControls(null)
  }, [history.canUndo, history.canRedo, history.undoLabel, history.redoLabel, history.version, history.undo, history.redo,
    history.undoNames, history.undoMany, reconnecting])

  // 4. Playback
  const playback = useEditorPlayback({
    transcriptId,
    audioSrc: data.audioSrc,
    setAudioSrc: data.setAudioSrc,
    setStatus: data.setStatus,
    onAudioTick: sync.onAudioTick,
    startSeek: sync.startSeek,
    previewSeek: sync.previewSeek,
    commitSeek: sync.commitSeek,
    onWordSeek: sync.onWordSeek,
    onSegmentSeek: sync.onSegmentSeek,
    setWaveformCollapsed: sync.setWaveformCollapsed,
    shouldCollapseWaveform: sync.shouldCollapseForCurrentScroll,
  })

  const { handleMiniSeekStart, handleMiniSeekEnd, handleExpandedSeekStart, playbackClock } = playback

  // The current segment, straight from the playback clock. The card highlight
  // and the word highlight both follow it, so they switch in the same frame.
  // The scroll machine's active segment still drives scrolling, but it trails
  // the audio (offset, timeupdate-paced, held after seeks), so it only stands
  // in until the clock has a position. Primitive snapshots mean this screen
  // re-renders only when the current segment changes.
  const locateSegment = useMemo(() => createSegmentLocator(data.segments), [data.segments])
  const getClockSegId = useCallback(() => {
    const ms = playbackClock.getMs()
    return ms === null ? undefined : locateSegment(ms)
  }, [playbackClock, locateSegment])
  const getClockHasPosition = useCallback(() => playbackClock.getMs() !== null, [playbackClock])
  const clockSegId = useSyncExternalStore(playbackClock.subscribe, getClockSegId, noSegmentOnServer)
  const clockHasPosition = useSyncExternalStore(playbackClock.subscribe, getClockHasPosition, noPositionOnServer)
  const currentSegId = clockHasPosition ? clockSegId : sync.activeIds.segId

  // 5. Search + Export modal
  const [exportModalOpen, setExportModalOpen] = useState(false)

  // Replacing waits while a split or undo is pending, its text would be edited
  // against a shape about to change, and while the editor is reconnecting.
  const canReplace = !holds.any && !reconnecting
  const search = useTranscriptSearch({
    segments: data.segments,
    editingTexts: editing.editingTexts,
    setEditingTexts: editing.setEditingTexts,
    scheduleSave: editing.scheduleSave,
    setEditingId: editing.setEditingId,
    scrollToSegmentIndex: sync.scrollToSegmentIndex,
    suspendFollow: sync.suspendFollow,
    closeSpeakerPopover: speakerHook.closeSpeakerPopover,
    exportModalOpen,
    canReplace, recordReplace: textHistory.recordReplace,
  })

  const { setFindReplaceOpen } = search
  const { setEditingId } = editing
  const { closeSpeakerPopover } = speakerHook
  const openExportModal = useCallback(() => {
    setFindReplaceOpen(false)
    setEditingId(null)
    closeSpeakerPopover('external')
    setExportModalOpen(true)
  }, [setFindReplaceOpen, setEditingId, closeSpeakerPopover])

  // 6. Keyboard shortcuts
  useEditorKeyboardShortcuts({
    togglePlay: playback.togglePlay,
    seekRelative: playback.seekRelative,
    openFindReplaceModal: search.openFindReplaceModal,
    openExportModal,
    handleReturnToTop: sync.handleReturnToTop, onHistory: history.press,
  })

  // 7. Speakers sidebar
  const speakerOverview = useSpeakerOverview({
    segments: data.segments,
    speakers: data.speakers,
    presentation: speakerHook.presentation,
    displayForSpeaker: speakerHook.displayForSpeaker,
    durationSecs: data.transcriptDurationSecs,
  })
  const speakersSidebarId = useId()
  const speakerButtonRef = useRef<HTMLButtonElement>(null)
  const speakersSidebarRef = useRef<SpeakersSidebarHandle>(null)
  const [speakersOpen, setSpeakersOpen] = useState(false)
  const { keepReadingPosition, releaseReadingPosition } = useKeepReadingPosition({
    scrollRef: sync.transcriptScrollRef,
    virtuosoRef: sync.virtuosoRef,
    segments: data.segments,
    activeSegId: sync.activeIds.segId,
    markProgrammaticScroll: sync.markProgrammaticScroll,
  })
  const closeSpeakers = useCallback(() => {
    keepReadingPosition(() => setSpeakersOpen(false))
    // The button sits in the transcript scroller; a plain focus() after a long
    // jump would scroll back up to it and lose the reader's place.
    speakerButtonRef.current?.focus({ preventScroll: true })
  }, [keepReadingPosition])
  const toggleSpeakers = useCallback(() => {
    if (speakersOpen) closeSpeakers()
    else keepReadingPosition(() => setSpeakersOpen(true))
  }, [speakersOpen, closeSpeakers, keepReadingPosition])

  const { onSegmentJump } = sync
  const { seekToMs } = playback

  // From the speaker popover: open the sidebar on that speaker's turn. The
  // popover closes first; the transcript stays where it is, already on that turn.
  const showInSpeakers = useCallback(() => {
    const segmentId = speakerHook.speakerPopover?.segmentId
    closeSpeakerPopover('external')
    if (!speakersOpen) keepReadingPosition(() => setSpeakersOpen(true))
    if (segmentId) speakersSidebarRef.current?.reveal(segmentId)
  }, [speakerHook.speakerPopover?.segmentId, closeSpeakerPopover, speakersOpen, keepReadingPosition])

  // A jump from the sidebar: one scroll (the machine's), and the audio moves
  // there with play or pause unchanged. An open edit or popover closes first.
  const jumpToSegment = useCallback((segmentId: string) => {
    const segment = data.segments.find((candidate) => candidate.id === segmentId)
    if (!segment) return
    // A jump inside the settling window after the sidebar opens or closes must
    // not be scrolled back to the old reading place.
    releaseReadingPosition()
    closeSpeakerPopover('external')
    setEditingId(null)
    onSegmentJump(segmentId)
    seekToMs(segment.start_ms)
  }, [data.segments, releaseReadingPosition, closeSpeakerPopover, setEditingId, onSegmentJump, seekToMs])

  // Derived values

  const syncButtonVisible =
    sync.mode !== 'seeking' &&
    !sync.isFollowMode &&
    (!!sync.activeIds.segId || sync.hasUserScrolled) &&
    !speakerHook.speakerPopover &&
    !editing.editingId
  const waveformCollapsed = sync.waveformCollapsed && !playback.expandedPlayerScrubbing
  const { attachExpanded, attachMini, trackExpandedFocus, trackMiniFocus, trackBlur } = useScrubberFocus(waveformCollapsed, data.peaks !== null)
  const { expandedWaveformContainerRef } = sync
  const expandedWaveformRef = useCallback((element: HTMLDivElement | null) => {
    attachExpanded(element)
    expandedWaveformContainerRef(element)
  }, [attachExpanded, expandedWaveformContainerRef])

  const didInteractOutsidePopoverRef = useRef(false)
  // True while the popover holds a name over the length limit; an outside click
  // then leaves it open rather than discarding the typed name.
  const holdSpeakerPopoverOpenRef = useRef(false)
  const setHoldSpeakerPopoverOpen = useCallback((hold: boolean) => {
    holdSpeakerPopoverOpenRef.current = hold
  }, [])

  return (
    <div className="editor-scroll-shell flex flex-col h-full relative">
      <FindReplaceModal
        open={search.findReplaceOpen}
        onClose={() => search.setFindReplaceOpen(false)}
        findInput={search.findInput}
        setFindInput={search.setFindInput}
        findTerm={search.findTerm}
        replaceTerm={search.replaceTerm}
        setReplaceTerm={search.setReplaceTerm}
        caseSensitive={search.caseSensitive}
        setCaseSensitive={search.setCaseSensitive}
        wholeWord={search.wholeWord}
        setWholeWord={search.setWholeWord}
        onNext={search.handleNext}
        onPrev={search.handlePrev}
        onReplace={search.handleReplace}
        onReplaceAll={search.handleReplaceAll}
        onFindKeyDown={search.onFindKeyDown}
        onClear={search.clearSearch}
        matchSummary={search.matchSummary}
        canNavigate={search.canNavigate}
        canReplace={canReplace}
        matches={search.matches}
        segments={data.segments}
        matchIndex={search.matchIndex}
        onMatchClick={(idx: number) => search.setMatchIndex(idx)}
      />

      <div className="relative flex min-h-0 flex-1">
        {/* The mini scrubber spans the editor, including the Speakers panel. */}
        <div
          className={`absolute top-0 left-0 w-full z-(--z-editor-mini-scrubber) transition-opacity duration-500 ${waveformCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          inert={!waveformCollapsed}
          ref={attachMini}
          onFocusCapture={trackMiniFocus}
          onBlurCapture={trackBlur}
        >
          <MiniWaveformProgress
            audioProgress={playback.audioProgress}
            duration={playback.audioDuration}
            sourceKey={data.audioSrc}
            onSeek={playback.handleMiniSeek}
            onSeekStart={handleMiniSeekStart}
            onSeekEnd={handleMiniSeekEnd}
            interactive={waveformCollapsed}
            onScrub={playback.handleMiniScrub}
            onScrubStart={playback.handleMiniScrubStart}
            onScrubEnd={playback.handleMiniScrubEnd}
          />
        </div>

        {/* The transcript column: the player and sync button centre on it, not the window. */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div
            className="flex-1 overflow-auto pb-32 [overflow-anchor:none] [scrollbar-gutter:stable]"
            ref={sync.scrollContainerRef}
          >
            <CollapsibleWaveform
              collapsed={waveformCollapsed}
              contentRef={expandedWaveformRef}
              onFocusCapture={trackExpandedFocus}
              onBlurCapture={trackBlur}
              expandedHeight={sync.expandedWaveformHeight}
              pinned={playback.expandedPlayerScrubbing}
            >
              {data.audioSrc ? (
                <>
                  <AudioPlayer
                    ref={playback.handleAudioPlayerRef}
                    src={data.audioSrc}
                    onReady={playback.handleAudioReady}
                    onError={playback.handleAudioError}
                    onPlayingChange={playback.handlePlayingChange}
                    onTimeUpdate={playback.handleTimeUpdate}
                    onSeeked={playback.handleSeeked}
                    onDurationChange={playback.handleAudioDurationChange}
                    onScrubPreview={playback.handleScrubPreview}
                    onScrubPreviewFraction={playback.handleScrubPreviewFraction}
                    onSeekStart={handleExpandedSeekStart}
                    onSeekEnd={handleMiniSeekEnd}
                    onDragStart={playback.handlePlayerDragStart}
                    onDragEnd={playback.handlePlayerDragEnd}
                    initialPlaybackRate={playback.playbackRate}
                    durationHint={data.transcriptDurationSecs}
                    preferLargerDurationHint={data.waveformDurationSecs !== null}
                    hideControls
                    audioEngineOnly={data.peaks !== null}
                    interactive={!waveformCollapsed}
                  />
                  {data.peaks ? (
                    <Waveform
                      peaks={data.peaks}
                      currentTime={playback.audioCurrentTime}
                      duration={playback.audioDuration}
                      sourceKey={data.audioSrc}
                      interactive={!waveformCollapsed}
                      onSeek={playback.handleMiniSeek}
                      onSeekStart={handleExpandedSeekStart}
                      onSeekEnd={handleMiniSeekEnd}
                      onScrub={playback.handleMiniScrub}
                      onScrubStart={playback.handleExpandedScrubStart}
                      onScrubEnd={playback.handleExpandedScrubEnd}
                    />
                  ) : null}
                </>
              ) : (
                <LoadingStatus message="Loading audio..." className="h-12 flex items-center justify-center text-muted">
                  <span aria-hidden="true">Loading audio...</span>
                </LoadingStatus>
              )}
            </CollapsibleWaveform>

            <EditorHeader
              displayTitle={actionTarget.title}
              transcriptCreatedAt={data.transcriptCreatedAt}
              transcriptDurationSecs={data.transcriptDurationSecs}
              engineLabel={data.transcriptEngine ? TRANSCRIPTION_ENGINE_LABELS[data.transcriptEngine] : null}
              speakerSummary={speakerOverview.rows.length > 0 ? (
          <SpeakerSummaryButton
            ref={speakerButtonRef}
            overview={speakerOverview}
            expanded={speakersOpen}
            controlsId={speakersSidebarId}
            onToggle={toggleSpeakers}
          />
        ) : undefined}
              status={data.status}
              editingTitle={title.editingTitle}
              titleBusy={holds.locked.has('title')}
              titleInput={title.titleInput}
              setTitleInput={title.setTitleInput}
              titleInputRef={title.titleInputRef}
              titleSaveError={title.titleSaveError}
              startEditingTitle={title.startEditingTitle}
              onTitleKeyDown={title.onTitleKeyDown}
              onTitleBlur={title.onTitleBlur}
              onDeleteClick={() => transcriptActions.openDelete(actionTarget)}
              onMoveClick={() => transcriptActions.openMove(actionTarget)}
            />

            <TranscriptList
              segments={data.segments}
              wordsBySegment={data.wordsBySegment}
              busy={holds.busy}
              isLocked={holds.isLocked}
              playbackClock={playbackClock}
              scrollParent={sync.scrollParent}
              virtuosoRef={sync.virtuosoRef}
              onRangeChanged={sync.handleRangeChanged}
              activeSegId={currentSegId}
              matchesBySeg={search.matchesBySeg}
              matchIndex={search.matchIndex}
              displayForSpeaker={speakerHook.displayForSpeaker}
              editingId={editing.editingId}
              editingTexts={editing.editingTexts}
              saveStatus={editing.saveStatus}
              onSegmentClick={playback.onSegmentClick}
              onWordClick={playback.onWordClick}
              onSpeakerClick={speakerHook.handleAvatarClick}
              setEditingId={editing.setEditingId}
              setEditingTexts={editing.setEditingTexts}
              scheduleSave={editing.scheduleSave}
              onSplit={splitting.split}
              caretHint={editing.caretHint}
              flashing={flashing}
              onTextInput={textHistory.onTextInput}
              sealTyping={textHistory.seal}
              endDrag={textHistory.endDrag}
              onHistory={history.press}
            />
          </div>

          <SyncToAudioButton
            visible={syncButtonVisible}
            syncDirection={sync.syncDirection}
            onSync={sync.resumeFollow}
          />

          <FloatingPlayerDeck
            currentTime={playback.audioCurrentTime}
            duration={playback.audioDuration}
            playing={playback.playing}
            playbackRate={playback.playbackRate}
            onTogglePlay={playback.togglePlay}
            onSeekRelative={playback.seekRelative}
            onRateChange={playback.onRateChange}
          />
        </div>

        <SpeakersSidebar
          ref={speakersSidebarRef}
          id={speakersSidebarId}
          open={speakersOpen}
          overview={speakerOverview}
          onJump={jumpToSegment}
          onClose={closeSpeakers}
        />
      </div>

      {exportModalOpen && (
        <ExportModal
          transcriptId={transcriptId}
          transcriptTitle={data.transcriptTitle}
          onClose={() => setExportModalOpen(false)}
        />
      )}

      <TranscriptActionDialogs actions={transcriptActions} onDeleted={() => { leaving.abandon(); router.replace('/transcripts') }} />

      <LeaveEditorDialog
        phase={leaving.phase}
        hasUnsaved={leaving.hasUnsaved()}
        onStay={leaving.stay}
        onLeave={leaving.leaveAnyway}
        onCopy={() => { void leaving.copyUnsaved() }}
      />

      <Popover
        open={!!speakerHook.speakerPopover}
        onOpenChange={(open) => {
          if (!open) {
            const reason = didInteractOutsidePopoverRef.current ? 'outside' : 'dismiss'
            didInteractOutsidePopoverRef.current = false
            speakerHook.closeSpeakerPopover(reason)
          }
        }}
      >
        <PopoverAnchor virtualRef={speakerHook.anchorRef} />
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={8}
          className="w-[min(20rem,calc(100vw-2rem))] overflow-hidden p-0"
          aria-label="Speaker assignment"
          // Prevent Radix auto-focus; SpeakerPopoverContent focuses its
          // own search input on mount (SpeakerPopoverContent.tsx useEffect)
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (holdSpeakerPopoverOpenRef.current) {
              event.preventDefault()
              return
            }
            // Radix dismisses after the click, so a press on a speaker name
            // would close the picker that name's click just opened. The click
            // decides instead: another name moves the picker, the same one
            // closes it (handleAvatarClick).
            if (event.detail.originalEvent.type === 'pointerdown'
              && event.target instanceof Element && event.target.closest('[data-speaker-trigger]')) {
              event.preventDefault()
              return
            }
            didInteractOutsidePopoverRef.current = true
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()

            const shouldRestoreFocus =
              speakerHook.closeReasonRef.current !== 'outside' &&
              speakerHook.closeReasonRef.current !== 'external'
            const triggerElement = speakerHook.lastTriggerElementRef.current

            if (shouldRestoreFocus && triggerElement?.isConnected) {
              window.setTimeout(() => triggerElement.focus(), 0)
            }

            didInteractOutsidePopoverRef.current = false
            speakerHook.closeReasonRef.current = null
          }}
        >
          <PopoverFrozenWhileClosed open={!!speakerHook.speakerPopover}>
            <SpeakerPopoverContent
              key={speakerHook.speakerPopover?.segmentId}
              transcriptId={transcriptId}
              presentation={speakerHook.presentation}
              peopleContext={data.peopleContext}
              currentSpeaker={speakerHook.currentSpeaker}
              scopes={speakerHook.scopes}
              removable={speakerHook.removable}
              onSelectTarget={speakerHook.selectTarget}
              onRemove={speakerHook.removeSpeaker}
              onRenameLocal={speakerHook.renameLocal}
              onRenamePerson={speakerHook.renameLinkedPerson}
              labelForSpeaker={speakerHook.labelForSpeaker}
              displayForSpeaker={speakerHook.displayForSpeaker}
              onHoldOpenChange={setHoldSpeakerPopoverOpen}
              onShowInSpeakers={showInSpeakers}
            />
          </PopoverFrozenWhileClosed>
        </PopoverContent>
      </Popover>
    </div>
  )
}
