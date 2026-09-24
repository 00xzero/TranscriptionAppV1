import { useState, useCallback, useEffect, useRef } from 'react'
import { validateFile, MAX_FILE_SIZE_BYTES } from '@/lib/capture/upload'
import { useCapture } from '@/lib/capture/useCapture'
import { useKeyTermsField } from '@/lib/capture/useKeyTermsField'
import { useGuardedNavigate } from '@/lib/recording/guardedNavigation'
import { showCaptureWarning } from '@/lib/capture/warnings'
import { captureTitleInputId, formatFileSize } from './shared'
import { TRANSCRIPT_TITLE_TOO_LONG, transcriptTitleTooLong } from '@/core/transcripts/title'

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
  const [titleSubmitBlocked, setTitleSubmitBlocked] = useState(false)
  // The last title filled in from a filename. While the field still holds it, the
  // user has not made the title their own, so picking another file may replace it.
  const autoTitleRef = useRef<string | null>(null)

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
      setTitleSubmitBlocked(false)
      autoTitleRef.current = null
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
      // Prefilled in full, even over the title limit: the user sees it in the field
      // and is asked to shorten it on submit, rather than having it cut for them.
      // A title the user typed or edited is kept; only an untouched prefill follows
      // the newly picked file.
      if (!title || title === autoTitleRef.current) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '')
        autoTitleRef.current = nameWithoutExt
        setTitle(nameWithoutExt)
      }
    }
  }, [title])

  /**
   * Shared by both submit paths (upload and start recording). Returns true when the
   * title is over the limit: the submit stops and focus goes to the title field.
   */
  const blockOverLongTitle = useCallback(() => {
    if (!transcriptTitleTooLong(title)) return false
    setTitleSubmitBlocked(true)
    document.getElementById(captureTitleInputId)?.focus()
    return true
  }, [title])

  const handleSubmit = useCallback(async () => {
    if (!selectedFile || isUploading) return
    if (blockOverLongTitle()) return

    // A cleared title is sent empty so the upload's filename fallback, which fits
    // the name under the limit, names the transcript instead.
    const result = await upload(selectedFile, title.trim(), keyTerms, projectId)
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
  }, [selectedFile, title, keyTerms, projectId, isUploading, upload, closeCaptureModal, guardedNav, blockOverLongTitle])

  // Clears itself once the title fits again.
  const titleError = titleSubmitBlocked && transcriptTitleTooLong(title) ? TRANSCRIPT_TITLE_TOO_LONG : null

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
    titleError,
    blockOverLongTitle,
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
