/** @jest-environment node */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  removeTranscriptFiles,
  sweepTranscriptFolders,
} from '@/lib/transcripts/folder-cleanup'

const USER = 'user-1'

function clients(options: {
  inventory?: { data: unknown; error: unknown }
  failingBucket?: string
}) {
  const rpc = jest.fn(async () => options.inventory ?? { data: [], error: null })
  // Keyed `${client}:${bucket}`, so a test can see which client removed what.
  const removed: Record<string, string[]> = {}
  const storageFor = (client: string) => ({
    from: (bucket: string) => ({
      remove: jest.fn(async (keys: string[]) => {
        if (bucket === options.failingBucket) {
          return { data: null, error: { message: 'storage unavailable' } }
        }
        ;(removed[`${client}:${bucket}`] ??= []).push(...keys)
        return { data: keys.map((name) => ({ name })), error: null }
      }),
      info: jest.fn(async () => ({ data: {}, error: null })),
    }),
  })
  const supabase = { rpc, storage: storageFor('user') } as unknown as SupabaseClient
  const verification = { storage: storageFor('admin') } as unknown as SupabaseClient
  return { supabase, verification, rpc, removed }
}

describe('transcript folder cleanup', () => {
  test('removes all three buckets and reports counts and failures per bucket', async () => {
    const { supabase, verification } = clients({ failingBucket: 'waveforms' })

    const result = await removeTranscriptFiles(supabase, verification, USER, {
      media: [`${USER}/t-1/audio.webm`],
      waveforms: [`${USER}/t-1/waveform.json`],
      results: [`${USER}/t-1/job-1.json.gz`],
    })

    expect(result.media).toEqual({ removed: 1, failed: [] })
    expect(result.waveforms).toEqual({ removed: 0, failed: [`${USER}/t-1/waveform.json`] })
    expect(result.results).toEqual({ removed: 1, failed: [] })
    expect(result.failed).toEqual([`${USER}/t-1/waveform.json`])
  })

  test('removes results with the trusted client, and only inside the user folder', async () => {
    const { supabase, verification, removed } = clients({})

    const result = await removeTranscriptFiles(supabase, verification, USER, {
      media: [`${USER}/t-1/audio.webm`],
      waveforms: [],
      results: [`${USER}/t-1/job-1.json.gz`, `someone-else/t-9/job-9.json.gz`],
    })

    expect(removed['user:media']).toEqual([`${USER}/t-1/audio.webm`])
    expect(removed['admin:transcription-results']).toEqual([`${USER}/t-1/job-1.json.gz`])
    expect(removed['user:transcription-results']).toBeUndefined()
    expect(result.results.failed).toEqual([`someone-else/t-9/job-9.json.gz`])
  })

  test('sweeps every file the folder inventory lists', async () => {
    const { supabase, verification, rpc, removed } = clients({
      inventory: {
        data: [{
          media_keys: [`${USER}/t-1/unlinked.webm`],
          waveform_keys: null,
          result_keys: [`${USER}/t-1/job-1.json.gz`],
        }],
        error: null,
      },
    })

    const result = await sweepTranscriptFolders(supabase, verification, USER, ['t-1'])

    expect(rpc).toHaveBeenCalledWith('transcript_delete_inventory', { p_ids: ['t-1'] })
    expect(removed['user:media']).toEqual([`${USER}/t-1/unlinked.webm`])
    expect(removed['admin:transcription-results']).toEqual([`${USER}/t-1/job-1.json.gz`])
    expect(result.failed).toEqual([])
  })

  test('throws when the folder inventory cannot be read', async () => {
    const { supabase, verification } = clients({
      inventory: { data: null, error: { message: 'inventory unavailable' } },
    })

    await expect(sweepTranscriptFolders(supabase, verification, USER, ['t-1'])).rejects.toEqual({
      message: 'inventory unavailable',
    })
  })
})
