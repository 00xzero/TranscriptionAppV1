import { useState, useCallback, useEffect } from 'react'
import { validateFile, MAX_FILE_SIZE_BYTES } from '@/lib/capture/upload'
import { useCapture } from '@/lib/capture/useCapture'
import { useKeyTermsField } from '@/lib/capture/useKeyTermsField'
import { useGuardedNavigate } from '@/lib/recording/guardedNavigation'
import { showCaptureWarning } from '@/lib/capture/warnings'
import { formatFileSize } from './shared'

interface UseCaptureFormParams {
  isCaptureModalOpen: boolean
  closeCaptureModal: () => void
  projectId?: string | null
}

export function useCaptureForm({
  isCaptureModalOpen,
  closeCaptureModal,
  projectId,
}: UseCaptureFormParams) {
  const guardedNav = useGuardedNavigate()
  const { upload, isUploading, error, progress, resetError } = useCapture()

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [keyTerms, setKeyTerms] = useState<string[]>([])
  const [fileError, setFileError] = useState<string | null>(null)

  const {
    keyTermInput,
    setKeyTermInput,
    keyTermsError,
    setKeyTermsError,
    handleKeyTermKeyDown,
    handleAddTermClick,
    removeTerm,
  } = useKeyTermsField({ keyTerms, onKeyTermsChange: setKeyTerms })

  // Reset form when modal closes
  useEffect(() => {
    if (!isCaptureModalOpen) {
      setSelectedFile(null)
      setTitle('')
      setKeyTerms([])
      setKeyTermInput('')
      setKeyTermsError(null)
      setFileError(null)
      resetError()
    }
  }, [isCaptureModalOpen, resetError, setKeyTermInput, setKeyTermsError])

  const handleFileSelect = useCallback((file: File) => {
    const validationError = validateFile(file)
    if (validationError) {
      setFileError(validationError)
      setSelectedFile(null)
    } else {
      setFileError(null)
      setSelectedFile(file)
      if (!title) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '')
        setTitle(nameWithoutExt)
      }
    }
  }, [title])

  const handleSubmit = useCallback(async () => {
    if (!selectedFile || isUploading) return

    const result = await upload(selectedFile, title || selectedFile.name, keyTerms, projectId)
    if (!result) return

    closeCaptureModal()
    showCaptureWarning(result.warning)

    if (result.outcome !== 'started') {
      const params = new URLSearchParams({
        capture: result.outcome,
        transcriptId: result.transcriptId
      })
      if (result.message) {
        params.set('captureMessage', result.message)
      }
      guardedNav.push(`/transcripts?${params.toString()}`)
    }
  }, [selectedFile, title, keyTerms, projectId, isUploading, upload, closeCaptureModal, guardedNav])

  const canSubmit = Boolean(selectedFile && !isUploading && !fileError)
  const displayError = fileError ?? error ?? null
  const maxFileSizeLabel = formatFileSize(MAX_FILE_SIZE_BYTES)

  let buttonText: string
  switch (progress) {
    case 'creating': buttonText = 'Creating transcript...'; break
    case 'uploading': buttonText = 'Uploading file...'; break
    case 'starting': buttonText = 'Starting transcription...'; break
    case 'done':     buttonText = 'Done!'; break
    default:         buttonText = 'Begin Transcription'
  }

  return {
    selectedFile,
    fileError,
    handleFileSelect,
    title,
    setTitle,
    keyTerms,
    keyTermInput,
    setKeyTermInput,
    keyTermsError,
    handleKeyTermKeyDown,
    handleAddTermClick,
    removeTerm,
    isUploading,
    handleSubmit,
    canSubmit,
    displayError,
    maxFileSizeLabel,
    buttonText,
  }
}
