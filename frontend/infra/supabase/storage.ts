/**
 * Supabase Storage utilities for media file handling.
 *
 * Storage path convention: {user_id}/{project_id}/{filename}
 * Bucket: 'media' (private, 50MB default - configurable via NEXT_PUBLIC_MAX_FILE_SIZE_MB)
 */

import { SupabaseClient } from '@supabase/supabase-js'

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

// Allowed MIME types (matches Supabase bucket config)
export const ALLOWED_MIME_TYPES = [
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/flac',
    'audio/mp4',
    'audio/aac',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo',
    // Common variations
    'audio/x-wav',
    'audio/x-m4a',
    'audio/mp3',
    'video/x-m4v',
]

/**
 * Validate file before upload.
 * Returns null if valid, or error message string.
 */
export function validateMediaFile(file: File): string | null {
    if (file.size > MAX_FILE_SIZE_BYTES) {
        const sizeMB = Math.round(file.size / (1024 * 1024))
        return `File too large: ${sizeMB}MB exceeds limit of ${MAX_FILE_SIZE_DISPLAY}`
    }

    // Be lenient with MIME type checking - browsers can report different types
    const mimeType = file.type.toLowerCase()
    if (mimeType && !ALLOWED_MIME_TYPES.includes(mimeType)) {
        // Check if it starts with audio/ or video/
        if (!mimeType.startsWith('audio/') && !mimeType.startsWith('video/')) {
            return `Invalid file type: ${file.type}. Please upload an audio or video file.`
        }
    }

    return null
}

/**
 * Build the storage path for a media file.
 */
export function getMediaPath(userId: string, projectId: string, filename: string): string {
    // Sanitize filename: remove path separators, limit length
    const sanitized = filename
        .replace(/[/\\]/g, '_')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 200)

    return `${userId}/${projectId}/${sanitized || 'media'}`
}

/**
 * Upload a media file to Supabase Storage.
 *
 * @param supabase - Supabase client instance
 * @param file - File to upload
 * @param userId - Current user's ID
 * @param projectId - Project ID to associate with
 * @param onProgress - Optional progress callback (0-100)
 * @returns Object with path on success, or error on failure
 */
export async function uploadProjectMedia(
    supabase: SupabaseClient,
    file: File,
    userId: string,
    projectId: string,
    onProgress?: (percent: number) => void
): Promise<{ path: string; error: null } | { path: null; error: string }> {
    const path = getMediaPath(userId, projectId, file.name)

    // Supabase JS client v2 doesn't have built-in progress tracking,
    // but we can simulate start/end for UX
    if (onProgress) {
        onProgress(0)
    }

    const { error } = await supabase.storage
        .from('media')
        .upload(path, file, {
            cacheControl: '3600',
            upsert: false, // Don't overwrite existing files
            contentType: file.type || 'application/octet-stream',
        })

    if (error) {
        console.error('[storage] Upload error:', error)
        return { path: null, error: error.message }
    }

    if (onProgress) {
        onProgress(100)
    }

    return { path, error: null }
}

/**
 * Generate a signed download URL for an object in a private bucket.
 * Defaults to the 'media' bucket for backwards-compatible call sites.
 */
export async function getSignedMediaUrl(
    supabase: SupabaseClient,
    path: string,
    expiresIn: number = 3600,
    bucket: string = 'media'
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
 * @param objectKey - Storage path (from project.source_object_key)
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

/**
 * Delete a media file from storage.
 *
 * @param supabase - Supabase client instance
 * @param path - Storage path to delete
 * @returns Object with error on failure, null error on success
 */
export async function deleteProjectMedia(
    supabase: SupabaseClient,
    path: string
): Promise<{ error: string | null }> {
    const { error } = await supabase.storage
        .from('media')
        .remove([path])

    if (error) {
        console.error('[storage] Delete error:', error)
        return { error: error.message }
    }

    return { error: null }
}
