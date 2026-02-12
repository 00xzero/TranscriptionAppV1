"use client"

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useModal } from '@/lib/ModalContext'
import { useCapture, validateFile, MAX_FILE_SIZE_BYTES, SUPPORTED_EXTENSIONS } from '@/lib/hooks/useCapture'

const MAX_KEY_TERMS = 100

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export default function CaptureModal() {
  const { isCaptureModalOpen, closeCaptureModal } = useModal()
  const router = useRouter()
  const { upload, isUploading, error, progress, resetError } = useCapture()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [keyTerms, setKeyTerms] = useState<string[]>([])
  const [keyTermInput, setKeyTermInput] = useState('')
  const [keyTermsError, setKeyTermsError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
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
      setIsDragging(false)
      resetError()
    }
  }, [isCaptureModalOpen, resetError])

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isCaptureModalOpen && !isUploading) {
        closeCaptureModal()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isCaptureModalOpen, isUploading, closeCaptureModal])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isCaptureModalOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isCaptureModalOpen])

  // File selection handler
  const handleFileSelect = useCallback((file: File) => {
    const error = validateFile(file)
    if (error) {
      setFileError(error)
      setSelectedFile(null)
    } else {
      setFileError(null)
      setSelectedFile(file)
      // Auto-fill title if empty
      if (!title) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '')
        setTitle(nameWithoutExt)
      }
    }
  }, [title])

  // Click on dropzone
  const handleDropzoneClick = useCallback(() => {
    if (!isUploading) {
      fileInputRef.current?.click()
    }
  }, [isUploading])

  // File input change
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
    // Reset input so same file can be selected again
    e.target.value = ''
  }, [handleFileSelect])

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isUploading) {
      setIsDragging(true)
    }
  }, [isUploading])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (isUploading) return

    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }, [isUploading, handleFileSelect])

  // Key terms handlers
  const parseAndAddTerms = useCallback((input: string) => {
    const newTerms = input
      .split(/[,\n\t]+/)
      .map(t => t.trim().replace(/\s+/g, ' '))
      .filter(t => t.length > 0)

    if (newTerms.length === 0) return

    // Deduplicate case-insensitively
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
      uniqueIncomingCount > 0
        ? `Could not add ${uniqueIncomingCount} term${uniqueIncomingCount === 1 ? '' : 's'} because that would exceed the ${MAX_KEY_TERMS}-term limit.`
        : `Could not add terms because that would exceed the ${MAX_KEY_TERMS}-term limit.`
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

  // Submit handler
  const handleSubmit = useCallback(async () => {
    if (!selectedFile || isUploading) return

    const result = await upload(selectedFile, title || selectedFile.name, keyTerms)
    if (!result) return

    closeCaptureModal()

    // If transcription did not start automatically, move users to Projects so they can retry quickly.
    if (result.outcome !== 'started') {
      const params = new URLSearchParams({
        capture: result.outcome,
        projectId: result.projectId
      })
      router.push(`/projects?${params.toString()}`)
    }
    // Library will update via realtime subscription when transcription starts successfully.
  }, [selectedFile, title, keyTerms, isUploading, upload, closeCaptureModal, router])

  // Progress text
  const getButtonText = () => {
    switch (progress) {
      case 'creating': return 'Creating project...'
      case 'uploading': return 'Uploading file...'
      case 'starting': return 'Starting transcription...'
      case 'done': return 'Done!'
      default: return 'Begin Transcription'
    }
  }

  if (!isCaptureModalOpen) return null

  const canSubmit = selectedFile && !isUploading && !fileError
  const displayError = fileError || error
  const maxFileSizeLabel = formatFileSize(MAX_FILE_SIZE_BYTES)

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-paper/20 dark:bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={isUploading ? undefined : closeCaptureModal}
      />

      {/* Modal Window */}
      <div className="absolute top-[10%] left-1/2 -translate-x-1/2 w-[500px] max-w-[90vw] bg-[#F2EFED]/90 dark:bg-[#141414]/90 backdrop-blur-xl border border-[#D1CEC5] dark:border-[#333] rounded-xl shadow-2xl overflow-hidden flex flex-col text-ink dark:text-[#EAEAEA]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#D1CEC5] dark:border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-ember-red">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </span>
            <h3 className="font-sans font-medium text-sm">Capture</h3>
          </div>
          <button
            type="button"
            className={`flex items-center gap-2 bg-transparent border-none p-0 ${isUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            onClick={isUploading ? undefined : closeCaptureModal}
            disabled={isUploading}
            aria-label="Close modal"
          >
            <span className="text-[10px] font-mono opacity-40 border border-current px-1.5 py-0.5 rounded">ESC</span>
            <svg className="w-4 h-4 opacity-50 hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto max-h-[70vh] space-y-6">

          {/* Section 1: File Upload */}
          <div className="space-y-3">
            <label className="block text-[10px] font-mono uppercase tracking-wider opacity-60">Select File</label>
            <p className="text-[10px] text-ink/40 dark:text-white/40 mb-2">
              MP3, WAV, M4A, AAC, FLAC, MP4, MOV, WebM, OGG, AVI (up to {maxFileSizeLabel})
            </p>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept={SUPPORTED_EXTENSIONS.map(ext => `.${ext}`).join(',')}
              onChange={handleFileInputChange}
              className="hidden"
            />

            {/* Dropzone */}
            <div
              onClick={handleDropzoneClick}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg h-40 flex flex-col items-center justify-center gap-3 transition-colors cursor-pointer group ${isDragging
                ? 'border-trust-blue bg-trust-blue/10'
                : selectedFile
                  ? 'border-trust-blue/50 bg-trust-blue/5'
                  : 'border-[#D1CEC5] dark:border-[#333] bg-ink/5 dark:bg-white/5 hover:border-trust-blue hover:bg-trust-blue/5'
                } ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {selectedFile ? (
                <>
                  <div className="w-10 h-10 rounded-full bg-trust-blue/10 border border-trust-blue/30 flex items-center justify-center text-trust-blue">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-ink/80 dark:text-white/80 truncate max-w-[300px]">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-ink/40 dark:text-white/40 mt-1">
                      {formatFileSize(selectedFile.size)}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-10 h-10 rounded-full bg-paper dark:bg-[#222] border border-[#D1CEC5] dark:border-[#444] flex items-center justify-center text-ink/40 dark:text-white/40 group-hover:text-trust-blue group-hover:border-trust-blue transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12" />
                    </svg>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-ink/80 dark:text-white/80">Drop recording here</p>
                    <p className="text-xs text-ink/40 dark:text-white/40 my-1">or</p>
                    <span className="text-xs font-mono border border-[#D1CEC5] dark:border-[#444] px-2 py-1 rounded bg-paper dark:bg-[#222]">Browse Files</span>
                  </div>
                </>
              )}
            </div>

            {/* Error message */}
            {displayError && (
              <p className="text-xs text-ember-red">{displayError}</p>
            )}
          </div>

          {/* Section 2: Project Details */}
          <div className="space-y-4 pt-2 border-t border-[#D1CEC5] dark:border-white/10">
            <label className="block text-[10px] font-mono uppercase tracking-wider opacity-60 mt-4">Project Details</label>

            {/* Title */}
            <div className="space-y-1">
              <label className="text-xs font-medium opacity-80">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Client Interview - January 2026"
                disabled={isUploading}
                className="w-full bg-white/50 dark:bg-[#222]/50 border border-[#D1CEC5] dark:border-[#444] rounded px-3 py-2 text-sm focus:outline-none focus:border-trust-blue focus:bg-white dark:focus:bg-[#222] transition-colors placeholder-ink/30 dark:placeholder-white/20 disabled:opacity-50"
              />
            </div>

            {/* Language - Coming Soon */}
            <div className="space-y-1">
              <label className="text-xs font-medium opacity-80">
                Language <span className="text-[10px] font-mono opacity-50 ml-1">(coming soon)</span>
              </label>
              <div className="relative">
                <select
                  className="w-full bg-white/50 dark:bg-[#222]/50 border border-[#D1CEC5] dark:border-[#444] rounded px-3 py-2 text-sm transition-colors appearance-none cursor-not-allowed opacity-60"
                  disabled
                >
                  <option>English (US)</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Diarization - Coming Soon */}
            <div className="flex items-center justify-between pt-2">
              <div>
                <p className="text-xs font-medium opacity-80">
                  Speaker Diarization <span className="text-[10px] font-mono opacity-50">(coming soon)</span>
                </p>
                <p className="text-[10px] text-ink/40 dark:text-white/40">Automatically identify speakers</p>
              </div>

              {/* Toggle - defaulted to ON */}
              <div className="relative inline-block w-10 mr-2 align-middle select-none opacity-50 cursor-not-allowed">
                <div className="block overflow-hidden h-5 rounded-full bg-ember-red">
                  <div className="absolute block w-5 h-5 rounded-full bg-white border-4 border-ember-red right-0" />
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Key Terms */}
          <div className="space-y-3 pt-2 border-t border-[#D1CEC5] dark:border-white/10">
            <label className="block text-[10px] font-mono uppercase tracking-wider opacity-60 mt-4">Key Terms (Optional)</label>

            <div className="flex gap-2">
              <input
                type="text"
                value={keyTermInput}
                onChange={(e) => setKeyTermInput(e.target.value)}
                onKeyDown={handleKeyTermKeyDown}
                placeholder="e.g., PAS-X, Helsingborg, Move-X"
                disabled={isUploading || keyTerms.length >= MAX_KEY_TERMS}
                className="flex-1 bg-white/50 dark:bg-[#222]/50 border border-[#D1CEC5] dark:border-[#444] rounded px-3 py-2 text-sm focus:outline-none focus:border-trust-blue focus:bg-white dark:focus:bg-[#222] transition-colors placeholder-ink/30 dark:placeholder-white/20 disabled:opacity-50"
              />
              <button
                onClick={handleAddTermClick}
                disabled={isUploading || !keyTermInput.trim() || keyTerms.length >= MAX_KEY_TERMS}
                className="px-3 border border-[#D1CEC5] dark:border-[#444] rounded bg-white/50 dark:bg-[#222]/50 hover:bg-ink/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                <svg className="w-4 h-4 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>

            <div className="flex justify-between items-center">
              <p className="text-[10px] text-ink/40 dark:text-white/40">Add up to 100 terms. Separate with commas.</p>
              <p className="text-[10px] font-mono opacity-40">{keyTerms.length} / {MAX_KEY_TERMS} terms</p>
            </div>

            {keyTermsError && (
              <p className="text-xs text-ember-red">{keyTermsError}</p>
            )}

            {/* Tags Container */}
            {keyTerms.length > 0 && (
              <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                {keyTerms.map((term, index) => (
                  <span
                    key={`${term}-${index}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-trust-blue/10 text-trust-blue border border-trust-blue/20"
                  >
                    <span className="max-w-[150px] truncate">{term}</span>
                    <button
                      onClick={() => removeTerm(index)}
                      disabled={isUploading}
                      className="ml-0.5 hover:text-ember-red transition-colors disabled:opacity-50"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 bg-ink/5 dark:bg-[#0f0f0f] border-t border-[#D1CEC5] dark:border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2 opacity-50">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[10px] w-32 md:w-auto leading-tight">60-min file ≈ 5 min process</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={closeCaptureModal}
              disabled={isUploading}
              className="text-xs font-medium hover:text-ink/70 dark:hover:text-white/70 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={`text-xs font-medium px-4 py-2 rounded shadow-sm transition-all active:scale-95 ${canSubmit
                ? 'bg-[#4A2018] text-white/90 border border-[#5A2A20] hover:bg-[#5A2A20] hover:text-white'
                : 'bg-[#4A2018]/50 text-white/50 border border-[#5A2A20]/50 cursor-not-allowed'
                }`}
            >
              {isUploading && (
                <svg className="animate-spin -ml-1 mr-2 h-3 w-3 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {getButtonText()}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
