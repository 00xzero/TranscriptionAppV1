"use client"
import React, { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import AudioPlayer from '@/components/AudioPlayer'
import SpeakerPopoverContent from '@/components/SpeakerPopoverContent'
import ExportModal from '@/components/ExportModal'
import FindReplaceModal from '@/components/FindReplaceModal'
import CollapsibleWaveform, { MiniWaveformProgress } from '@/components/CollapsibleWaveform'
import FloatingPlayerDeck from '@/components/FloatingPlayerDeck'
import Waveform from '@/components/Waveform'
import { Popover, PopoverAnchor, PopoverContent, PopoverFrozenWhileClosed } from '@/components/ui/popover'
import { LoadingStatus } from '@/components/ui/loading-status'
import { TranscriptActionDialogs } from '@/components/TranscriptActionDialogs'
import { useTranscriptsData } from '@/lib/projects/ProjectsProvider'
import { transcriptActionTarget } from '@/lib/transcripts/actions'
import { useTranscriptActions } from '@/lib/transcripts/useTranscriptActions'
import TranscriptList from './components/TranscriptList'
import SyncToAudioButton from './components/SyncToAudioButton'
import EditorHeader from './components/EditorHeader'
import { useEditorData } from './hooks/useEditorData'
import { useTranscriptTitleEditing } from './hooks/useTranscriptTitleEditing'
import { useTranscriptMutations } from './hooks/useTranscriptMutations'
import { useSpeakerAssignments } from './hooks/useSpeakerAssignments'
import { useTranscriptSync } from './hooks/useTranscriptSync'
import { useEditorPlayback } from './hooks/useEditorPlayback'
import { useTranscriptSearch } from './hooks/useTranscriptSearch'
import { useEditorKeyboardShortcuts } from './hooks/useEditorKeyboardShortcuts'

export default function EditorScreen({ transcriptId }: { transcriptId: string }) {
  const router = useRouter()
  const { mutateTranscripts } = useTranscriptsData()

  // 1. Data layer
  const data = useEditorData(transcriptId)
  const actionTarget = transcriptActionTarget({
    id: transcriptId,
    title: data.transcriptTitle,
    project_id: data.transcriptProjectId,
  }, `Untitled (${transcriptId.slice(0, 8)}...)`)
  const transcriptActions = useTranscriptActions()

  // 2. Mutation hooks
  const editing = useTranscriptMutations({
    setSegments: data.setSegments,
  })

  const speakerHook = useSpeakerAssignments({
    transcriptId,
    speakers: data.speakers,
    segments: data.segments,
    peopleContext: data.peopleContext,
    setSpeakers: data.setSpeakers,
    setSegments: data.setSegments,
    setPeopleContext: data.setPeopleContext,
  })

  const handleTitleSaved = useCallback((newTitle: string) => {
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
  })

  // 3. Sync
  const sync = useTranscriptSync({
    segments: data.segments,
    editingId: editing.editingId,
    speakerPopover: speakerHook.speakerPopover,
  })

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

  // 5. Search + Export modal
  const [exportModalOpen, setExportModalOpen] = useState(false)

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
  })

  const openExportModal = useCallback(() => {
    search.setFindReplaceOpen(false)
    editing.setEditingId(null)
    speakerHook.closeSpeakerPopover('external')
    setExportModalOpen(true)
  }, [search.setFindReplaceOpen, editing.setEditingId, speakerHook.closeSpeakerPopover, setExportModalOpen])

  // 6. Keyboard shortcuts
  useEditorKeyboardShortcuts({
    togglePlay: playback.togglePlay,
    seekRelative: playback.seekRelative,
    openFindReplaceModal: search.openFindReplaceModal,
    openExportModal,
    handleReturnToTop: sync.handleReturnToTop,
  })

  // Derived values
  const uniqueSpeakerCount = speakerHook.presentation.identities.length

  const syncButtonVisible =
    sync.mode !== 'seeking' &&
    !sync.isFollowMode &&
    (!!sync.activeIds.segId || sync.hasUserScrolled) &&
    !speakerHook.speakerPopover &&
    !editing.editingId
  const waveformCollapsed = sync.waveformCollapsed && !playback.expandedPlayerScrubbing
  const didInteractOutsidePopoverRef = useRef(false)
  // True while the popover holds a name over the length limit; an outside click
  // then leaves it open rather than discarding the typed name.
  const holdSpeakerPopoverOpenRef = useRef(false)
  const setHoldSpeakerPopoverOpen = useCallback((hold: boolean) => {
    holdSpeakerPopoverOpenRef.current = hold
  }, [])

  return (
    <div className="editor-scroll-shell flex flex-col h-full relative">
      <div
        className={`absolute top-0 left-0 w-full z-40 transition-opacity duration-500 ${waveformCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        aria-hidden={!waveformCollapsed}
      >
        <MiniWaveformProgress
          audioProgress={playback.audioProgress}
          interactive={waveformCollapsed}
          onScrub={playback.handleMiniScrub}
          onScrubStart={playback.handleMiniScrubStart}
          onScrubEnd={playback.handleMiniScrubEnd}
        />
      </div>

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
        canReplace={true}
        hasMatches={search.hasMatches}
        matches={search.matches}
        segments={data.segments}
        matchIndex={search.matchIndex}
        onMatchClick={(idx: number) => search.setMatchIndex(idx)}
      />

      <div
        className="flex-1 overflow-auto pb-32 [overflow-anchor:none] [scrollbar-gutter:stable]"
        ref={sync.scrollContainerRef}
      >
        <CollapsibleWaveform
          collapsed={waveformCollapsed}
          contentRef={sync.expandedWaveformContainerRef}
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
                onDurationChange={playback.handleAudioDurationChange}
                onScrubPreview={playback.handleScrubPreview}
                onScrubPreviewFraction={playback.handleScrubPreviewFraction}
                onDragStart={playback.handlePlayerDragStart}
                onDragEnd={playback.handlePlayerDragEnd}
                initialPlaybackRate={playback.playbackRate}
                durationHint={data.transcriptDurationSecs}
                preferLargerDurationHint={data.waveformDurationSecs !== null}
                hideControls
                audioEngineOnly={data.peaks !== null}
              />
              {data.peaks ? (
                <Waveform
                  peaks={data.peaks}
                  currentTime={playback.audioCurrentTime}
                  duration={playback.audioDuration}
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
          uniqueSpeakerCount={uniqueSpeakerCount}
          status={data.status}
          editingTitle={title.editingTitle}
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
          scrollParent={sync.scrollParent}
          virtuosoRef={sync.virtuosoRef}
          onRangeChanged={sync.handleRangeChanged}
          activeSegId={sync.activeIds.segId}
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

      {exportModalOpen && (
        <ExportModal
          transcriptId={transcriptId}
          transcriptTitle={data.transcriptTitle}
          onClose={() => setExportModalOpen(false)}
        />
      )}

      <TranscriptActionDialogs actions={transcriptActions} onDeleted={() => router.replace('/transcripts')} />

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
          className="w-[min(19rem,calc(100vw-2rem))] overflow-hidden p-0"
          aria-label="Speaker assignment"
          // Prevent Radix auto-focus; SpeakerPopoverContent focuses its
          // own search input on mount (SpeakerPopoverContent.tsx useEffect)
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (holdSpeakerPopoverOpenRef.current) {
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
            />
          </PopoverFrozenWhileClosed>
        </PopoverContent>
      </Popover>
    </div>
  )
}
