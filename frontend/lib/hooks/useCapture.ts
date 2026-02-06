"use client"

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Supported file types for upload.
 * Matches Olivetti prototype and Deepgram supported formats.
 */
const SUPPORTED_EXTENSIONS = [
    'mp3', 'wav', 'm4a', 'aac', 'flac', // audio
    'mp4', 'mov', 'webm', 'ogg'         // video
]

const SUPPORTED_MIME_TYPES = [
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
    'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac',
    'audio/flac', 'audio/x-flac',
    'video/mp4', 'video/quicktime', 'video/webm',
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
    // If browser provides a MIME type, normalize it
    if (file.type && file.type !== '') {
        const normalized = MIME_NORMALIZATION[file.type]
        if (normalized) {
            console.log(`[useCapture] Normalized MIME type: ${file.type} -> ${normalized}`)
            return normalized
        }
        return file.type
    }

    // Infer from extension
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    const inferredMime = EXTENSION_TO_MIME[ext]

    if (inferredMime) {
        console.log(`[useCapture] Inferred MIME type from extension: ${ext} -> ${inferredMime}`)
        return inferredMime
    }

    // Last resort fallback - this may still fail bucket validation
    console.warn(`[useCapture] Could not determine MIME type for: ${file.name}`)
    return 'audio/mpeg'
}

const MAX_FILE_SIZE_BYTES = 1.5 * 1024 * 1024 * 1024 // 1.5GB

type UseCapture = {
    isUploading: boolean
    error: string | null
    progress: 'idle' | 'creating' | 'uploading' | 'starting' | 'done'
    upload: (file: File, title: string, keyTerms: string[]) => Promise<string | null>
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
        return `File too large (${sizeMB}MB). Maximum size is 1.5GB.`
    }

    // Check MIME type
    if (SUPPORTED_MIME_TYPES.includes(file.type)) {
        return null
    }

    // Fallback: check extension
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (SUPPORTED_EXTENSIONS.includes(ext)) {
        return null
    }

    return `Unsupported file type. Please upload MP3, WAV, M4A, AAC, FLAC, MP4, MOV, WebM, or OGG.`
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
    }, [])

    const upload = useCallback(async (
        file: File,
        title: string,
        keyTerms: string[]
    ): Promise<string | null> => {
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

            const { project, storagePath } = await createRes.json()
            console.log('[useCapture] Project created:', project.id, 'storagePath:', storagePath)

            // Step 2: Upload file to Supabase storage
            setProgress('uploading')
            console.log('[useCapture] Step 2: Uploading file to storage...', {
                storagePath,
                fileSize: file.size,
                fileType: file.type
            })
            const supabase = createClient()

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
            console.log('[useCapture] File uploaded successfully')

            // Step 2b: Update project with storage path
            console.log('[useCapture] Updating project with source_object_key...')
            const { error: updateError } = await supabase
                .from('projects')
                .update({ source_object_key: storagePath })
                .eq('id', project.id)

            if (updateError) {
                console.error('[useCapture] Failed to update project source_object_key:', updateError)
                throw new Error(`Failed to update project: ${updateError.message}`)
            }
            console.log('[useCapture] Project updated with source_object_key')

            // Step 3: Start transcription
            setProgress('starting')
            const startRes = await fetch(`/api/projects/${project.id}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            })

            if (!startRes.ok) {
                const errorData = await startRes.json().catch(() => ({}))
                throw new Error(errorData.error || `Failed to start transcription (${startRes.status})`)
            }

            setProgress('done')
            return project.id

        } catch (err) {
            const message = err instanceof Error ? err.message : 'An unexpected error occurred'
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
