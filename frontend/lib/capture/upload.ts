import { createClient } from '@/infra/supabase/client'
import {
  MAX_FILE_SIZE_BYTES as CONFIGURED_MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_DISPLAY,
} from '@/infra/supabase/storage'
import { randomId } from '@/lib/ids'
import { transferToStorage } from './storageTransfer'

/**
 * Supported file types for upload.
 * Matches Olivetti prototype and Deepgram supported formats.
 */
const SUPPORTED_EXTENSIONS = [
  'mp3', 'wav', 'm4a', 'aac', 'flac', // audio
  'mp4', 'mov', 'webm', 'ogg', 'avi' // video
]

const SUPPORTED_MIME_TYPES = [
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
    'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac',
    'audio/flac', 'audio/x-flac',
    'audio/webm',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
    'audio/ogg', 'video/ogg'
]

/**
 * Map file extensions to MIME types for cases where browser doesn't provide file.type.
 * Uses MIME types that match the Supabase storage bucket allowlist.
 */
const EXTENSION_TO_MIME: Record<string, string> = {
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'm4a': 'audio/mp4',
    'aac': 'audio/aac',
    'flac': 'audio/flac',
    'ogg': 'audio/ogg',
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'webm': 'video/webm',
    'avi': 'video/x-msvideo'
}

/**
 * Normalize MIME aliases to canonical types that match Supabase bucket allowlist.
 * Some browsers report non-standard MIME types that pass validation but fail upload.
 */
const MIME_NORMALIZATION: Record<string, string> = {
    // Audio aliases
    'audio/x-m4a': 'audio/mp4',
    'audio/m4a': 'audio/mp4',
    'audio/x-wav': 'audio/wav',
    'audio/wave': 'audio/wav',
    'audio/x-flac': 'audio/flac',
    'audio/mp3': 'audio/mpeg',
    // Video aliases
    'video/ogg': 'audio/ogg',  // OGG audio often misreported as video/ogg
}

const MAX_FILE_SIZE_BYTES = CONFIGURED_MAX_FILE_SIZE_BYTES

export type CaptureUploadProgress = 'creating' | 'uploading' | 'starting' | 'done'

export interface CaptureUploadOptions {
    onProgress?: (p: CaptureUploadProgress) => void
    signal?: AbortSignal
    /**
     * Client-generated upload idempotency key (recording sessions only). When set:
     * transcript create dedupes by (user_id, uploadIntentId), and `/start` is keyed
     * with `start:<uploadIntentId>` so a recovery retry returns the canonical
     * transcript + job instead of duplicating either.
     */
    uploadIntentId?: string
    /**
     * Allow overwriting an existing storage object on upload. Used by recovery
     * saves where the media key may already exist from an interrupted attempt;
     * the live capture path leaves this false to keep its stricter guarantee.
     */
    allowUpsert?: boolean
}

export type CaptureUploadResult =
    | {
        kind: 'success'
        transcriptId: string
        outcome: 'started' | 'saved_needs_retry' | 'saved_status_unknown'
        message?: string
    }
    | { kind: 'validation_error'; message: string }
    | { kind: 'failure'; message: string }

/**
 * Get MIME type for upload - normalizes aliases and infers from extension if needed.
 * Ensures the returned MIME type is compatible with Supabase bucket allowlist.
 */
function getMimeType(file: File): string {
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    const inferredMime = EXTENSION_TO_MIME[ext]
    const reportedMime = file.type?.toLowerCase()

    // If browser provides a MIME type, normalize and use it only when supported.
    // Otherwise, fall back to extension-based canonical MIME type.
    if (reportedMime && reportedMime !== '') {
        const normalized = MIME_NORMALIZATION[reportedMime] || reportedMime
        if (SUPPORTED_MIME_TYPES.includes(normalized)) {
            if (normalized !== reportedMime) {
                console.log(`[capture] Normalized MIME type: ${reportedMime} -> ${normalized}`)
            }
            return normalized
        }

        if (inferredMime) {
            console.warn(`[capture] Unsupported reported MIME "${reportedMime}", falling back to extension "${ext}" -> "${inferredMime}"`)
            return inferredMime
        }
    }

    if (inferredMime) {
        console.log(`[capture] Inferred MIME type from extension: ${ext} -> ${inferredMime}`)
        return inferredMime
    }

    // Last resort fallback - this may still fail bucket validation
    console.warn(`[capture] Could not determine MIME type for: ${file.name}`)
    return 'application/octet-stream'
}

