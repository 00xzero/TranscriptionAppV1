/**
 * Deepgram responses in the transcription-results bucket, one gzipped file per
 * job at {user_id}/{transcript_id}/{job_id}.json.gz.
 *
 * Server-only: uses node:zlib, and the bucket has no user policies, so every
 * call takes the admin client. Never import this from browser code; storage.ts
 * holds the bucket name and path helper that both sides share.
 */
import { gunzipSync, gzipSync } from 'node:zlib'
import type { SupabaseClient } from '@supabase/supabase-js'
import { RESULTS_BUCKET } from '@/infra/supabase/storage'

/** Store the response exactly as Deepgram sent it. Overwrites a redelivery. */
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
        throw new Error(`Failed to store Deepgram response: ${error.message}`)
    }
    return { bytes: body.byteLength }
}

/** Read a stored response back as the JSON text Deepgram sent. */
export async function downloadTranscriptionResult(
    admin: SupabaseClient,
    path: string
): Promise<string> {
    const { data, error } = await admin.storage.from(RESULTS_BUCKET).download(path)
    if (error || !data) {
        throw new Error(`Failed to load Deepgram response: ${error?.message ?? 'empty download'}`)
    }
    return gunzipSync(Buffer.from(await data.arrayBuffer())).toString('utf8')
}

/** Remove a response whose job is gone. Logs instead of throwing: it is cleanup. */
export async function removeTranscriptionResult(
    admin: SupabaseClient,
    path: string,
    context: string
): Promise<void> {
    const { error } = await admin.storage.from(RESULTS_BUCKET).remove([path])
    if (error) {
        console.error(`[${context}] Failed to remove orphaned Deepgram response ${path}:`, error)
    }
}
