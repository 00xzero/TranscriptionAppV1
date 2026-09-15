"use client"

import { useCallback, useState } from 'react'
import { runCaptureUpload, validateFile } from '@/lib/capture/upload'
import type { CreateTranscriptWarning } from '@/contracts/api'

type UseCapture = {
    isUploading: boolean
    error: string | null
    progress: 'idle' | 'creating' | 'uploading' | 'starting' | 'done'
    upload: (file: File, title: string, keyTerms: string[]) => Promise<{
        transcriptId: string
        outcome: 'started' | 'saved_needs_retry' | 'saved_status_unknown'
        message?: string
        warning?: CreateTranscriptWarning
    } | null>
    resetError: () => void
    validateFile: (file: File) => string | null
}

/**
 * Hook for file upload and transcription triggering.
 *
 * Flow:
 * 1. Create transcript via /api/transcripts
 * 2. Upload file to Supabase storage
 * 3. Start transcription via /api/transcripts/{id}/start
 */
export function useCapture(projectId?: string | null): UseCapture {
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
        transcriptId: string
        outcome: 'started' | 'saved_needs_retry' | 'saved_status_unknown'
        message?: string
        warning?: CreateTranscriptWarning
    } | null> => {
        setError(null)
        setIsUploading(true)
        setProgress('creating')

        try {
            const result = await runCaptureUpload(file, title, keyTerms, {
                onProgress: setProgress,
                projectId,
            })

            if (result.kind === 'validation_error' || result.kind === 'failure') {
                setError(result.message)
                setProgress('idle')
                return null
            }

            if (result.outcome !== 'started') {
                setError(result.message ?? null)
                setProgress('idle')
            }

            return {
                transcriptId: result.transcriptId,
                outcome: result.outcome,
                message: result.message,
                warning: result.warning,
            }
        } finally {
            setIsUploading(false)
        }
    }, [projectId])

    return {
        isUploading,
        error,
        progress,
        upload,
        resetError,
        validateFile
    }
}