async function rollbackPartialCapture(
    supabase: ReturnType<typeof createClient>,
    transcriptId: string | null,
    storagePath: string | null,
    didUploadFile: boolean,
    shouldDeleteTranscript: boolean
): Promise<string | null> {
    const cleanupFailures: string[] = []

    if (didUploadFile && storagePath) {
        const { error: removeError } = await supabase.storage
            .from('media')
            .remove([storagePath])

        if (removeError) {
            console.error('[capture] Failed to remove uploaded media during rollback:', removeError)
            cleanupFailures.push('uploaded media')
        }
    }

    if (transcriptId && shouldDeleteTranscript) {
        const { error: deleteError } = await supabase
            .from('transcripts')
            .delete()
            .eq('id', transcriptId)

        if (deleteError) {
            console.error('[capture] Failed to delete transcript during rollback:', deleteError)
            cleanupFailures.push('transcript record')
        }
    }

    if (cleanupFailures.length === 0) {
        return null
    }

    return `Automatic cleanup failed for ${cleanupFailures.join(' and ')}. Please remove failed uploads from the Transcripts page.`
}

/**
 * Validate file type and size.
 * Returns error message or null if valid.
 */
function validateFile(file: File): string | null {
    // Check file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
        const sizeMB = Math.round(file.size / (1024 * 1024))
        return `File too large (${sizeMB}MB). Maximum size is ${MAX_FILE_SIZE_DISPLAY}.`
    }

    // Check MIME type
    if (SUPPORTED_MIME_TYPES.includes(file.type.toLowerCase())) {
        return null
    }

    // Fallback: check extension
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (SUPPORTED_EXTENSIONS.includes(ext)) {
        return null
    }

    return `Unsupported file type. Please upload MP3, WAV, M4A, AAC, FLAC, MP4, MOV, WebM, OGG, or AVI.`
}

/**
 * POST /start with optional idempotency. When an uploadIntentId is provided the
 * start is keyed `start:<uploadIntentId>` so a recovery retry returns the cached
 * job rather than creating a second one. If a prior errored job maps to that key,
 * `/start` returns 409 `{ status: 'error' }`; we retry once with a fresh random
 * key (the one-active-per-transcript unique index still prevents a duplicate active
 * job). A plain conflict 409 (no `status`) is returned as-is.
 */
async function dispatchStart(
    transcriptId: string,
    uploadIntentId: string | undefined,
    signal: AbortSignal | undefined
): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (uploadIntentId) {
        headers['x-idempotency-key'] = `start:${uploadIntentId}`
    }

    const res = await fetch(`/api/transcripts/${transcriptId}/start`, {
        method: 'POST',
        headers,
        signal,
    })

    if (res.ok || res.status !== 409 || !uploadIntentId) {
        return res
    }

    const body = await res
        .clone()
        .json()
        .catch(() => ({} as { status?: string }))
    if (body?.status !== 'error') {
        return res
    }

    console.warn('[capture] Prior start under intent key errored; retrying with a fresh key')
    return fetch(`/api/transcripts/${transcriptId}/start`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-idempotency-key': `start-retry:${randomId()}`,
        },
        signal,
    })
}

/**
 * Shared upload/transcription pipeline used by both upload capture and
 * in-browser recording capture. UI callers can subscribe to coarse progress
 * updates without coupling the pipeline to React state.
 */
