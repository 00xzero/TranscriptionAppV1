import { useMemo } from 'react'
import type { Tag } from '@/contracts/db'
import { tagLoadState, type TagPickerHandlers } from '@/components/Tags/TagPicker'
import { toast } from '@/components/ui/toaster'
import type { Send } from '@/lib/editor/untilAnswered'
import { randomUuid } from '@/lib/ids'
import { useTranscriptsData } from '@/lib/projects/ProjectsProvider'
import { addTranscriptTag, createTranscriptTag, removeTranscriptTag, undoCreatedTag } from '@/lib/supabase/queries'
import { newTagColor, useTagActions } from '@/lib/tags/actions'
import { provisionalTag, withLink, withTag, withoutTag } from '@/lib/tags/snapshot'
import { useTags } from '@/lib/tags/TagsProvider'
import type { EditorHistory, HistoryStep } from './useEditorHistory'
import type { SegmentHolds } from './useSegmentHolds'

const TOUCHES = ['tags'] as const
const showTitle = () => ({ title: true })

export const keptToast = (name: string) => `Kept “${name}”: another transcript uses it now. Took it off this one.`

/**
 * The open transcript's tags, as steps of the editor's history. Adding and
 * removing a tag are plain links. Creating one is a step of its own: undoing
 * it deletes the tag, unless another transcript uses it by then, when it only
 * comes off this one. A create that found another tag with the name used that
 * one instead, and is from then on a plain add of it.
 *
 * Every write is sent until answered and recognises its own earlier success,
 * so a create whose answer was lost finds its tag under the id it asked for
 * and stays a create. Renaming, recolouring, deleting and merging change every
 * transcript, so they go straight to the shared store, outside the history.
 */
export function useTranscriptTags({ transcriptId, send, history, holds }: {
  transcriptId: string
  send: Send
  history: EditorHistory
  holds: SegmentHolds
}) {
  const store = useTags()
  const actions = useTagActions()
  const { transcripts } = useTranscriptsData()
  const { original } = history
  const { blocked } = holds
  const { write } = store
  const listed = useMemo(() => new Set(transcripts.map((transcript) => transcript.id)), [transcripts])

  const handlers = useMemo<TagPickerHandlers>(() => {
    // Puts a tag on the transcript, or takes it off, sent until answered.
    const link = async (tagId: string, on: boolean) => {
      await write({
        edit: (s) => withLink(s, transcriptId, tagId, on),
        send: () => (on ? addTranscriptTag(transcriptId, tagId) : removeTranscriptTag(transcriptId, tagId)),
        via: send,
        tagIds: [tagId],
      })
    }

    const linkStep = (tag: Tag, on: boolean): HistoryStep => ({
      label: on ? 'add tag' : 'remove tag',
      quote: () => tag.name,
      failure: on ? "Couldn't add the tag" : "Couldn't remove the tag",
      scope: 'tags',
      touches: TOUCHES,
      target: showTitle,
      async run(dir, applied) {
        await link(tag.id, dir === 'redo' ? on : !on)
        applied()
      },
    })

    const create = (name: string, taken: readonly Tag[]) => {
      const id = randomUuid()
      const color = newTagColor(taken)
      // The tag this step stands for; another one once a create adopts a namesake.
      let current = { id, name }
      let creates = true

      const make = async () => {
        const result = await write({
          edit: (s) => withLink(withTag(s, provisionalTag(id, name, color)), transcriptId, id, true),
          send: () => createTranscriptTag(transcriptId, id, name, color),
          via: send,
          settle: (s, answer) => withLink(withTag(s, answer.tag), transcriptId, answer.tag.id, true),
          tagIds: [id],
        })
        if (result.outcome === 'adopted') {
          creates = false
          current = { id: result.tag.id, name: result.tag.name }
        }
      }

      const unmake = async () => {
        let shownName = current.name
        const outcome = await write({
          edit: (s) => withLink(s, transcriptId, id, false),
          send: () => undoCreatedTag(transcriptId, id),
          via: send,
          settle: (s, answer) => {
            shownName = s.tags.find((tag) => tag.id === id)?.name ?? shownName
            return answer === 'kept' ? withLink(s, transcriptId, id, false) : withoutTag(s, id)
          },
          tagIds: [id],
        })
        if (outcome === 'kept') toast({ title: keptToast(shownName) })
      }

      const step: HistoryStep = {
        get label() { return creates ? 'create tag' : 'add tag' },
        quote: () => current.name,
        failure: "Couldn't create the tag",
        scope: 'tags',
        touches: TOUCHES,
        target: showTitle,
        async run(dir, applied) {
          if (!creates) await link(current.id, dir === 'redo')
          else if (dir === 'undo') await unmake()
          else await make()
          applied()
        },
      }
      original(step, make)
    }

    return {
      onAdd: (tag) => { if (!blocked(TOUCHES)) original(linkStep(tag, true), () => link(tag.id, true)) },
      onRemove: (tag) => { if (!blocked(TOUCHES)) original(linkStep(tag, false), () => link(tag.id, false)) },
      onCreate: (name) => { if (!blocked(TOUCHES)) create(name, store.tags) },
      onRename: actions.rename,
      onRecolour: actions.recolour,
      onDelete: actions.delete,
      onMerge: actions.merge,
    }
  }, [write, send, transcriptId, original, blocked, store.tags, actions])

  return {
    tags: store.tagsOf(transcriptId),
    allTags: store.tags,
    countOf: (tagId: string) => store.countFor(tagId, listed),
    handlers,
    blocked: blocked(TOUCHES),
    loadState: tagLoadState(store),
    reload: store.reload,
  }
}
