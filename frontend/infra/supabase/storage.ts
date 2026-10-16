/**
 * Supabase Storage utilities for media file handling.
 *
 * Storage path convention: {user_id}/{transcript_id}/{filename}
 * Bucket: 'media' (private, 50MB default - configurable via NEXT_PUBLIC_MAX_FILE_SIZE_MB)
 */

import { SupabaseClient } from '@supabase/supabase-js'

export const MEDIA_BUCKET = 'media'
export const WAVEFORM_BUCKET = 'waveforms'
// Server-only: Deepgram's response per job, gzipped. Read and written by the
// admin client alone (transcription-results.server.ts).
export const RESULTS_BUCKET = 'transcription-results'

// Maximum file size - configurable via environment variable
// Default: 50MB (Supabase Free plan limit)
// Pro plan: Set NEXT_PUBLIC_MAX_FILE_SIZE_MB=1500 for 1.5GB
export const MAX_FILE_SIZE_BYTES = (() => {
    const mbFromEnv = parseInt(process.env.NEXT_PUBLIC_MAX_FILE_SIZE_MB || '50', 10)
    return mbFromEnv * 1024 * 1024
})()

// Human-readable size for display
export const MAX_FILE_SIZE_DISPLAY = (() => {
    const mb = parseInt(process.env.NEXT_PUBLIC_MAX_FILE_SIZE_MB || '50', 10)
    if (mb >= 1024) {
        return `${(mb / 1024).toFixed(1)}GB`
    }
    return `${mb}MB`
})()

/**
 * Build the storage path for a media file.
 */
export function getMediaPath(userId: string, transcriptId: string, filename: string): string {
    // Sanitize filename: remove path separators, limit length
    const sanitized = filename
        .replace(/[/\\]/g, '_')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 200)

    return `${userId}/${transcriptId}/${sanitized || 'media'}`
}

/**
 * Build the storage path for a job's Deepgram response. One file per job: a
 * redelivered webhook overwrites it, a new transcription run gets its own.
 */
export function getTranscriptionResultPath(userId: string, transcriptId: string, jobId: string): string {
    return `${userId}/${transcriptId}/${jobId}.json.gz`
}

/**
 * Generate a signed download URL for an object in a private bucket.
 * Defaults to the 'media' bucket for backwards-compatible call sites.
 */
export async function getSignedMediaUrl(
    supabase: SupabaseClient,
    path: string,
    expiresIn: number = 3600,
    bucket: string = MEDIA_BUCKET
): Promise<{ url: string; error: null } | { url: null; error: string }> {
    const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, expiresIn)

    if (error) {
        console.error(`[storage] Signed URL error (bucket=${bucket}):`, error)
        return { url: null, error: error.message }
    }

    return { url: data.signedUrl, error: null }
}

/**
 * In Docker dev, signed URLs may use `host.docker.internal`, which the browser
 * can't resolve. Rewrite to localhost. No-op in production.
 */
export function localizeSignedUrl(signedUrl: string): string {
    if (process.env.NODE_ENV === 'production') return signedUrl
    if (!signedUrl.includes('host.docker.internal')) return signedUrl
    return signedUrl.replace('host.docker.internal', 'localhost')
}

/**
 * Get a media URL suitable for Deepgram to fetch — applies proxy/rewrite env logic.
 *
 * Encapsulates deployment-specific transformations so core code stays env-agnostic:
 * - DEEPGRAM_USE_PROXY=true → proxy through /api/media-proxy (local dev, single ngrok tunnel)
 * - DEEPGRAM_STORAGE_URL set → base URL replacement (alternative local dev setup)
 * - Neither → return the signed URL as-is
 *
 * @param supabase - Supabase client instance (server-side or admin)
 * @param objectKey - Storage path (from transcript.source_object_key)
 * @returns Ready-to-use URL string, or error on failure
 */
