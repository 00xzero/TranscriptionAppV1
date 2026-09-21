'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectSpeakerSummary } from '@/contracts/db'
import { fetchProjectSpeakerSummaries } from '@/lib/supabase/queries'

export type ProjectSpeakerSummariesState = {
  /** Keyed by project id. A missing key is "unknown", not "no speakers". */
  summaries: Map<string, ProjectSpeakerSummary>
  loading: boolean
}

/** Shared instance: the map is never mutated, so every empty state can use it. */
const EMPTY: ReadonlyMap<string, ProjectSpeakerSummary> = new Map()

type FetchState = {
  key: string
  summaries: ReadonlyMap<string, ProjectSpeakerSummary>
  settled: boolean
}

const INITIAL: FetchState = { key: '', summaries: EMPTY, settled: false }

/**
 * A compact stamp of a transcript set, for use as this hook's `revision`.
 *
 * The speaker summary is derived from segments, which this client never holds,
 * so nothing local can tell us the answer changed. What we do hold is the
 * transcripts, and every relevant mutation touches them: adding, moving or
 * deleting one changes the count, and editing or completing one bumps
 * `updated_at`. Stamping both is enough to notice, without building a string
 * proportional to the library.
 */
export function transcriptRevision(
  transcripts: readonly { updated_at: string }[]
): string {
  let latest = ''
  for (const transcript of transcripts) {
    if (transcript.updated_at > latest) latest = transcript.updated_at
  }
  return `${transcripts.length}:${latest}`
}

/**
 * Speaker avatar summaries for a set of projects, fetched in ONE request per
 * surface — never per project and never per transcript.
 *
 * Failures are non-blocking by design: the summary is dropped and the rest of
 * the project UI renders unchanged, because avatars are decoration on top of
 * counts that came from somewhere else.
 */
export function useProjectSpeakerSummaries(
  projectIds: string[],
  includeDescendants: boolean,
  /**
   * Changes when the underlying transcripts change, triggering a refetch that
   * leaves the displayed summary in place until the new one lands. Distinct from
   * the project set, which is an identity change and clears immediately.
   */
  revision = ''
): ProjectSpeakerSummariesState {
  // Sorted and de-duplicated, so the key describes the SET of projects rather
  // than the order they happen to be ranked in. The Library rail re-sorts itself
  // on transcript activity, and without this a pure reorder would read as a new
  // project set and blank every avatar back to a loading placeholder. Order does
  // not matter to the RPC either — it returns one row per project.
  const idsKey = Array.from(new Set(projectIds)).sort().join(',')
  const key = idsKey ? `${includeDescendants ? 'branch' : 'direct'}|${idsKey}` : ''

  const [state, setState] = useState<FetchState>(INITIAL)

  // Bumped per request. This guards more than unmount and scope changes: two
  // requests for the SAME scope can overlap — a slow initial load and a fast
  // focus refetch — and only the newest may write state, whatever order they
  // resolve in.
  const generationRef = useRef(0)

  const run = useCallback(async () => {
    const generation = ++generationRef.current
    if (!idsKey) return
    // A dependency that is deliberately not read: the summary lives server-side,
    // so `revision` carries no data of its own — it only says the answer may
    // have moved and this callback should be re-run.
    void revision

    try {
      const summaries = await fetchProjectSpeakerSummaries(idsKey.split(','), {
        includeDescendants,
      })
      if (generationRef.current !== generation) return
      setState({ key, summaries, settled: true })
    } catch (error) {
      if (generationRef.current !== generation) return
      console.error('[projects] Failed to load speaker summaries:', error)
      setState({ key, summaries: EMPTY, settled: true })
    }
  }, [idsKey, includeDescendants, key, revision])

  useEffect(() => {
    // run() only reaches setState after awaiting the RPC, never synchronously in
    // the effect body — the rule cannot see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run()
  }, [run])

  // Focus covers what `revision` cannot: a transcript changed in another tab, or
  // segments re-ingested by a background job, neither of which touches the
  // transcript rows this client is holding. No reset: the derived read below already hides
  // data belonging to another key, and clearing here would flash the avatars.
  useEffect(() => {
    const onFocus = () => {
      void run()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [run])

  // Derived rather than cleared in an effect, so a navigation drops the previous
  // project's avatars in the same render that changes the key — never a frame
  // showing another project's speakers.
  const isCurrent = state.key === key
  return {
    summaries: (isCurrent ? state.summaries : EMPTY) as Map<string, ProjectSpeakerSummary>,
    loading: key !== '' && !(isCurrent && state.settled),
  }
}