export async function runCaptureUpload(
    file: File,
    title: string,
    keyTerms: string[],
    options?: CaptureUploadOptions
): Promise<CaptureUploadResult> {
    const supabase = createClient()
    const signal = options?.signal
    let transcriptId: string | null = null
    let storagePath: string | null = null
    let didUploadFile = false
    let didLinkMediaToTranscript = false
    let didDispatchStartRequest = false
    let didReceiveStartResponse = false
    let createdFreshTranscript = false

    const canceledResult = (message = 'Upload canceled.'): CaptureUploadResult => ({
        kind: 'failure',
        message,
    })
    const isCanceled = () => signal?.aborted === true
    const throwIfCanceled = () => {
        if (isCanceled()) {
            throw new DOMException('Upload canceled.', 'AbortError')
        }
    }

    if (isCanceled()) return canceledResult()

    options?.onProgress?.('creating')

    try {
        throwIfCanceled()
        const validationError = validateFile(file)
        if (validationError) {
            return { kind: 'validation_error', message: validationError }
        }

        console.log('[capture] Step 1: Creating transcript...')
        const createRes = await fetch('/api/transcripts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
                title: title || file.name,
                filename: file.name,
                key_terms: keyTerms.length > 0 ? keyTerms : undefined,
                upload_intent_id: options?.uploadIntentId
            })
        })

        if (!createRes.ok) {
            const errorData = await createRes.json().catch(() => ({}))
            console.error('[capture] Transcript creation failed:', errorData)
            throw new Error(errorData.error || `Failed to create transcript (${createRes.status})`)
        }

        const createData = await createRes.json()
        transcriptId = createData?.transcript?.id ?? null
        storagePath = createData?.storagePath ?? null
        // On a recovery retry the canonical transcript may already have its media
        // linked from a prior attempt; if so, skip re-uploading.
        const alreadyLinkedKey: string | null = createData?.sourceObjectKey ?? null

        if (!transcriptId || !storagePath) {
            throw new Error('Transcript creation response was missing required fields')
        }

        console.log('[capture] Transcript created:', transcriptId, 'storagePath:', storagePath, 'deduped:', createData?.deduped === true)
        createdFreshTranscript = createData?.deduped !== true

        if (alreadyLinkedKey) {
            // Media was already uploaded + linked on a previous attempt. Skip the
            // upload/link steps and mark them done so the catch-block classification
            // (saved_needs_retry / saved_status_unknown) stays correct.
            storagePath = alreadyLinkedKey
            didUploadFile = true
            didLinkMediaToTranscript = true
            console.log('[capture] Media already linked; skipping upload/link steps')
        } else {
            options?.onProgress?.('uploading')
            throwIfCanceled()
            console.log('[capture] Step 2: Uploading file to storage...', {
                storagePath,
                fileSize: file.size,
                fileType: file.type
            })

            const mimeType = getMimeType(file)
            // Transfer bytes to storage: single-PUT for small files, resumable
            // (TUS, 6 MB chunks) for large ones. The resumable path honours the
            // AbortSignal; the single-PUT path still can't be aborted mid-flight,
            // so the session continues to prevent discard while this runs.
            await transferToStorage(supabase, storagePath, file, {
                contentType: mimeType,
                upsert: options?.allowUpsert ?? false,
                signal,
            })
            didUploadFile = true
            throwIfCanceled()
            console.log('[capture] File uploaded successfully')

            console.log('[capture] Updating transcript with source_object_key...')
            const updateQuery = supabase
                .from('transcripts')
                .update({ source_object_key: storagePath })
                .eq('id', transcriptId)
            const { error: updateError } = await (signal
                ? updateQuery.abortSignal(signal)
                : updateQuery)

            if (updateError) {
                console.error('[capture] Failed to update transcript source_object_key:', updateError)
                throw new Error(`Failed to update transcript: ${updateError.message}`)
            }
            didLinkMediaToTranscript = true
            console.log('[capture] Transcript updated with source_object_key')
        }

        options?.onProgress?.('starting')
        throwIfCanceled()
        didDispatchStartRequest = true
        const startRes = await dispatchStart(transcriptId, options?.uploadIntentId, signal)
        didReceiveStartResponse = true
        throwIfCanceled()

        if (!startRes.ok) {
            const errorData = await startRes.json().catch(() => ({}))
            throw new Error(errorData.error || `Failed to start transcription (${startRes.status})`)
        }

        options?.onProgress?.('done')
        return {
            kind: 'success',
            transcriptId,
            outcome: 'started'
        }
    } catch (err) {
        const wasCanceled =
            isCanceled() ||
            (err instanceof DOMException && err.name === 'AbortError') ||
            ((err as { name?: string })?.name === 'AbortError')
        let message = err instanceof Error ? err.message : 'An unexpected error occurred'

        if (
            wasCanceled &&
            transcriptId &&
            didLinkMediaToTranscript &&
            !didDispatchStartRequest &&
            createdFreshTranscript
        ) {
            const rollbackMessage = await rollbackPartialCapture(
                supabase,
                transcriptId,
                storagePath,
                didUploadFile,
                createdFreshTranscript
            )
            if (rollbackMessage) {
                message = `${message} ${rollbackMessage}`
            }
            return canceledResult(message)
        }

        if (transcriptId && didLinkMediaToTranscript) {
            if (didDispatchStartRequest && !didReceiveStartResponse) {
                message = `${message} Your file was uploaded and saved, but transcription state is unknown because the network request did not complete. Check Transcripts before retrying.`
                return {
                    kind: 'success',
                    transcriptId,
                    outcome: 'saved_status_unknown',
                    message,
                }
            }

            message = `${message} Your file was uploaded and saved. Retry transcription from the Transcripts page.`
            return {
                kind: 'success',
                transcriptId,
                outcome: 'saved_needs_retry',
                message,
            }
        }

        if (transcriptId) {
            const rollbackMessage = await rollbackPartialCapture(
                supabase,
                transcriptId,
                storagePath,
                didUploadFile,
                createdFreshTranscript
            )
            if (rollbackMessage) {
                message = `${message} ${rollbackMessage}`
            }
        }

        if (wasCanceled) return canceledResult(message)

        return { kind: 'failure', message }
    }
}

export { validateFile, SUPPORTED_EXTENSIONS, MAX_FILE_SIZE_BYTES }
