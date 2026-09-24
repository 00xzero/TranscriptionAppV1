import CaptureDetails from './CaptureDetails'
import KeyTermsInput from './KeyTermsInput'

interface CaptureMetadataFieldsProps {
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
  isUploading: boolean
}

export default function CaptureMetadataFields({
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
  isUploading,
}: CaptureMetadataFieldsProps) {
  return (
    <>
      <CaptureDetails
        title={title}
        setTitle={setTitle}
        titleError={titleError}
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
    </>
  )
}
