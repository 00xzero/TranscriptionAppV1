/**
 * Transcription engines' results in the transcription-results bucket, one gzipped file per
 * job at {user_id}/{transcript_id}/{job_id}.json.gz.
 *
 * Server-only: uses node:zlib, and the bucket has no user policies, so every
 * call takes the admin client. Never import this from browser code; storage.ts
 * holds the bucket name and path helper that both sides share.
 */
import { gunzipSync, gzipSync } from 'node:zlib'
import type { SupabaseClient } from '@supabase/supabase-js'
import { RESULTS_BUCKET } from '@/infra/supabase/storage'

/** Store the result exactly as the engine sent it. Overwrites a redelivery. */
export async function uploadTranscriptionResult(
    admin: SupabaseClient,
    path: string,
    rawJson: string
): Promise<{ bytes: number }> {
    const body = gzipSync(Buffer.from(rawJson, 'utf8'))
    const { error } = await admin.storage
        .from(RESULTS_BUCKET)
        .upload(path, body, { contentType: 'application/gzip', upsert: true })
    if (error) {
        throw new Error(`Failed to store engine result: ${error.message}`)
    }
    return { bytes: body.byteLength }
}

/** Read a stored result back as the JSON text the engine sent. */
export async function downloadTranscriptionResult(
    admin: SupabaseClient,
    path: string
): Promise<string> {
    const { data, error } = await admin.storage.from(RESULTS_BUCKET).download(path)
    if (error || !data) {
        throw new Error(`Failed to load engine result: ${error?.message ?? 'empty download'}`)
    }
    return gunzipSync(Buffer.from(await data.arrayBuffer())).toString('utf8')
}

/**
 * Remove a response whose job is gone (a path with no file is fine). Throws when
 * the removal fails, so its caller retries: logging alone would leave the file
 * behind while reporting it cleaned up.
 */
export async function removeTranscriptionResult(
    admin: SupabaseClient,
    path: string,
    context: string
): Promise<void> {
    const { error } = await admin.storage.from(RESULTS_BUCKET).remove([path])
    if (error) {
        console.error(`[${context}] Failed to remove orphaned engine result ${path}:`, error)
        throw new Error(`Failed to remove engine result ${path}: ${error.message}`)
    }
}
