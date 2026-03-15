"use client"
import React, { useCallback, useMemo, useState } from 'react'
import AudioPlayer from '@/components/AudioPlayer'
import SpeakerPopover from '@/components/SpeakerPopover'
import ExportModal from '@/components/ExportModal'
import FindReplaceModal from '@/components/FindReplaceModal'
import CollapsibleWaveform from '@/components/CollapsibleWaveform'
import FloatingPlayerDeck from '@/components/FloatingPlayerDeck'
import TranscriptList from './components/TranscriptList'
import MixModeBanner from './components/MixModeBanner'
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
    source: data.source,
    setSegments: data.setSegments,
  })

  const speakerHook = useSpeakerAssignments({
    projectId,
    speakers: data.speakers,
    setSpeakers: data.setSpeakers,
    segments: data.segments,
    setSegments: data.setSegments,
    source: data.source,
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
    syncActiveSegment: sync.syncActiveSegment,
    findActiveSegmentId: sync.findActiveSegmentId,
    activeIds: sync.activeIds,
    setActiveIds: sync.setActiveIds,
    isFollowMode: sync.isFollowMode,
    ensureActiveSegmentVisible: sync.ensureActiveSegmentVisible,
    isScrubbingRef: sync.isScrubbingRef,
    setWaveformCollapsed: sync.setWaveformCollapsed,
    transcriptScrollRef: sync.transcriptScrollRef,
    setSeekLock: sync.setSeekLock,
    clearSeekLock: sync.clearSeekLock,
  })

  // 5. Search + Export modal
  const [exportModalOpen, setExportModalOpen] = useState(false)

  const search = useTranscriptSearch({
    segments: data.segments,
    source: data.source,
    editingTexts: editing.editingTexts,
    setEditingTexts: editing.setEditingTexts,
    scheduleSave: editing.scheduleSave,
    setEditingId: editing.setEditingId,
    scrollToSegmentIndex: sync.scrollToSegmentIndex,
    setIsFollowMode: sync.setIsFollowMode,
    setSpeakerPopover: speakerHook.setSpeakerPopover,
    exportModalOpen,
  })

  const openExportModal = useCallback(() => {
    search.setFindReplaceOpen(false)
    editing.setEditingId(null)
    speakerHook.setSpeakerPopover(null)
    setExportModalOpen(true)
  }, [search.setFindReplaceOpen, editing.setEditingId, speakerHook.setSpeakerPopover])

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

  const syncButtonVisible = !sync.isFollowMode && (!!sync.activeIds.segId || sync.hasUserScrolled) && !speakerHook.speakerPopover && !editing.editingId


  return (
    <div className="flex flex-col h-full relative">
      <CollapsibleWaveform
        collapsed={sync.waveformCollapsed}
        audioProgress={playback.audioProgress}
        onScrub={playback.handleMiniScrub}
        onScrubStart={playback.handleMiniScrubStart}
        onScrubEnd={playback.handleMiniScrubEnd}
      >
        {data.audioSrc ? (
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
          />
        ) : (
          <div className="h-12 flex items-center justify-center text-muted">
            Loading audio...
          </div>
        )}
      </CollapsibleWaveform>

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
        canReplace={data.source !== 'segments'}
        hasMatches={search.hasMatches}
        matches={search.matches}
        segments={data.segments}
        matchIndex={search.matchIndex}
        onMatchClick={(idx: number) => search.setMatchIndex(idx)}
      />

      <MixModeBanner visible={data.source === 'segments'} collapsed={sync.waveformCollapsed} />

      <div
        className={`flex-1 overflow-auto pb-32 ${sync.waveformCollapsed ? 'pt-[56px]' : 'pt-0'}`}
        ref={sync.scrollContainerRef}
      >
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
          source={data.source}
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

      {speakerHook.speakerPopover && (
        <SpeakerPopover
          speakers={data.speakers}
          currentSpeaker={speakerHook.speakerPopover.speakerId ? data.speakers.find(s => s.id === speakerHook.speakerPopover!.speakerId) : undefined}
          anchorRect={speakerHook.speakerPopover.anchorRect}
          onSelectSpeaker={speakerHook.handleSelectSpeaker}
          onCreateSpeaker={speakerHook.handleCreateSpeaker}
          onRenameSpeaker={speakerHook.handleRenameSpeaker}
          onUntag={speakerHook.handleUntag}
          onClose={() => speakerHook.setSpeakerPopover(null)}
          getColorForSpeaker={speakerHook.colorForSpeaker}
        />
      )}
    </div>
  )
}
