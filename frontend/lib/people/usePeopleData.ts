'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PeopleDirectory, PersonAppearance } from '@/contracts/db'
import { fetchPeopleDirectory, fetchPersonAppearances } from '@/lib/supabase/queries'

export type ReloadingQuery<T> = {
  /** The latest data, kept while a reload runs or after a reload fails. */
  data: T | null
  /** True until the first load settles. */
  loading: boolean
  /** Only when there is no data to show. */
  error: unknown
  /** Resolves false when the load failed. */
  reload: () => Promise<boolean>
  /** Patch the data in place, ahead of a reload. */
  update: (edit: (data: T) => T) => void
}

/**
 * Loads once, then again whenever the window regains focus: the directory has
 * no realtime subscription (spec §7), and another tab may have renamed,
 * merged or linked someone. Only the newest request may write state.
 */
function useReloadingQuery<T>(load: () => Promise<T>): ReloadingQuery<T> {
  const [state, setState] = useState<{ data: T | null; error: unknown; settled: boolean }>(
    { data: null, error: null, settled: false })
  const generationRef = useRef(0)

  const reload = useCallback(async () => {
    const generation = ++generationRef.current
    try {
      const data = await load()
      if (generationRef.current === generation) setState({ data, error: null, settled: true })
      return true
    } catch (error) {
      console.error('[people] Failed to load:', error)
      if (generationRef.current === generation) setState((current) => ({ ...current, error, settled: true }))
      return false
    }
  }, [load])

  useEffect(() => {
    void reload()
    const onFocus = () => { void reload() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  const update = useCallback((edit: (data: T) => T) => {
    setState((current) => (current.data === null ? current : { ...current, data: edit(current.data) }))
  }, [])

  return {
    data: state.data,
    loading: !state.settled,
    error: state.data === null ? state.error : null,
    reload,
    update,
  }
}

/** Every person the user owns, and every organisation. */
export function usePeopleDirectory(): ReloadingQuery<PeopleDirectory> {
  return useReloadingQuery(fetchPeopleDirectory)
}

/** The transcripts one person appears in, newest first. */
export function usePersonAppearances(personId: string): ReloadingQuery<PersonAppearance[]> {
  const load = useCallback(() => fetchPersonAppearances(personId), [personId])
  return useReloadingQuery(load)
}
