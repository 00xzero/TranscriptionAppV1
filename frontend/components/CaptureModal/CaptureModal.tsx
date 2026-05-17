"use client"

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDialogFocusRestore } from '@/components/ui/use-dialog-focus-restore'
import { useModal } from '@/lib/ModalContext'
import { selectCodec } from '@/lib/recording/codecs'
import {
  useRecordingActions,
  useRecordingSession,
} from '@/lib/recording/RecordingSessionContext'
import { useMicTest } from '@/lib/hooks/useMicTest'
import { MAX_FILE_SIZE_BYTES } from '@/infra/supabase/storage'
import { useCaptureForm } from './useCaptureForm'
import UploadAudioPanel from './UploadAudioPanel'
import RecordAudioPanel from './RecordAudioPanel'
import CaptureFooter from './CaptureFooter'

type CaptureTab = 'upload' | 'record'

const CODEC_UNSUPPORTED_TOOLTIP = "Audio recording isn't supported in this browser."
const RECORDING_ACTIVE_TOOLTIP =
  'A recording is already in progress. Return to it before starting another.'

function getRecordDisabledTooltip(input: {
  codecSupported: boolean | null
  recordingActive: boolean
  requesting: boolean
  startingRecording: boolean
}): string | undefined {
  if (input.codecSupported === false) return CODEC_UNSUPPORTED_TOOLTIP
  if (input.recordingActive) return RECORDING_ACTIVE_TOOLTIP
  if (input.requesting) return 'Requesting microphone…'
  if (input.startingRecording) return 'Starting…'
  return undefined
}

