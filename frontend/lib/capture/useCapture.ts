"use client"

import { useCallback, useState } from 'react'
import {
    runCaptureUpload,
    validateFile,
    type CaptureUploadSuccess,
} from '@/lib/capture/upload'
import type { TranscriptionOptions } from '@/contracts/transcription-options'

/** How much of the file is in storage, from the moment it starts uploading. */
export type UploadBytes = { sent: number; total: number }

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
            const result = await runCaptureUpload(file, title, keyTerms, {
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
    }, [])

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
