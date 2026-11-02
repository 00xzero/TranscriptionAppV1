'use client'

import { useMemo } from 'react'
import { useTranscriptsData } from '@/lib/projects/ProjectsProvider'
import { useTagActions } from '@/lib/tags/actions'
import { useTags } from '@/lib/tags/TagsProvider'
import { TagPicker, tagLoadState } from './TagPicker'

/** The tag box for a transcript in a list: its writes go straight to the shared tags store. */
export function TranscriptTagPicker({ transcriptId, title }: { transcriptId: string; title: string }) {
  const store = useTags()
  const actions = useTagActions()
  const { transcripts } = useTranscriptsData()
  const listed = useMemo(() => new Set(transcripts.map((transcript) => transcript.id)), [transcripts])

  return (
    <TagPicker
      title={title}
      tags={store.tags}
      selected={store.tagsOf(transcriptId)}
      countOf={(tagId) => store.countFor(tagId, listed)}
      loadState={tagLoadState(store)}
      onRetry={store.reload}
      handlers={{
        onAdd: (tag) => actions.add(transcriptId, tag),
        onRemove: (tag) => actions.remove(transcriptId, tag),
        onCreate: (name) => actions.create(transcriptId, name),
        onRename: actions.rename,
        onRecolour: actions.recolour,
        onDelete: actions.delete,
        onMerge: actions.merge,
      }}
    />
  )
}