export async function getMediaUrlForDeepgram(
    supabase: SupabaseClient,
    objectKey: string
): Promise<{ url: string; error: null } | { url: null; error: string }> {
    const signedUrlResult = await getSignedMediaUrl(supabase, objectKey)
    if (signedUrlResult.error || !signedUrlResult.url) {
        return { url: null, error: signedUrlResult.error ?? 'Failed to generate signed URL' }
    }

    let mediaUrl = signedUrlResult.url

    if (process.env.DEEPGRAM_USE_PROXY === 'true') {
        const callbackBase =
            process.env.DEEPGRAM_CALLBACK_URL?.replace('/api/webhooks/deepgram', '') ||
            process.env.NEXT_PUBLIC_APP_URL ||
            'http://localhost:3000'
        const proxySecret = process.env.MEDIA_PROXY_SECRET
        if (!proxySecret) {
            return { url: null, error: 'Media proxy misconfigured: missing MEDIA_PROXY_SECRET' }
        }
        mediaUrl = `${callbackBase}/api/media-proxy?path=${encodeURIComponent(objectKey)}&token=${encodeURIComponent(proxySecret)}`
        console.log(`[storage] Using media proxy for Deepgram (path: ${objectKey})`)
    } else if (process.env.DEEPGRAM_STORAGE_URL) {
        const localStoragePrefix = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
        if (localStoragePrefix && mediaUrl.includes(localStoragePrefix)) {
            mediaUrl = mediaUrl.replace(localStoragePrefix, process.env.DEEPGRAM_STORAGE_URL)
            console.log(`[storage] Replaced media URL base for Deepgram: ${process.env.DEEPGRAM_STORAGE_URL}`)
        }
    }

    return { url: mediaUrl, error: null }
}

type StorageError = {
    message?: string
    error?: string
    code?: string
    statusCode?: string
}

export function isMissingStorageObjectError(error: StorageError): boolean {
    const errorName = error.error?.toLowerCase() ?? ''
    const code = error.code?.toLowerCase() ?? ''
    const message = error.message?.toLowerCase() ?? ''

    return (
        code === 'nosuchkey' ||
        errorName === 'nosuchkey' ||
        errorName === 'no such key' ||
        (error.statusCode === '404' && message === 'object not found')
    )
}

export async function removeStorageObjectsBatched(
    supabase: SupabaseClient,
    verificationSupabase: SupabaseClient,
    bucket: string,
    keys: string[],
    ownerId: string,
    batchSize = 100
): Promise<{ removed: number; failed: string[] }> {
    if (!Number.isInteger(batchSize) || batchSize < 1) {
        throw new RangeError('batchSize must be a positive integer')
    }

    let removed = 0
    const failed: string[] = []
    const uniqueKeys = [...new Set(keys.filter(Boolean))]
    const storage = supabase.storage.from(bucket)
    const verificationStorage = verificationSupabase.storage.from(bucket)

    for (let offset = 0; offset < uniqueKeys.length; offset += batchSize) {
        const batch = uniqueKeys.slice(offset, offset + batchSize)
        const trustedBatch = batch.filter((key) => key.startsWith(`${ownerId}/`))
        failed.push(...batch.filter((key) => !key.startsWith(`${ownerId}/`)))
        if (trustedBatch.length === 0) continue

        const { data, error } = await storage.remove(trustedBatch)
        if (error && !isMissingStorageObjectError(error)) {
            failed.push(...trustedBatch)
            continue
        }

        const requested = new Set(trustedBatch)
        const confirmedRemoved = new Set(
            (data ?? [])
                .map((object) => object.name)
                .filter((name): name is string => requested.has(name))
        )
        removed += confirmedRemoved.size

        const omitted = trustedBatch.filter((key) => !confirmedRemoved.has(key))
        for (let verificationOffset = 0; verificationOffset < omitted.length; verificationOffset += 8) {
            const verificationBatch = omitted.slice(verificationOffset, verificationOffset + 8)
            const verificationResults = await Promise.all(
                verificationBatch.map(async (key) => {
                    try {
                        // The authenticated client may report NoSuchKey for an
                        // RLS-hidden object. Verify absence through the trusted
                        // server client before allowing database deletion.
                        const verification = await verificationStorage.info(key)
                        return verification.error && isMissingStorageObjectError(verification.error)
                            ? null
                            : key
                    } catch {
                        return key
                    }
                })
            )
            failed.push(
                ...verificationResults.filter((key): key is string => key !== null)
            )
        }
    }

    return { removed, failed }
}
