import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MAX_KEY_TERMS } from './shared'

const DEFAULT_KEY_TERMS_INPUT_ID = 'capture-key-terms-input'

interface KeyTermsInputProps {
  keyTerms: string[]
  keyTermInput: string
  setKeyTermInput: (value: string) => void
  keyTermsError: string | null
  isUploading: boolean
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onAddClick: () => void
  onRemoveTerm: (index: number) => void
  inputId?: string
}

export default function KeyTermsInput({
  keyTerms,
  keyTermInput,
  setKeyTermInput,
  keyTermsError,
  isUploading,
  onKeyDown,
  onAddClick,
  onRemoveTerm,
  inputId = DEFAULT_KEY_TERMS_INPUT_ID,
}: KeyTermsInputProps) {
  const keyTermsInputId = inputId
  return (
    <div className="space-y-3 pt-2 border-t border-(--border)">
      <Label className="block text-[10px] font-mono uppercase tracking-wider opacity-60 mt-4" htmlFor={keyTermsInputId}>Key Terms (Optional)</Label>

      <div className="flex gap-2">
        <Input
          id={keyTermsInputId}
          type="text"
          value={keyTermInput}
          onChange={(e) => setKeyTermInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="e.g., PAS-X, Helsingborg, Move-X"
          disabled={isUploading || keyTerms.length >= MAX_KEY_TERMS}
          aria-label="Add key terms for transcription"
          className="flex-1"
        />
        <Button
          variant="secondary"
          size="icon"
          onClick={onAddClick}
          disabled={isUploading || !keyTermInput.trim() || keyTerms.length >= MAX_KEY_TERMS}
          aria-label="Add key term"
          title="Add key term"
          className="h-auto w-auto px-3"
        >
          <svg className="w-4 h-4 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </Button>
      </div>

      <div className="flex justify-between items-center">
        <p className="text-[10px] text-foreground/40">Add up to 100 terms. Separate with commas.</p>
        <p className="text-[10px] font-mono opacity-40">{keyTerms.length} / {MAX_KEY_TERMS} terms</p>
      </div>

      {keyTermsError && (
        <p className="text-xs text-ember-red">{keyTermsError}</p>
      )}

      {keyTerms.length > 0 && (
        <div className="scrollbar-thin flex flex-wrap gap-2 max-h-24 overflow-y-auto">
          {keyTerms.map((term, index) => (
            <span
              key={`${term}-${index}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-sm text-xs bg-trust-blue/10 text-trust-blue border border-trust-blue/20"
            >
              <span className="max-w-[150px] truncate">{term}</span>
              <button
                onClick={() => onRemoveTerm(index)}
                aria-label={`Remove term ${index + 1}: ${term}`}
                title={`Remove term ${term}`}
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
  )
}
