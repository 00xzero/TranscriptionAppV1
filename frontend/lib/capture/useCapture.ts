"use client"

import { useCallback, useState } from 'react'
import {
    runCaptureUpload,
    validateFile,
    type CaptureUploadSuccess,
    type UploadBytes,
} from '@/lib/capture/upload'
import type { TranscriptionOptions } from '@/contracts/transcription-options'
import { useAuth } from '@/lib/auth/AuthProvider'

type UseCapture = {
    isUploading: boolean
    error: string | null
    progress: 'idle' | 'creating' | 'uploading' | 'starting' | 'done'
    uploadBytes: UploadBytes | null
  upload: (
        file: File,
        title: string,
        keyTerms: string[],
        projectId?: string | null,
        transcriptionOptions?: TranscriptionOptions
    ) => Promise<CaptureUploadSuccess | null>
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
export function useCapture(): UseCapture {
    const { userId, ready } = useAuth()
    const [isUploading, setIsUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [progress, setProgress] = useState<UseCapture['progress']>('idle')
    const [uploadBytes, setUploadBytes] = useState<UploadBytes | null>(null)

    const resetError = useCallback(() => {
        setError(null)
        setProgress('idle')
    }, [])

    const upload = useCallback(async (
        file: File,
        title: string,
        keyTerms: string[],
        projectId?: string | null,
        transcriptionOptions?: TranscriptionOptions
    ): Promise<CaptureUploadSuccess | null> => {
        setError(null)
        setIsUploading(true)
        setProgress('creating')
        setUploadBytes(null)

        try {
            if (!ready || !userId) {
                setError('Sign in before uploading audio.')
                setProgress('idle')
                return null
            }
            const result = await runCaptureUpload(file, title, keyTerms, {
                userId,
                onProgress: (stage) => {
                    setProgress(stage)
                    if (stage === 'uploading') setUploadBytes({ sent: 0, total: file.size })
                },
                onUploadBytes: (sent, total) => setUploadBytes({ sent, total }),
                projectId,
                transcriptionOptions,
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
            setUploadBytes(null)
        }
    }, [userId, ready])

    return {
        isUploading,
        error,
        progress,
        uploadBytes,
        upload,
        resetError,
        validateFile
    }
}
