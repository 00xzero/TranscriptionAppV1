"use client"

import { useRef, useEffect, useId } from 'react'
import { useModal } from '@/lib/ModalContext'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useCaptureForm } from './useCaptureForm'
import FileDropZone from './FileDropZone'
import CaptureDetails from './CaptureDetails'
import KeyTermsInput from './KeyTermsInput'
import CaptureFooter from './CaptureFooter'

export default function CaptureModal() {
  const { isCaptureModalOpen, closeCaptureModal } = useModal()
  const modalRef = useRef<HTMLDivElement>(null)
  const originalOverflowRef = useRef<string | null>(null)
  const dialogTitleId = useId()
  useFocusTrap(modalRef, isCaptureModalOpen)

  const {
    selectedFile,
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
  } = useCaptureForm({ isCaptureModalOpen, closeCaptureModal })

  // ESC key — modal-level concern, stays in shell
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isCaptureModalOpen && !isUploading) {
        closeCaptureModal()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isCaptureModalOpen, isUploading, closeCaptureModal])

  // Body scroll lock — modal-level concern, stays in shell
  useEffect(() => {
    if (isCaptureModalOpen) {
      if (originalOverflowRef.current === null) {
        originalOverflowRef.current = document.body.style.overflow
      }
      document.body.style.overflow = 'hidden'
    }

    return () => {
      if (originalOverflowRef.current !== null) {
        document.body.style.overflow = originalOverflowRef.current
        originalOverflowRef.current = null
      }
    }
  }, [isCaptureModalOpen])

  if (!isCaptureModalOpen) return null

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-paper/20 dark:bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={isUploading ? undefined : closeCaptureModal}
      />

      {/* Modal Window */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        tabIndex={-1}
        className="absolute top-[10%] left-1/2 -translate-x-1/2 w-[500px] max-w-[90vw] bg-[#F2EFED]/45 dark:bg-[#141414]/45 backdrop-blur-md border border-[#D1CEC5] dark:border-[#333] rounded-xl shadow-2xl overflow-hidden flex flex-col text-ink dark:text-[#EAEAEA]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#D1CEC5] dark:border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-ember-red">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </span>
            <h3 id={dialogTitleId} className="font-sans font-medium text-sm">Capture</h3>
          </div>
          <button
            type="button"
            className={`flex items-center gap-2 bg-transparent border-none p-0 ${isUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            onClick={isUploading ? undefined : closeCaptureModal}
            disabled={isUploading}
            aria-label="Close modal"
            title="Close (Esc)"
          >
            <span className="text-[10px] font-mono opacity-40 border border-current px-1.5 py-0.5 rounded">ESC</span>
            <svg className="w-4 h-4 opacity-50 hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto max-h-[70vh] space-y-6">
          <FileDropZone
            selectedFile={selectedFile}
            onFileSelect={handleFileSelect}
            isUploading={isUploading}
            displayError={displayError}
            maxFileSizeLabel={maxFileSizeLabel}
          />
          <CaptureDetails
            title={title}
            setTitle={setTitle}
            isUploading={isUploading}
          />
          <KeyTermsInput
            keyTerms={keyTerms}
            keyTermInput={keyTermInput}
            setKeyTermInput={setKeyTermInput}
            keyTermsError={keyTermsError}
            isUploading={isUploading}
            onKeyDown={handleKeyTermKeyDown}
            onAddClick={handleAddTermClick}
            onRemoveTerm={removeTerm}
          />
        </div>

        <CaptureFooter
          isUploading={isUploading}
          canSubmit={canSubmit}
          onClose={closeCaptureModal}
          onSubmit={handleSubmit}
          buttonText={buttonText}
        />
      </div>
    </div>
  )
}
