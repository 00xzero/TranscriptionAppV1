import { useState, useCallback, useEffect } from 'react'
import { validateFile, MAX_FILE_SIZE_BYTES } from '@/lib/capture/upload'
import { useCapture } from '@/lib/capture/useCapture'
import { useKeyTermsField } from '@/lib/capture/useKeyTermsField'
import { useGuardedNavigate } from '@/lib/recording/guardedNavigation'
import { showCaptureWarning } from '@/lib/capture/warnings'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { isProjectAvailable } from '@/core/projects/tree'
import { captureTitleInputId } from './shared'
import { formatFileSize } from '@/lib/utils'
import { TRANSCRIPT_TITLE_TOO_LONG, transcriptTitleTooLong } from '@/core/transcripts/title'
import { readTranscriptionPreferences, saveTranscriptionPreferences } from '@/lib/capture/transcriptionPreferences'
import type { TranscriptionOptions } from '@/contracts/transcription-options'

interface UseCaptureFormParams {
  isCaptureModalOpen: boolean
  closeCaptureModal: () => void
  /** Where the dialog was opened from, if anywhere: the default destination. */
  intentProjectId?: string | null
}

export function useCaptureForm({
  isCaptureModalOpen,
  closeCaptureModal,
  intentProjectId,
}: UseCaptureFormParams) {
  const guardedNav = useGuardedNavigate()
  const { upload, isUploading, error, progress, uploadBytes, resetError } = useCapture()
  const { tree, projectsLoading, projectError } = useProjectsData()

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [keyTerms, setKeyTerms] = useState<string[]>([])
  // The options of the last transcript begun in this browser, read as the
  // dialog opens: another tab may have begun one since, and a change made here
  // but never used is dropped.
  const [transcriptionOptions, setTranscriptionOptions] = useState<TranscriptionOptions>(readTranscriptionPreferences)
  const [optionsReadForOpen, setOptionsReadForOpen] = useState(isCaptureModalOpen)
  if (optionsReadForOpen !== isCaptureModalOpen) {
    // Set while rendering the opening, so its first frame already shows them.
    setOptionsReadForOpen(isCaptureModalOpen)
    if (isCaptureModalOpen) setTranscriptionOptions(readTranscriptionPreferences())
  }
  const [fileError, setFileError] = useState<string | null>(null)
  const [titleSubmitBlocked, setTitleSubmitBlocked] = useState(false)
  // The destination the user picked. Undefined until they pick one, so the
  // intent's project applies without being copied into state on open.
  const [pickedProjectId, setPickedProjectId] = useState<string | null | undefined>(undefined)

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
      setPickedProjectId(undefined)
      resetError()
    }
  }, [isCaptureModalOpen, resetError, setKeyTermInput, setKeyTermsError])

  // The title follows the file: picking one names it after the file, and losing
  // the file (removed, or replaced by one that fails validation) empties it. An
  // edit only lasts as long as the file it was made for.
  const handleFileSelect = useCallback((file: File) => {
    const validationError = validateFile(file)
    setTitleSubmitBlocked(false)
    if (validationError) {
      setFileError(validationError)
      setSelectedFile(null)
      setTitle('')
    } else {
      setFileError(null)
      setSelectedFile(file)
      // In full, even over the title limit: the user sees it in the field and is
      // asked to shorten it on submit, rather than having it cut for them.
      setTitle(file.name.replace(/\.[^/.]+$/, ''))
    }
  }, [])

  const clearFile = useCallback(() => {
    setSelectedFile(null)
    setFileError(null)
    resetError()
    setTitle('')
    setTitleSubmitBlocked(false)
  }, [resetError])

  const chosenProjectId = pickedProjectId !== undefined ? pickedProjectId : (intentProjectId ?? null)
  // Only a successfully loaded tree can show the project is gone: a failed first
  // fetch leaves the tree empty. Otherwise the choice stands, and the server
  // files the transcript Unfiled if its project has disappeared.
  const projectsKnown = !projectsLoading && !projectError
  const projectId =
    chosenProjectId && projectsKnown && !isProjectAvailable(tree, chosenProjectId) ? null : chosenProjectId

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
    const result = await upload(selectedFile, title.trim(), keyTerms, projectId, transcriptionOptions)
    if (!result) return
    // The transcript exists, made with these options: offer them next time.
    saveTranscriptionPreferences(transcriptionOptions)

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
  }, [selectedFile, title, keyTerms, projectId, transcriptionOptions, isUploading, upload, closeCaptureModal, guardedNav, blockOverLongTitle])

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
    clearFile,
    projectId,
    setProjectId: setPickedProjectId,
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
    transcriptionOptions,
    setTranscriptionOptions,
    isUploading,
    uploadBytes,
    handleSubmit,
    canSubmit,
    displayError,
    maxFileSizeLabel,
    buttonText,
  }
}
