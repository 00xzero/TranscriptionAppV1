'use client'

import { useMemo } from 'react'
import type { Tag } from '@/contracts/db'
import { toast } from '@/components/ui/toaster'
import { randomUuid } from '@/lib/ids'
import { errorCode, isConflict, isGone, mapPeopleWriteError } from '@/lib/people/errors'
import { refreshAfterConflict } from '@/lib/people/refreshAfterConflict'
import { leastUsedSpeakerColor } from '@/lib/speakers/palette'
import {
  addTranscriptTag,
  createTranscriptTag,
  deleteTag,
  mergeTags,
  removeTranscriptTag,
  renameTag,
  setTagColor,
} from '@/lib/supabase/queries'
import { tagWriteFailure } from './failures'
import { provisionalTag, withLink, withMerge, withTag, withoutTag } from './snapshot'
import { useTags, type TagWrite, type TagsStore } from './TagsProvider'

export const UNCONFIRMED_TOAST = "Couldn't confirm that change — showing what's saved"

/**
 * Runs a list-surface write. A change made elsewhere reloads and says so; an
 * unknown outcome has already reloaded and says so; a local stop says
 * nothing. Any other refusal is passed on as an Error carrying its message and
 * code, so a dialog can show it in place (or the caller toasts it).
 */
export async function runTagWrite<T>(store: TagsStore, request: TagWrite<T>): Promise<T | undefined> {
  try {
    return await store.write(request)
  } catch (error) {
    switch (tagWriteFailure(error)) {
      case 'local':
        return undefined
      case 'unknown':
        toast({ title: UNCONFIRMED_TOAST, variant: 'error' })
        return undefined
      case 'refused':
        if (isConflict(error) || isGone(error)) {
          await refreshAfterConflict(store.reload)
          return undefined
        }
        // Keeps the code, so callers that map codes themselves still can.
        throw Object.assign(new Error(mapPeopleWriteError(error, 'tag')), { code: errorCode(error) })
    }
  }
}

/** The colour a new tag gets: the least used among the account's tags. */
export function newTagColor(tags: readonly Tag[]): string {
  return leastUsedSpeakerColor(tags.map((tag) => tag.color))
}

export type TagActions = ReturnType<typeof useTagActions>

/** Tag writes for the lists (rows, filter bar); the editor's go through its history instead. */
export function useTagActions() {
  const store = useTags()
  return useMemo(() => {
    const report = (error: unknown) =>
      toast({ title: error instanceof Error ? error.message : 'Something went wrong. Please try again.', variant: 'error' })

    return {
      add(transcriptId: string, tag: Tag) {
        runTagWrite(store, {
          edit: (s) => withLink(s, transcriptId, tag.id, true),
          send: () => addTranscriptTag(transcriptId, tag.id),
          tagIds: [tag.id],
        }).catch(report)
      },

      remove(transcriptId: string, tag: Tag) {
        runTagWrite(store, {
          edit: (s) => withLink(s, transcriptId, tag.id, false),
          send: () => removeTranscriptTag(transcriptId, tag.id),
          tagIds: [tag.id],
        }).catch(report)
      },

      create(transcriptId: string, name: string) {
        const id = randomUuid()
        const color = newTagColor(store.tags)
        runTagWrite(store, {
          edit: (s) => withLink(withTag(s, provisionalTag(id, name, color)), transcriptId, id, true),
          send: () => createTranscriptTag(transcriptId, id, name, color),
          settle: (s, result) => withLink(withTag(s, result.tag), transcriptId, result.tag.id, true),
          tagIds: [id],
        }).catch(report)
      },

      /** Rejects with a message to show; resolves once done or handled. */
      async rename(tag: Tag, name: string): Promise<void> {
        await runTagWrite(store, {
          edit: (s) => withTag(s, { ...tag, name }),
          send: () => renameTag(tag.id, tag.name, name),
          settle: (s, result) => withTag(s, result),
          tagIds: [tag.id],
        })
      },

      async recolour(tag: Tag, color: string): Promise<void> {
        await runTagWrite(store, {
          edit: (s) => withTag(s, { ...tag, color }),
          send: () => setTagColor(tag.id, tag.color, color),
          settle: (s, result) => withTag(s, result),
          tagIds: [tag.id],
        })
      },

      /** Deletes the tag and takes it off every transcript. */
      async delete(tag: Tag): Promise<void> {
        await runTagWrite(store, {
          edit: (s) => withoutTag(s, tag.id),
          send: () => deleteTag(tag.id),
          tagIds: [tag.id],
        })
      },

      /** Folds `from` into `into`. A merge that found `from` already gone reloads. */
      async merge(from: Tag, into: Tag): Promise<void> {
        const result = await runTagWrite(store, {
          edit: (s) => withMerge(s, from.id, into),
          send: () => mergeTags(from.id, into.id),
          settle: (s, answer) => withMerge(s, from.id, answer.tag),
          tagIds: [from.id, into.id],
        })
        if (result && !result.merged) void store.reload()
      },
    }
  }, [store])
}
