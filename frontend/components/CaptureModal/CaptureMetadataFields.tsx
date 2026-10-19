import CaptureDetails from './CaptureDetails'
import KeyTermsInput from './KeyTermsInput'
import CaptureAdvancedOptions from './CaptureAdvancedOptions'
import type { TranscriptionOptions } from '@/contracts/transcription-options'

interface CaptureMetadataFieldsProps {
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
  disabled: boolean
}

export default function CaptureMetadataFields({
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
  disabled,
}: CaptureMetadataFieldsProps) {
  return (
    <>
      <CaptureDetails
        projectId={projectId}
        onProjectChange={onProjectChange}
        title={title}
        setTitle={setTitle}
        titleError={titleError}
        disabled={disabled}
      />
      <KeyTermsInput
        keyTerms={keyTerms}
        keyTermInput={keyTermInput}
        setKeyTermInput={setKeyTermInput}
        keyTermsError={keyTermsError}
        disabled={disabled}
        onKeyDown={handleKeyTermKeyDown}
        onAddClick={handleAddTermClick}
        onRemoveTerm={removeTerm}
      />
      <CaptureAdvancedOptions
        options={transcriptionOptions}
        onOptionsChange={onTranscriptionOptionsChange}
        disabled={disabled}
      />
    </>
  )
}
