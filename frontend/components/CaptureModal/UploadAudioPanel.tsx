import FileDropZone from './FileDropZone'
import CaptureDetails from './CaptureDetails'
import KeyTermsInput from './KeyTermsInput'

interface UploadAudioPanelProps {
  selectedFile: File | null
  handleFileSelect: (file: File) => void
  title: string
  setTitle: (value: string) => void
  keyTerms: string[]
  keyTermInput: string
  setKeyTermInput: (value: string) => void
  keyTermsError: string | null
  handleKeyTermKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleAddTermClick: () => void
  removeTerm: (index: number) => void
  isUploading: boolean
  displayError: string | null
  maxFileSizeLabel: string
}

export default function UploadAudioPanel({
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
  displayError,
  maxFileSizeLabel,
}: UploadAudioPanelProps) {
  return (
    <div className="space-y-6">
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
  )
}
