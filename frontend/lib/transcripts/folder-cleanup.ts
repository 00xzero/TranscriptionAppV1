/**
 * Server-side removal of transcript files. A transcript owns every object under
 * {user_id}/{transcript_id}/ in the media, waveforms and transcription-results
 * buckets.
 *
 * These helpers are strict: an unreadable inventory throws and failed removals
 * are always reported. Callers decide what a failure means — before a row is
 * deleted it blocks the delete; after, it is only logged.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MEDIA_BUCKET,
  removeStorageObjectsBatched,
  RESULTS_BUCKET,
  WAVEFORM_BUCKET,
} from '@/infra/supabase/storage'

export type TranscriptFileKeys = {
  media: string[]
  waveforms: string[]
  results: string[]
}

export type BucketRemoval = {
  removed: number
  failed: string[]
}

export type TranscriptFileRemoval = {
  media: BucketRemoval
  waveforms: BucketRemoval
  results: BucketRemoval
  /** Every key, from any bucket, that could not be confirmed removed. */
  failed: string[]
}

type InventoryRow = {
  media_keys: string[] | null
  waveform_keys: string[] | null
  result_keys: string[] | null
}

/**
 * Remove the given objects from all three buckets in parallel. Media and
 * waveforms are removed through the user's client and verified through the
 * trusted one. transcription-results has no user policies, so the trusted client
 * removes those; the keys still come from the user's own folder inventory and
 * must sit under their folder.
 */
export async function removeTranscriptFiles(
  supabase: SupabaseClient,
  verificationSupabase: SupabaseClient,
  userId: string,
  keys: TranscriptFileKeys,
  batchSize?: number
): Promise<TranscriptFileRemoval> {
  const [media, waveforms, results] = await Promise.all([
    removeStorageObjectsBatched(
      supabase,
      verificationSupabase,
      MEDIA_BUCKET,
      keys.media,
      userId,
      batchSize
    ),
    removeStorageObjectsBatched(
      supabase,
      verificationSupabase,
      WAVEFORM_BUCKET,
      keys.waveforms,
      userId,
      batchSize
    ),
    removeStorageObjectsBatched(
      verificationSupabase,
      verificationSupabase,
      RESULTS_BUCKET,
      keys.results,
      userId,
      batchSize
    ),
  ])
  return {
    media,
    waveforms,
    results,
    failed: [...media.failed, ...waveforms.failed, ...results.failed],
  }
}

/**
 * Remove every file in the given transcripts' folders, linked or not. Works
 * after the rows are gone, so it also serves post-delete sweeps. Throws if the
 * folder inventory cannot be read.
 */
export async function sweepTranscriptFolders(
  supabase: SupabaseClient,
  verificationSupabase: SupabaseClient,
  userId: string,
  transcriptIds: string[],
  batchSize?: number
): Promise<TranscriptFileRemoval> {
  const { data, error } = await supabase.rpc('transcript_delete_inventory', {
    p_ids: transcriptIds,
  })
  if (error) throw error

  const inventory = (data as InventoryRow[] | null)?.[0]
  return removeTranscriptFiles(
    supabase,
    verificationSupabase,
    userId,
    {
      media: inventory?.media_keys ?? [],
      waveforms: inventory?.waveform_keys ?? [],
      results: inventory?.result_keys ?? [],
    },
    batchSize
  )
}
