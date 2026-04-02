import { Label } from '@/components/ui/label'
import { MAX_KEY_TERMS } from './shared'

const keyTermsInputId = 'capture-key-terms-input'

interface KeyTermsInputProps {
  keyTerms: string[]
  keyTermInput: string
  setKeyTermInput: (value: string) => void
  keyTermsError: string | null
  isUploading: boolean
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onAddClick: () => void
  onRemoveTerm: (index: number) => void
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
}: KeyTermsInputProps) {
  return (
    <div className="space-y-3 pt-2 border-t border-[#D1CEC5] dark:border-white/10">
      <Label className="block text-[10px] font-mono uppercase tracking-wider opacity-60 mt-4" htmlFor={keyTermsInputId}>Key Terms (Optional)</Label>

      <div className="flex gap-2">
        <input
          id={keyTermsInputId}
          type="text"
          value={keyTermInput}
          onChange={(e) => setKeyTermInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="e.g., PAS-X, Helsingborg, Move-X"
          disabled={isUploading || keyTerms.length >= MAX_KEY_TERMS}
          aria-label="Add key terms for transcription"
          className="flex-1 bg-white/50 dark:bg-[#222]/50 border border-[#D1CEC5] dark:border-[#444] rounded-sm px-3 py-2 text-sm focus:outline-hidden focus:border-trust-blue focus:bg-white dark:focus:bg-[#222] transition-colors placeholder:text-ink/30 dark:placeholder:text-white/20 disabled:opacity-50"
        />
        <button
          onClick={onAddClick}
          disabled={isUploading || !keyTermInput.trim() || keyTerms.length >= MAX_KEY_TERMS}
          aria-label="Add key term"
          title="Add key term"
          className="px-3 border border-[#D1CEC5] dark:border-[#444] rounded-sm bg-white/50 dark:bg-[#222]/50 hover:bg-ink/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
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

      {keyTerms.length > 0 && (
        <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
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
