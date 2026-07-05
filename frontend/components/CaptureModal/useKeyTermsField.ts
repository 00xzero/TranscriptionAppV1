import { useCallback, useState } from 'react'
import { MAX_KEY_TERMS } from './shared'

interface UseKeyTermsFieldParams {
  /** The current committed list of key terms (controlled by the caller). */
  keyTerms: string[]
  /** Called with the next list whenever terms are added or removed. */
  onKeyTermsChange: (keyTerms: string[]) => void
}

/**
 * Transient input + validation state for a key-terms editor. Owns the text box,
 * comma/enter parsing, case-insensitive dedup against the committed list, and the
 * MAX_KEY_TERMS cap — but not the committed list itself, which the caller holds
 * (local state in the capture modal, the session store on the recording page).
 */
export function useKeyTermsField({ keyTerms, onKeyTermsChange }: UseKeyTermsFieldParams) {
  const [keyTermInput, setKeyTermInput] = useState('')
  const [keyTermsError, setKeyTermsError] = useState<string | null>(null)

  const parseAndAddTerms = useCallback((input: string) => {
    const newTerms = input
      .split(/[,\n\t]+/)
      .map(t => t.trim().replace(/\s+/g, ' '))
      .filter(t => t.length > 0)

    if (newTerms.length === 0) return

    const seen = new Map<string, string>()
    for (const t of keyTerms) {
      seen.set(t.toLowerCase(), t)
    }
    let uniqueIncomingCount = 0
    for (const t of newTerms) {
      if (!seen.has(t.toLowerCase())) {
        seen.set(t.toLowerCase(), t)
        uniqueIncomingCount += 1
      }
    }

    const allTerms = Array.from(seen.values())
    if (allTerms.length <= MAX_KEY_TERMS) {
      onKeyTermsChange(allTerms)
      setKeyTermsError(null)
      return
    }

    setKeyTermsError(
      `Could not add ${uniqueIncomingCount} term${uniqueIncomingCount === 1 ? '' : 's'} because that would exceed the ${MAX_KEY_TERMS}-term limit.`
    )
  }, [keyTerms, onKeyTermsChange])

  const handleKeyTermKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      parseAndAddTerms(keyTermInput)
      setKeyTermInput('')
    }
  }, [keyTermInput, parseAndAddTerms])

  const handleAddTermClick = useCallback(() => {
    parseAndAddTerms(keyTermInput)
    setKeyTermInput('')
  }, [keyTermInput, parseAndAddTerms])

  const removeTerm = useCallback((index: number) => {
    onKeyTermsChange(keyTerms.filter((_, i) => i !== index))
    setKeyTermsError(null)
  }, [keyTerms, onKeyTermsChange])

  return {
    keyTermInput,
    setKeyTermInput,
    keyTermsError,
    setKeyTermsError,
    handleKeyTermKeyDown,
    handleAddTermClick,
    removeTerm,
  }
}
