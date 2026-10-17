'use client'

import { useCallback } from 'react'
import type { ProjectPeople } from '@/contracts/db'
import { type ReloadingQuery, useReloadingQuery } from '@/lib/people/usePeopleData'
import { fetchProjectPeople } from '@/lib/supabase/queries'

/**
 * Who speaks in a project and every project nested in it. Mount it only while
 * the people dialog is open, keyed by project id: each opening then starts from
 * a fresh load, and nothing is fetched while the dialog is closed.
 */
export function useProjectPeople(projectId: string): ReloadingQuery<ProjectPeople> {
  const load = useCallback(() => fetchProjectPeople(projectId), [projectId])
  return useReloadingQuery(load)
}

/** The header's count for the same answer: each person once, every voice on its own. */
export function projectSpeakerTotal(data: ProjectPeople): number {
  return data.people.length + data.voices.reduce((sum, transcript) => sum + transcript.voice_ids.length, 0)
}
