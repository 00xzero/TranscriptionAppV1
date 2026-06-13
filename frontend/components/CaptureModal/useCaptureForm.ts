import { useState, useCallback, useEffect } from 'react'
import { validateFile, MAX_FILE_SIZE_BYTES } from '@/lib/capture/upload'
import { useCapture } from '@/lib/hooks/useCapture'
import { useGuardedNavigate } from '@/lib/recording/guardedNavigation'
import { MAX_KEY_TERMS, formatFileSize } from './shared'

interface UseCaptureFormParams {
  isCaptureModalOpen: boolean
  closeCaptureModal: () => void
}

export function useCaptureForm({ isCaptureModalOpen, closeCaptureModal }: UseCaptureFormParams) {
  const guardedNav = useGuardedNavigate()
  const { upload, isUploading, error, progress, resetError } = useCapture()

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [keyTerms, setKeyTerms] = useState<string[]>([])
  const [keyTermInput, setKeyTermInput] = useState('')
  const [keyTermsError, setKeyTermsError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

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
  }, [isCaptureModalOpen, resetError])

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

  const parseAndAddTerms = useCallback((input: string) => {
    const newTerms = input
      .split(/[,\n\t]+/)
      .map(t => t.trim().replace(/\s+/g, ' '))
      .filter(t => t.length > 0)

    if (newTerms.length === 0) return

    const seen = new Map<string, string>()
    for (const t of keyTerms) {
      seen.set(t.toLowerCase(), t)
    }
    let uniqueIncomingCount = 0
    for (const t of newTerms) {
      if (!seen.has(t.toLowerCase())) {
        seen.set(t.toLowerCase(), t)
        uniqueIncomingCount += 1
      }
    }

    const allTerms = Array.from(seen.values())
    if (allTerms.length <= MAX_KEY_TERMS) {
      setKeyTerms(allTerms)
      setKeyTermsError(null)
      return
    }

    setKeyTermsError(
      `Could not add ${uniqueIncomingCount} term${uniqueIncomingCount === 1 ? '' : 's'} because that would exceed the ${MAX_KEY_TERMS}-term limit.`
    )
  }, [keyTerms])

  const handleKeyTermKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      parseAndAddTerms(keyTermInput)
      setKeyTermInput('')
    }
  }, [keyTermInput, parseAndAddTerms])

  const handleAddTermClick = useCallback(() => {
    parseAndAddTerms(keyTermInput)
    setKeyTermInput('')
  }, [keyTermInput, parseAndAddTerms])

  const removeTerm = useCallback((index: number) => {
    setKeyTerms(prev => prev.filter((_, i) => i !== index))
    setKeyTermsError(null)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!selectedFile || isUploading) return

    const result = await upload(selectedFile, title || selectedFile.name, keyTerms)
    if (!result) return

    closeCaptureModal()

    if (result.outcome !== 'started') {
      const params = new URLSearchParams({
        capture: result.outcome,
        projectId: result.projectId
      })
      if (result.message) {
        params.set('captureMessage', result.message)
      }
      guardedNav.push(`/projects?${params.toString()}`)
    }
  }, [selectedFile, title, keyTerms, isUploading, upload, closeCaptureModal, guardedNav])

  const canSubmit = Boolean(selectedFile && !isUploading && !fileError)
  const displayError = fileError ?? error ?? null
  const maxFileSizeLabel = formatFileSize(MAX_FILE_SIZE_BYTES)

  let buttonText: string
  switch (progress) {
    case 'creating': buttonText = 'Creating project...'; break
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
