import { Upload, type HttpRequest } from 'tus-js-client'
import { createClient } from '@/infra/supabase/client'
import { MEDIA_BUCKET } from '@/infra/supabase/storage'
import { getAccessToken } from '@/infra/workos/access-token'

type BrowserSupabaseClient = ReturnType<typeof createClient>

/**
 * Files at or below this size use a single-PUT upload; larger files use the
 * resumable (TUS) path. A file that fits in one TUS chunk gains nothing from
 * resumable and would only pay the extra create/patch handshake round-trips,
 * so the threshold is aligned to the chunk size.
 */
export const RESUMABLE_UPLOAD_THRESHOLD_BYTES = 6 * 1024 * 1024 // 6 MB

/**
 * Supabase Storage's resumable endpoint requires every chunk to be exactly
 * 6 MB (except the final one). This is non-negotiable — other sizes are
 * rejected by the server.
 */
const TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024 // 6 MB

export interface TransferOptions {
    contentType: string
    /** Maps to Supabase's `x-upsert`; overwrites an existing object when true. */
    upsert: boolean
    /** Aborts the resumable upload mid-flight (the single-PUT path can't be aborted). */
    signal?: AbortSignal
    /**
     * Bytes sent so far. The resumable path reports as it goes and never goes
     * backwards, even when a chunk is resent; the single-PUT path can't
     * measure, so it reports once, when the file is in. Either way the whole
     * size is reported only once storage has accepted the file, and nothing
     * is reported after a cancel.
     */
    onProgress?: (sentBytes: number, totalBytes: number) => void
}

/**
 * Transfer a media file to Supabase Storage at `storagePath`.
 *
 * Resolves on success; throws `Error` on failure and a `DOMException`
 * (`AbortError`) on cancellation — matching the contract `runCaptureUpload`
 * expects so its outcome classification and rollback stay unchanged.
 *
 * Small files take the original single-PUT path. Large files take the
 * resumable (TUS) path: ~6 MB requests instead of one long-lived PUT (which
 * can hit gateway timeouts on weak connections), with automatic per-chunk
 * retry within the session. Cross-reload resume is intentionally not wired up.
 */
export async function transferToStorage(
    supabase: BrowserSupabaseClient,
    storagePath: string,
    file: File,
    options: TransferOptions
): Promise<void> {
    if (file.size <= RESUMABLE_UPLOAD_THRESHOLD_BYTES) {
        const { error } = await supabase.storage
            .from(MEDIA_BUCKET)
            .upload(storagePath, file, {
                contentType: options.contentType,
                upsert: options.upsert,
            })

        if (error) {
            throw new Error(`Upload failed: ${error.message}`)
        }
        // A cancelled PUT can't be stopped and may still finish; its report
        // must not land on whatever upload comes next.
        if (!options.signal?.aborted) {
            options.onProgress?.(file.size, file.size)
        }
        return
    }

    await resumableUpload(storagePath, file, options)
}

async function resumableUpload(
    storagePath: string,
    file: File,
    options: TransferOptions
): Promise<void> {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) {
        throw new Error('Upload failed: missing Supabase configuration')
    }

    const userId = storagePath.split('/')[0]
    const accessToken = await getAccessToken(userId)
    if (!accessToken) {
        throw new Error('Upload failed: no active session for resumable upload')
    }

    await new Promise<void>((resolve, reject) => {
        let settled = false
        let sentHighWater = 0

        const cleanup = () => {
            options.signal?.removeEventListener('abort', onAbort)
        }
        const finish = (fn: () => void) => {
            if (settled) return
            settled = true
            cleanup()
            fn()
        }
        const onAbort = () => {
            finish(() => {
                // No resume in this phase — terminate the partial upload server-side.
                upload.abort(true).catch(() => {})
                reject(new DOMException('Upload canceled.', 'AbortError'))
            })
        }

        const upload = new Upload(file, {
            endpoint: storageResumableEndpoint(supabaseUrl),
            chunkSize: TUS_CHUNK_SIZE_BYTES,
            retryDelays: [0, 1000, 3000, 5000],
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            headers: {
                // supabase-js sends both apikey and authorization on every storage
                // call; the raw TUS client sends neither by default, so set them
                // explicitly to match how the rest of the app already authenticates.
                // `authorization` is set in onBeforeRequest so refreshes are picked
                // up without appending a duplicate bearer token on the first request.
                apikey: anonKey,
                'x-upsert': String(options.upsert),
            },
            metadata: {
                bucketName: MEDIA_BUCKET,
                objectName: storagePath,
                contentType: options.contentType,
                cacheControl: '3600',
            },
            onBeforeRequest: async (req: HttpRequest) => {
                // WorkOS tokens last minutes; ask for a fresh one before every
                // chunk so a long upload doesn't fail on an expired bearer token.
                const token = await getAccessToken(userId)
                if (!token) throw new Error('Upload failed: no active session for resumable upload')
                req.setHeader('authorization', `Bearer ${token}`)
            },
            onProgress: (bytesSent: number, bytesTotal: number) => {
                // Bytes sent are not bytes accepted: the last chunk can go out
                // in full and still be refused and resent. Stop one byte short
                // until onSuccess says storage has the whole file.
                const sent = Math.min(bytesSent, bytesTotal - 1)
                // A resent chunk starts again from its offset; hold the count
                // where it was until the resend passes it.
                if (settled || sent <= sentHighWater) return
                sentHighWater = sent
                options.onProgress?.(sent, bytesTotal)
            },
            onError: (error: Error) => {
                finish(() => reject(new Error(resumableErrorMessage(error))))
            },
            onSuccess: () => {
                finish(() => {
                    options.onProgress?.(file.size, file.size)
                    resolve()
                })
            },
        })

        if (options.signal?.aborted) {
            onAbort()
            return
        }
        options.signal?.addEventListener('abort', onAbort)
        upload.start()
    })
}

/**
 * Storage refuses a file over its size limit as the upload is created (TUS
 * sends the length first), with a 413 the raw tus message buries. The bucket
 * allows 500 MB, but a project's global upload limit can be lower, so say
 * plainly that the file is too large.
 */
function resumableErrorMessage(error: Error): string {
    const response = (error as { originalResponse?: { getStatus(): number } | null }).originalResponse
    if (response?.getStatus() === 413) {
        return 'Upload failed: this file is larger than storage accepts.'
    }
    return `Upload failed: ${error.message}`
}

function storageResumableEndpoint(supabaseUrl: string): string {
    return `${resumableStorageOrigin(supabaseUrl)}/storage/v1/upload/resumable`
}

/**
 * For hosted Supabase projects, large uploads should target the direct storage
 * hostname (`<ref>.storage.supabase.co`) instead of the API gateway
 * (`<ref>.supabase.co`). Local dev, self-hosted, and custom domains are left
 * unchanged.
 */
function resumableStorageOrigin(supabaseUrl: string): string {
    const trimmedUrl = supabaseUrl.replace(/\/+$/, '')

    try {
        const url = new URL(trimmedUrl)
        const match = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)
        if (match) {
            url.hostname = `${match[1]}.storage.supabase.co`
        }
        return url.origin
    } catch {
        return trimmedUrl
    }
}
