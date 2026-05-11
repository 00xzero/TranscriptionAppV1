"use client"

import { useEffect, useLayoutEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useDialogFocusRestore } from '@/components/ui/use-dialog-focus-restore'
import { useModal } from '@/lib/ModalContext'
import { useCaptureForm } from './useCaptureForm'
import FileDropZone from './FileDropZone'
import CaptureDetails from './CaptureDetails'
import KeyTermsInput from './KeyTermsInput'
import CaptureFooter from './CaptureFooter'

export default function CaptureModal() {
  const { isCaptureModalOpen, closeCaptureModal } = useModal()
  const { captureFocus, restoreFocus } = useDialogFocusRestore()
  const wasOpenRef = useRef(false)
  const restoreOnExternalCloseRef = useRef(true)

  useLayoutEffect(() => {
    if (isCaptureModalOpen && !wasOpenRef.current) {
      restoreOnExternalCloseRef.current = true
      captureFocus()
    }
  }, [isCaptureModalOpen, captureFocus])

  useEffect(() => {
    if (!isCaptureModalOpen && wasOpenRef.current && restoreOnExternalCloseRef.current) {
      restoreFocus()
    }

    wasOpenRef.current = isCaptureModalOpen
  }, [isCaptureModalOpen, restoreFocus])

  const handleClose = () => {
    restoreOnExternalCloseRef.current = false
    closeCaptureModal()
    restoreFocus()
  }

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
  } = useCaptureForm({ isCaptureModalOpen, closeCaptureModal: handleClose })

  return (
    <Dialog
      open={isCaptureModalOpen}
      onOpenChange={(open) => {
        if (!open && !isUploading) {
          handleClose()
        }
      }}
    >
      <DialogContent
        className="top-[10%] w-[500px] overflow-hidden p-0 text-ink dark:text-paper"
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (isUploading) {
            event.preventDefault()
          }
        }}
        onPointerDownOutside={(event) => {
          if (isUploading) {
            event.preventDefault()
          }
        }}
      >
        <div className="flex items-center justify-between border-b border-[#D1CEC5] px-6 py-4 dark:border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-ember-red">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </span>
            <DialogTitle className="font-sans text-sm font-medium not-italic">Capture</DialogTitle>
          </div>
          <button
            type="button"
            className={`flex items-center gap-2 border-none bg-transparent p-0 ${isUploading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            onClick={isUploading ? undefined : handleClose}
            disabled={isUploading}
            aria-label="Close modal"
            title="Close (Esc)"
          >
            <span className="rounded-sm border border-current px-1.5 py-0.5 text-[10px] font-mono opacity-40">ESC</span>
            <svg className="h-4 w-4 opacity-50 hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] space-y-6 overflow-y-auto p-6">
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
          onClose={handleClose}
          onSubmit={handleSubmit}
          buttonText={buttonText}
        />
      </DialogContent>
    </Dialog>
  )
}
