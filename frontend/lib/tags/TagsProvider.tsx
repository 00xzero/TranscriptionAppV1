'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Tag } from '@/contracts/db'
import { SendClosed, type Send } from '@/lib/editor/untilAnswered'
import { fetchTags, fetchTranscriptTags } from '@/lib/supabase/queries'
import { tagWriteFailure } from './failures'
import type { TagsEdit, TagsSnapshot } from './snapshot'

export type TagWrite<T> = {
  /** Shown at once and kept on top of every reload until the write settles. */
  edit?: TagsEdit
  /** Sends the write once. */
  send: () => Promise<T>
  /**
   * Sends it through another sender instead, such as the editor's, which
   * resends until answered. If that sender stops waiting while a request is
   * still out (the editor closed), the store keeps the edit and settles it on
   * that request's own answer.
   */
  via?: Send
  /** Folds the confirmed answer into the loaded snapshot. */
  settle?: (snapshot: TagsSnapshot, result: T) => TagsSnapshot
  /** Writes naming the same tag run one after another. */
  tagIds?: readonly string[]
}

export type TagsStore = {
  /** False until the first load settles, whether or not it worked. */
  ready: boolean
  /** True once tags have loaded: until then the tag box takes no changes. */
  loaded: boolean
  /** Set while there is nothing to show because the first load failed. */
  error: unknown
  /** Every tag, A–Z. */
  tags: readonly Tag[]
  tag(id: string): Tag | undefined
  /** The tags on one transcript, A–Z. */
  tagsOf(transcriptId: string): readonly Tag[]
  /** How many of these transcripts carry a tag; links to transcripts no longer listed don't count. */
  countFor(tagId: string, transcriptIds: ReadonlySet<string>): number
  /** Resolves false when the read failed. */
  reload(): Promise<boolean>
  /**
   * Runs a write. Its edit shows at once; once answered, the answer joins the
   * snapshot. On failure only this edit is dropped, never an older snapshot
   * restored; an unknown outcome also reloads. The error is passed on.
   */
  write<T>(request: TagWrite<T>): Promise<T>
}

const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
const NO_TAGS: readonly Tag[] = []

// Outside the app shell (tests of a single surface, mostly) there are no tags
// and every write is sent as it is.
const DETACHED: TagsStore = {
  ready: true,
  loaded: true,
  error: null,
  tags: NO_TAGS,
  tag: () => undefined,
  tagsOf: () => NO_TAGS,
  countFor: () => 0,
  reload: async () => true,
  write: (request) => request.send(),
}

const TagsContext = createContext<TagsStore>(DETACHED)

type Pending = { id: number; edit: TagsEdit }

/**
 * The account's tags and which transcripts carry them, shared by every list
 * and the editor so they never disagree. There is no realtime subscription:
 * like the People directory it reads again whenever the window regains focus,
 * and after its own writes.
 *
 * A reload notes how many writes had been answered when it started. If any
 * more are answered before it returns, its result may predate them, so it is
 * thrown away and the read runs again: an answered write is never overwritten.
 */
export function TagsProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<TagsSnapshot | null>(null)
  // Whether a snapshot exists, readable from a write's answer.
  const hasSnapshot = useRef(false)
  const [pending, setPending] = useState<readonly Pending[]>([])
  const [error, setError] = useState<unknown>(null)
  const generation = useRef(0)
  const answered = useRef(0)
  const nextEdit = useRef(0)
  const queues = useRef(new Map<string, Promise<unknown>>())

  const reload = useCallback(async (): Promise<boolean> => {
    const mine = ++generation.current
    for (;;) {
      const startedAt = answered.current
      try {
        const [tags, links] = await Promise.all([fetchTags(), fetchTranscriptTags()])
        // A newer reload owns the result.
        if (generation.current !== mine) return true
        if (answered.current !== startedAt) continue
        hasSnapshot.current = true
        setSnapshot({ tags, links })
        setError(null)
        return true
      } catch (caught) {
        if (generation.current === mine) {
          console.error('[tags] Failed to load:', caught)
          setError(caught)
        }
        return false
      }
    }
  }, [])

  useEffect(() => {
    void reload()
    const onFocus = () => { void reload() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  const write = useCallback(<T,>({ edit, send, via, settle, tagIds = [] }: TagWrite<T>): Promise<T> => {
    const id = ++nextEdit.current
    // A write with nothing to fold in keeps its own edit once confirmed.
    const confirm = settle ?? (edit ? (current: TagsSnapshot) => edit(current) : undefined)
    if (edit) setPending((current) => [...current, { id, edit }])
    const drop = () => setPending((current) => current.filter((entry) => entry.id !== id))

    const accept = (result: T) => {
      answered.current++
      // With nothing loaded there is nothing to fold the answer into: read it instead.
      if (!hasSnapshot.current) void reload()
      else if (confirm) setSnapshot((current) => (current ? confirm(current, result) : current))
      drop()
    }
    const fail = (caught: unknown) => {
      drop()
      if (tagWriteFailure(caught) === 'unknown') void reload()
    }
    // Settles once a request the sender stopped waiting for has its answer.
    let late: Promise<unknown> = Promise.resolve()

    const before = Promise.allSettled(tagIds.map((tagId) => queues.current.get(tagId)).filter(Boolean))
    const run = before.then(async () => {
      let last: Promise<T> | null = null
      const attempt = () => (last = send())
      try {
        const result = await (via ? via(attempt) : attempt())
        accept(result)
        return result
      } catch (caught) {
        // A request may still be out, or one went unanswered: its own answer decides.
        if (caught instanceof SendClosed && last) late = (last as Promise<T>).then(accept, fail)
        else fail(caught)
        throw caught
      }
    })

    const settled = run.catch(() => undefined).then(() => late)
    for (const tagId of tagIds) queues.current.set(tagId, settled)
    void settled.then(() => {
      for (const tagId of tagIds) if (queues.current.get(tagId) === settled) queues.current.delete(tagId)
    })
    return run
  }, [reload])

  const view = useMemo(
    () => (snapshot ? pending.reduce((current, entry) => entry.edit(current), snapshot) : null),
    [snapshot, pending],
  )

  const store = useMemo<TagsStore>(() => {
    const tags = view ? [...view.tags].sort(byName) : NO_TAGS
    const byId = new Map(tags.map((tag) => [tag.id, tag]))
    const onTranscript = new Map<string, Tag[]>()
    for (const link of view?.links ?? []) {
      const tag = byId.get(link.tag_id)
      if (!tag) continue
      const list = onTranscript.get(link.transcript_id)
      if (list) list.push(tag)
      else onTranscript.set(link.transcript_id, [tag])
    }
    for (const list of onTranscript.values()) list.sort(byName)
    return {
      ready: snapshot !== null || error !== null,
      loaded: snapshot !== null,
      error: snapshot === null ? error : null,
      tags,
      tag: (tagId) => byId.get(tagId),
      tagsOf: (transcriptId) => onTranscript.get(transcriptId) ?? NO_TAGS,
      countFor: (tagId, transcriptIds) =>
        (view?.links ?? []).filter((link) => link.tag_id === tagId && transcriptIds.has(link.transcript_id)).length,
      reload,
      write,
    }
  }, [view, snapshot, error, reload, write])

  return <TagsContext.Provider value={store}>{children}</TagsContext.Provider>
}

export function useTags(): TagsStore {
  return useContext(TagsContext)
}
