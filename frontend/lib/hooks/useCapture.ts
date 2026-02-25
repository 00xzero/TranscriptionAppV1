"use client"

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MAX_FILE_SIZE_BYTES as CONFIGURED_MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_DISPLAY } from '@/lib/supabase/storage'

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
                console.log(`[useCapture] Normalized MIME type: ${reportedMime} -> ${normalized}`)
            }
            return normalized
        }

        if (inferredMime) {
            console.warn(`[useCapture] Unsupported reported MIME "${reportedMime}", falling back to extension "${ext}" -> "${inferredMime}"`)
            return inferredMime
        }
    }

    if (inferredMime) {
        console.log(`[useCapture] Inferred MIME type from extension: ${ext} -> ${inferredMime}`)
        return inferredMime
    }

    // Last resort fallback - this may still fail bucket validation
    console.warn(`[useCapture] Could not determine MIME type for: ${file.name}`)
    return 'audio/mpeg'
}

const MAX_FILE_SIZE_BYTES = CONFIGURED_MAX_FILE_SIZE_BYTES

async function rollbackPartialCapture(
    supabase: ReturnType<typeof createClient>,
    projectId: string | null,
    storagePath: string | null,
    didUploadFile: boolean
): Promise<string | null> {
    const cleanupFailures: string[] = []

    if (didUploadFile && storagePath) {
        const { error: removeError } = await supabase.storage
            .from('media')
            .remove([storagePath])

        if (removeError) {
            console.error('[useCapture] Failed to remove uploaded media during rollback:', removeError)
            cleanupFailures.push('uploaded media')
        }
    }

    if (projectId) {
        const { error: deleteError } = await supabase
            .from('projects')
            .delete()
            .eq('id', projectId)

        if (deleteError) {
            console.error('[useCapture] Failed to delete project during rollback:', deleteError)
            cleanupFailures.push('project record')
        }
    }

    if (cleanupFailures.length === 0) {
        return null
    }

    return `Automatic cleanup failed for ${cleanupFailures.join(' and ')}. Please remove failed uploads from the Projects page.`
}

type UseCapture = {
    isUploading: boolean
    error: string | null
    progress: 'idle' | 'creating' | 'uploading' | 'starting' | 'done'
    upload: (file: File, title: string, keyTerms: string[]) => Promise<{
        projectId: string
        outcome: 'started' | 'saved_needs_retry' | 'saved_status_unknown'
    } | null>
    resetError: () => void
    validateFile: (file: File) => string | null
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
 * Hook for file upload and transcription triggering.
 * 
 * Flow:
 * 1. Create project via /api/projects
 * 2. Upload file to Supabase storage
 * 3. Start transcription via /api/projects/{id}/start
 */
export function useCapture(): UseCapture {
    const [isUploading, setIsUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [progress, setProgress] = useState<UseCapture['progress']>('idle')

    const resetError = useCallback(() => {
        setError(null)
        setProgress('idle')
    }, [])

    const upload = useCallback(async (
        file: File,
        title: string,
        keyTerms: string[]
    ): Promise<{
        projectId: string
        outcome: 'started' | 'saved_needs_retry' | 'saved_status_unknown'
    } | null> => {
        const supabase = createClient()
        let projectId: string | null = null
        let storagePath: string | null = null
        let didUploadFile = false
        let didLinkMediaToProject = false
        let didDispatchStartRequest = false
        let didReceiveStartResponse = false

        // Reset state
        setError(null)
        setIsUploading(true)
        setProgress('creating')

        try {
            // Validate file
            const validationError = validateFile(file)
            if (validationError) {
                setError(validationError)
                setIsUploading(false)
                setProgress('idle')
                return null
            }

            // Step 1: Create project
            console.log('[useCapture] Step 1: Creating project...')
            const createRes = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title || file.name,
                    filename: file.name,
                    key_terms: keyTerms.length > 0 ? keyTerms : undefined
                })
            })

            if (!createRes.ok) {
                const errorData = await createRes.json().catch(() => ({}))
                console.error('[useCapture] Project creation failed:', errorData)
                throw new Error(errorData.error || `Failed to create project (${createRes.status})`)
            }

            const createData = await createRes.json()
            projectId = createData?.project?.id ?? null
            storagePath = createData?.storagePath ?? null

            if (!projectId || !storagePath) {
                throw new Error('Project creation response was missing required fields')
            }

            console.log('[useCapture] Project created:', projectId, 'storagePath:', storagePath)

            // Step 2: Upload file to Supabase storage
            setProgress('uploading')
            console.log('[useCapture] Step 2: Uploading file to storage...', {
                storagePath,
                fileSize: file.size,
                fileType: file.type
            })

            const mimeType = getMimeType(file)
            const { error: uploadError } = await supabase.storage
                .from('media')
                .upload(storagePath, file, {
                    contentType: mimeType,
                    upsert: false
                })

            if (uploadError) {
                console.error('[useCapture] Storage upload failed:', uploadError)
                throw new Error(`Upload failed: ${uploadError.message}`)
            }
            didUploadFile = true
            console.log('[useCapture] File uploaded successfully')

            // Step 2b: Update project with storage path
            console.log('[useCapture] Updating project with source_object_key...')
            const { error: updateError } = await supabase
                .from('projects')
                .update({ source_object_key: storagePath })
                .eq('id', projectId)

            if (updateError) {
                console.error('[useCapture] Failed to update project source_object_key:', updateError)
                throw new Error(`Failed to update project: ${updateError.message}`)
            }
            didLinkMediaToProject = true
            console.log('[useCapture] Project updated with source_object_key')

            // Step 3: Start transcription
            setProgress('starting')
            didDispatchStartRequest = true
            const startRes = await fetch(`/api/projects/${projectId}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            })
            didReceiveStartResponse = true

            if (!startRes.ok) {
                const errorData = await startRes.json().catch(() => ({}))
                throw new Error(errorData.error || `Failed to start transcription (${startRes.status})`)
            }

            setProgress('done')
            return {
                projectId,
                outcome: 'started'
            }

        } catch (err) {
            let message = err instanceof Error ? err.message : 'An unexpected error occurred'

            // If media is already linked to the project, keep the saved project and let users retry.
            if (projectId && didLinkMediaToProject) {
                if (didDispatchStartRequest && !didReceiveStartResponse) {
                    message = `${message} Your file was uploaded and saved, but transcription state is unknown because the network request did not complete. Check Projects before retrying.`
                    setError(message)
                    setProgress('idle')
                    return {
                        projectId,
                        outcome: 'saved_status_unknown'
                    }
                }

                message = `${message} Your file was uploaded and saved. Retry transcription from the Projects page.`
                setError(message)
                setProgress('idle')
                return {
                    projectId,
                    outcome: 'saved_needs_retry'
                }
            }

            // Roll back partial state when capture did not fully persist.
            if (projectId) {
                const rollbackMessage = await rollbackPartialCapture(
                    supabase,
                    projectId,
                    storagePath,
                    didUploadFile
                )
                if (rollbackMessage) {
                    message = `${message} ${rollbackMessage}`
                }
            }

            setError(message)
            setProgress('idle')
            return null
        } finally {
            setIsUploading(false)
        }
    }, [])

    return {
        isUploading,
        error,
        progress,
        upload,
        resetError,
        validateFile
    }
}

export { validateFile, SUPPORTED_EXTENSIONS, MAX_FILE_SIZE_BYTES }
