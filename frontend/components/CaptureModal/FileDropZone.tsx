"use client"

import { useState, useCallback, useRef } from 'react'
import { SUPPORTED_EXTENSIONS } from '@/lib/hooks/useCapture'
import { formatFileSize } from './shared'

interface FileDropZoneProps {
  selectedFile: File | null
  onFileSelect: (file: File) => void
  isUploading: boolean
  displayError: string | null
  maxFileSizeLabel: string
}

const fileInputId = 'capture-file-input'

export default function FileDropZone({
  selectedFile,
  onFileSelect,
  isUploading,
  displayError,
  maxFileSizeLabel,
}: FileDropZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleDropzoneClick = useCallback(() => {
    if (!isUploading) {
      fileInputRef.current?.click()
    }
  }, [isUploading])

  const handleDropzoneKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isUploading) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fileInputRef.current?.click()
    }
  }, [isUploading])

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onFileSelect(file)
    }
    e.target.value = ''
  }, [onFileSelect])

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
      onFileSelect(file)
    }
  }, [isUploading, onFileSelect])

  return (
    <div className="space-y-3">
      <label className="block text-[10px] font-mono uppercase tracking-wider opacity-60" htmlFor={fileInputId}>Select File</label>
      <p className="text-[10px] text-ink/40 dark:text-white/40 mb-2">
        MP3, WAV, M4A, AAC, FLAC, MP4, MOV, WebM, OGG, AVI (up to {maxFileSizeLabel})
      </p>

      <input
        id={fileInputId}
        ref={fileInputRef}
        type="file"
        accept={SUPPORTED_EXTENSIONS.map(ext => `.${ext}`).join(',')}
        onChange={handleFileInputChange}
        aria-label="Select an audio or video file for transcription"
        className="hidden"
      />

      <div
        onClick={handleDropzoneClick}
        onKeyDown={handleDropzoneKeyDown}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        tabIndex={0}
        role="button"
        aria-label={selectedFile ? `Change selected file. Current file: ${selectedFile.name}` : 'Choose an audio or video file'}
        title={selectedFile ? `Change selected file (${selectedFile.name})` : 'Choose a file'}
        aria-disabled={isUploading}
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

      {displayError && (
        <p className="text-xs text-ember-red">{displayError}</p>
      )}
    </div>
  )
}
