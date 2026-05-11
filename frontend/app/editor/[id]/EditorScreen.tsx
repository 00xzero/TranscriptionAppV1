"use client"
import React, { useCallback, useMemo, useRef, useState } from 'react'
import AudioPlayer from '@/components/AudioPlayer'
import SpeakerPopoverContent from '@/components/SpeakerPopoverContent'
import ExportModal from '@/components/ExportModal'
import FindReplaceModal from '@/components/FindReplaceModal'
import CollapsibleWaveform, { MiniWaveformProgress } from '@/components/CollapsibleWaveform'
import FloatingPlayerDeck from '@/components/FloatingPlayerDeck'
import Waveform from '@/components/Waveform'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import TranscriptList from './components/TranscriptList'
import SyncToAudioButton from './components/SyncToAudioButton'
import EditorHeader from './components/EditorHeader'
import { useEditorData } from './hooks/useEditorData'
import { useProjectTitleEditing } from './hooks/useProjectTitleEditing'
import { useTranscriptMutations } from './hooks/useTranscriptMutations'
import { useSpeakerAssignments } from './hooks/useSpeakerAssignments'
import { useTranscriptSync } from './hooks/useTranscriptSync'
import { useEditorPlayback } from './hooks/useEditorPlayback'
import { useTranscriptSearch } from './hooks/useTranscriptSearch'
import { useEditorKeyboardShortcuts } from './hooks/useEditorKeyboardShortcuts'

export default function EditorScreen({ projectId }: { projectId: string }) {
  // 1. Data layer
  const data = useEditorData(projectId)

  // 2. Mutation hooks
  const editing = useTranscriptMutations({
    setSegments: data.setSegments,
  })

  const speakerHook = useSpeakerAssignments({
    projectId,
    speakers: data.speakers,
    setSpeakers: data.setSpeakers,
    setSegments: data.setSegments,
    reloadTranscript: data.reloadTranscript,
  })

  const title = useProjectTitleEditing({
    projectId,
    projectTitle: data.projectTitle,
    setProjectTitle: data.setProjectTitle,
  })

  // 3. Sync
  const sync = useTranscriptSync({
    segments: data.segments,
    editingId: editing.editingId,
    speakerPopover: speakerHook.speakerPopover,
  })

  // 4. Playback
  const playback = useEditorPlayback({
    projectId,
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
  const uniqueSpeakerCount = useMemo(() => {
    const ids = new Set(data.segments.map(s => s.speaker_id).filter(Boolean))
    return ids.size
  }, [data.segments])

  const currentSpeaker = useMemo(() => {
    const speakerId = speakerHook.speakerPopover?.speakerId
    return speakerId ? data.speakers.find(s => s.id === speakerId) : undefined
  }, [data.speakers, speakerHook.speakerPopover])

  const syncButtonVisible =
    sync.mode !== 'seeking' &&
    !sync.isFollowMode &&
    (!!sync.activeIds.segId || sync.hasUserScrolled) &&
    !speakerHook.speakerPopover &&
    !editing.editingId
  const waveformCollapsed = sync.waveformCollapsed && !playback.expandedPlayerScrubbing
  const didInteractOutsidePopoverRef = useRef(false)

  return (
    <div className="flex flex-col h-full relative">
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
        className="flex-1 overflow-auto pb-32"
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
                onScrubPreview={playback.handleScrubPreview}
                onScrubPreviewFraction={playback.handleScrubPreviewFraction}
                onDragStart={playback.handlePlayerDragStart}
                onDragEnd={playback.handlePlayerDragEnd}
                initialPlaybackRate={playback.playbackRate}
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
            <div className="h-12 flex items-center justify-center text-muted">
              Loading audio...
            </div>
          )}
        </CollapsibleWaveform>

        <EditorHeader
          projectId={projectId}
          projectTitle={data.projectTitle}
          projectCreatedAt={data.projectCreatedAt}
          projectDurationSecs={data.projectDurationSecs}
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
        />

        <TranscriptList
          segments={data.segments}
          scrollParent={sync.scrollParent}
          virtuosoRef={sync.virtuosoRef}
          onRangeChanged={sync.handleRangeChanged}
          activeSegId={sync.activeIds.segId}
          matchesBySeg={search.matchesBySeg}
          matchIndex={search.matchIndex}
          speakersMap={speakerHook.speakersMap}
          colorForSpeaker={speakerHook.colorForSpeaker}
          editingId={editing.editingId}
          editingTexts={editing.editingTexts}
          saveStatus={editing.saveStatus}
          textAreaRefs={editing.textAreaRefs}
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
          projectId={projectId}
          projectTitle={data.projectTitle}
          onClose={() => setExportModalOpen(false)}
        />
      )}

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
          className="w-72 p-0"
          aria-label="Speaker assignment"
          // Prevent Radix auto-focus; SpeakerPopoverContent focuses its
          // own search input on mount (SpeakerPopoverContent.tsx useEffect)
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={() => {
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
          <SpeakerPopoverContent
            speakers={data.speakers}
            currentSpeaker={currentSpeaker}
            onSelectSpeaker={speakerHook.handleSelectSpeaker}
            onCreateSpeaker={speakerHook.handleCreateSpeaker}
            onRenameSpeaker={speakerHook.handleRenameSpeaker}
            onUntag={speakerHook.handleUntag}
            getColorForSpeaker={speakerHook.colorForSpeaker}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