export default function CaptureModal() {
  const router = useRouter()
  const { isCaptureModalOpen, captureModalIntent, closeCaptureModal } = useModal()
  const recordingActions = useRecordingActions()
  const recordingSnapshot = useRecordingSession()
  const recordingActive =
    recordingSnapshot.state === 'recording' ||
    recordingSnapshot.state === 'paused' ||
    recordingSnapshot.state === 'finalizing' ||
    recordingSnapshot.state === 'uploading'
  const micTest = useMicTest()
  const { captureFocus, restoreFocus } = useDialogFocusRestore()
  const wasOpenRef = useRef(false)
  const restoreOnExternalCloseRef = useRef(true)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<CaptureTab>('upload')
  const [codecSupported, setCodecSupported] = useState<boolean | null>(null)
  const [recordSubmitError, setRecordSubmitError] = useState<string | null>(null)
  const [startingRecording, setStartingRecording] = useState(false)

  useEffect(() => {
    setCodecSupported(selectCodec() != null)
  }, [])

  useEffect(() => {
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = 0
    }
  }, [activeTab])

  useLayoutEffect(() => {
    if (isCaptureModalOpen && !wasOpenRef.current) {
      restoreOnExternalCloseRef.current = true
      if (captureModalIntent?.initialTab) {
        setActiveTab(captureModalIntent.initialTab)
      }
      captureFocus()
    }
  }, [captureModalIntent, isCaptureModalOpen, captureFocus])

  useEffect(() => {
    if (!isCaptureModalOpen && wasOpenRef.current && restoreOnExternalCloseRef.current) {
      restoreFocus()
    }

    wasOpenRef.current = isCaptureModalOpen
  }, [isCaptureModalOpen, restoreFocus])

  // Release the mic stream when the modal closes without starting a recording.
  useEffect(() => {
    if (!isCaptureModalOpen) {
      micTest.release()
      setRecordSubmitError(null)
      setStartingRecording(false)
    }
    // micTest.release identity is stable enough — release() reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCaptureModalOpen])

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

  const isRecordTab = activeTab === 'record' && !isUploading

  const handleStartRecording = async () => {
    setRecordSubmitError(null)
    if (codecSupported === false) {
      setRecordSubmitError(CODEC_UNSUPPORTED_TOOLTIP)
      return
    }
    if (recordingActive) {
      setRecordSubmitError(RECORDING_ACTIVE_TOOLTIP)
      return
    }
    setStartingRecording(true)

    try {
      let stream = micTest.stream
      let deviceId = micTest.selectedDeviceId

      if (!stream) {
        const requestResult = await micTest.request()
        if (!requestResult.ok) {
          setRecordSubmitError(requestResult.error.message)
          return
        }
        const acquired = requestResult.acquired
        stream = acquired.stream
        deviceId = acquired.deviceId
      }

      const codec = selectCodec()
      if (!codec) {
        setRecordSubmitError(CODEC_UNSUPPORTED_TOOLTIP)
        return
      }

      // Attach BEFORE transferring ownership: if MediaRecorder construction
      // or start throws, micTest still owns the stream and its normal
      // release() (on modal close) will stop the tracks. Transferring up
      // front would leave the stream live with no controller after a failure.
      try {
        recordingActions.attachAndStart({
          stream,
          codec,
          title: title.trim() ? title.trim() : null,
          keyTerms,
          deviceId: deviceId ?? null,
          maxBytes: MAX_FILE_SIZE_BYTES,
        })
      } catch (err) {
        // attachAndStart only owns the stream after it succeeds. Any failure
        // here leaves micTest as the owner, so release immediately to avoid a
        // live microphone while the modal remains open.
        micTest.release()
        setRecordSubmitError(
          (err as Error)?.message ?? 'Failed to start recording. Try again.'
        )
        return
      }

      // Attach succeeded — the controller now owns the stream. Flip the
      // ownership flag so closing the modal doesn't stop the live tracks.
      micTest.transferStream()
      handleClose()
      router.push('/recording/new')
    } finally {
      setStartingRecording(false)
    }
  }

  const recordCanSubmit =
    codecSupported === true &&
    !isUploading &&
    !startingRecording &&
    !micTest.requesting &&
    !recordingActive
  const recordDisabledTooltip = getRecordDisabledTooltip({
    codecSupported,
    recordingActive,
    requesting: micTest.requesting,
    startingRecording,
  })

  const footerButtonText = isRecordTab
    ? (startingRecording ? 'Starting…' : 'Start Recording')
    : buttonText
  const footerCanSubmit = isRecordTab ? recordCanSubmit : canSubmit
  const footerDisabledTooltip = isRecordTab ? recordDisabledTooltip : undefined
  const footerOnSubmit = isRecordTab ? handleStartRecording : handleSubmit

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
        className="top-[7vh] flex max-h-[86vh] w-[500px] flex-col overflow-hidden p-0 text-ink dark:text-paper"
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

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as CaptureTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="relative pt-3">
            <TabsList className="gap-0">
              <TabsTrigger
                value="upload"
                disabled={isUploading}
                className="flex-1 justify-center data-[state=active]:border-transparent dark:data-[state=active]:border-transparent"
              >
                Upload Audio
              </TabsTrigger>
              <TabsTrigger
                value="record"
                disabled={isUploading}
                className="flex-1 justify-center data-[state=active]:border-transparent dark:data-[state=active]:border-transparent"
              >
                Record Audio
              </TabsTrigger>
            </TabsList>
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute bottom-0 left-0 h-0.5 w-1/2 bg-ink transition-transform duration-200 ease-out motion-reduce:transition-none dark:bg-paper ${activeTab === 'record' ? 'translate-x-full' : 'translate-x-0'}`}
            />
          </div>

          <div ref={bodyScrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-6">
            {captureModalIntent?.message && (
              <div
                role="status"
                aria-live="polite"
                className="mb-4 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
              >
                {captureModalIntent.message}
              </div>
            )}
            {recordSubmitError && activeTab === 'record' && (
              <div
                role="alert"
                className="mb-4 rounded-sm border border-ember-red/40 bg-ember-red/10 px-3 py-2 text-sm text-ink dark:text-paper"
              >
                {recordSubmitError}
              </div>
            )}
            {!recordSubmitError && recordingActive && activeTab === 'record' && (
              <div
                role="status"
                aria-live="polite"
                className="mb-4 rounded-sm border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200"
              >
                {RECORDING_ACTIVE_TOOLTIP}
              </div>
            )}
            <TabsContent value="upload">
              <UploadAudioPanel
                selectedFile={selectedFile}
                handleFileSelect={handleFileSelect}
                title={title}
                setTitle={setTitle}
                keyTerms={keyTerms}
                keyTermInput={keyTermInput}
                setKeyTermInput={setKeyTermInput}
                keyTermsError={keyTermsError}
                handleKeyTermKeyDown={handleKeyTermKeyDown}
                handleAddTermClick={handleAddTermClick}
                removeTerm={removeTerm}
                isUploading={isUploading}
                displayError={displayError}
                maxFileSizeLabel={maxFileSizeLabel}
              />
            </TabsContent>
            <TabsContent value="record">
              <RecordAudioPanel
                title={title}
                setTitle={setTitle}
                keyTerms={keyTerms}
                keyTermInput={keyTermInput}
                setKeyTermInput={setKeyTermInput}
                keyTermsError={keyTermsError}
                handleKeyTermKeyDown={handleKeyTermKeyDown}
                handleAddTermClick={handleAddTermClick}
                removeTerm={removeTerm}
                isUploading={isUploading}
                micTest={micTest}
                codecSupported={codecSupported}
                recordingActive={recordingActive}
              />
            </TabsContent>
          </div>
        </Tabs>

        <CaptureFooter
          isUploading={isUploading}
          canSubmit={footerCanSubmit}
          onClose={handleClose}
          onSubmit={footerOnSubmit}
          buttonText={footerButtonText}
          disabledTooltip={footerDisabledTooltip}
        />
      </DialogContent>
    </Dialog>
  )
}
