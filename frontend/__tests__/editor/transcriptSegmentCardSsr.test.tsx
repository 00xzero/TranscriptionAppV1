/** @jest-environment node */

import React from 'react'
import { renderToString } from 'react-dom/server'
import TranscriptSegmentCard from '@/app/(app)/editor/[id]/components/TranscriptSegmentCard'
import { createPlaybackClock } from '@/app/(app)/editor/[id]/playbackClock'
import { TooltipProvider } from '@/components/ui/tooltip'

// The editor page is a server component rendering EditorScreen, so the card's
// useSyncExternalStore needs a server snapshot or React falls back to client
// rendering with an error.
it('server-renders the current segment without a store error and without highlighting', () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {})
  const clock = createPlaybackClock()
  clock.attach(() => 1600)
  clock.refresh() // even with a position, the server shows no highlight

  const html = renderToString(
    <TooltipProvider>
      <TranscriptSegmentCard
        segment={{
          id: 's1', transcript_id: 't1', speaker_id: null, diarization_index: null,
          start_ms: 1000, end_ms: 3000, text: 'Hello there, friend.',
          is_edited: false, is_filler: false, algo_version: 'test', revision: 0,
          created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z',
        }}
        sourceWords={[
          { text: 'Hello', startMs: 1000, endMs: 1300 },
          { text: 'there,', startMs: 1500, endMs: 1900 },
          { text: 'friend.', startMs: 2200, endMs: 3000 },
        ]}
        isActive
        playbackClock={clock}
        matchesForSeg={[]}
        matchIndex={-1}
        speakerLabel="Speaker 1" speakerColor="#4F638C" speakerAvatar="S1" speakerOrganisation={null}
        needHeader
        isEditing={false}
        editingText={undefined}
        saveStatus={undefined}
        onSegmentClick={() => {}}
        onWordClick={() => {}}
        onSpeakerClick={() => {}}
        setEditingId={() => {}}
        setEditingTexts={() => {}}
        scheduleSave={() => {}}
        busy={undefined}
        locked={false}
        onSplit={() => {}}
        caretHint={() => undefined}
        flashing={false}
        onTextInput={() => {}}
        sealTyping={() => {}}
        onHistory={() => {}}
      />
    </TooltipProvider>
  )

  expect(html).toContain('friend.')
  expect(html).not.toContain('text-ember-red')
  expect(error).not.toHaveBeenCalled()
  error.mockRestore()
})
