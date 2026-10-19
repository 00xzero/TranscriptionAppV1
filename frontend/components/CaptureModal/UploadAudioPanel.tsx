import FileDropZone from './FileDropZone'
import CaptureMetadataFields from './CaptureMetadataFields'
import type { TranscriptionOptions } from '@/contracts/transcription-options'

interface UploadAudioPanelProps {
  selectedFile: File | null
  handleFileSelect: (file: File) => void
  clearFile: () => void
  projectId: string | null
  onProjectChange: (projectId: string | null) => void
  title: string
  setTitle: (value: string) => void
  titleError: string | null
  keyTerms: string[]
  keyTermInput: string
  setKeyTermInput: (value: string) => void
  keyTermsError: string | null
  handleKeyTermKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleAddTermClick: () => void
  removeTerm: (index: number) => void
  transcriptionOptions: TranscriptionOptions
  onTranscriptionOptionsChange: (options: TranscriptionOptions) => void
  isUploading: boolean
  /** Locks the transcript details while an upload or recording start is in progress. */
  fieldsDisabled: boolean
  displayError: string | null
  maxFileSizeLabel: string
}

export default function UploadAudioPanel({
  selectedFile,
  handleFileSelect,
  clearFile,
  projectId,
  onProjectChange,
  title,
  setTitle,
  titleError,
  keyTerms,
  keyTermInput,
  setKeyTermInput,
  keyTermsError,
  handleKeyTermKeyDown,
  handleAddTermClick,
  removeTerm,
  transcriptionOptions,
  onTranscriptionOptionsChange,
  isUploading,
  fieldsDisabled,
  displayError,
  maxFileSizeLabel,
}: UploadAudioPanelProps) {
  return (
    <div className="space-y-6">
      <FileDropZone
        selectedFile={selectedFile}
        onFileSelect={handleFileSelect}
        onClearFile={clearFile}
        isUploading={isUploading}
        displayError={displayError}
        maxFileSizeLabel={maxFileSizeLabel}
      />
      <CaptureMetadataFields
        projectId={projectId}
        onProjectChange={onProjectChange}
        title={title}
        setTitle={setTitle}
        titleError={titleError}
        keyTerms={keyTerms}
        keyTermInput={keyTermInput}
        setKeyTermInput={setKeyTermInput}
        keyTermsError={keyTermsError}
        handleKeyTermKeyDown={handleKeyTermKeyDown}
        handleAddTermClick={handleAddTermClick}
        removeTerm={removeTerm}
        transcriptionOptions={transcriptionOptions}
        onTranscriptionOptionsChange={onTranscriptionOptionsChange}
        disabled={fieldsDisabled}
      />
    </div>
  )
}
