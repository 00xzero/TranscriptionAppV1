"use client"
import { useState, useCallback, KeyboardEvent } from 'react'

const MAX_KEY_TERMS = 100
const MAX_KEY_TERM_LENGTH = 64

type KeyTermsInputProps = {
    value: string[]
    onChange: (terms: string[]) => void
    disabled?: boolean
    error?: string | null
}

/**
 * Input component for key terms with chips display.
 * Parses comma-separated input, deduplicates case-insensitively,
 * and displays terms as removable chips.
 */
export function KeyTermsInput({ value, onChange, disabled = false, error }: KeyTermsInputProps) {
    const [inputValue, setInputValue] = useState('')

    /**
     * Parse input string into terms array.
     * - Normalize newlines/tabs to spaces (preserves multi-word phrases)
     * - Split by comma
     * - Trim whitespace
     * - Drop empty terms
     * - Deduplicate case-insensitively (keep first-seen casing)
     */
    const parseTerms = useCallback((input: string): string[] => {
        const seen = new Map<string, string>()

        // Normalize: convert newlines/tabs to spaces, collapse multiple spaces
        const normalized = input
            .replace(/[\n\r]+/g, ' ')
            .replace(/\t+/g, ' ')
            .replace(/\s+/g, ' ')

        normalized.split(',').forEach(part => {
            const trimmed = part.trim()
            if (!trimmed) return

            const canonical = trimmed.toLowerCase()
            if (!seen.has(canonical)) {
                seen.set(canonical, trimmed)
            }
        })

        return Array.from(seen.values())
    }, [])

    /**
     * Merge new terms with existing, maintaining deduplication.
     */
    const addTerms = useCallback((newTerms: string[]) => {
        const seen = new Map<string, string>()

        // Add existing terms first
        value.forEach(term => {
            const canonical = term.toLowerCase()
            if (!seen.has(canonical)) {
                seen.set(canonical, term)
            }
        })

        // Add new terms
        newTerms.forEach(term => {
            const canonical = term.toLowerCase()
            if (!seen.has(canonical)) {
                seen.set(canonical, term)
            }
        })

        onChange(Array.from(seen.values()))
    }, [value, onChange])

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value)
    }, [])

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            const terms = parseTerms(inputValue)
            if (terms.length > 0) {
                addTerms(terms)
                setInputValue('')
            }
        }
    }, [inputValue, parseTerms, addTerms])

    const handleBlur = useCallback(() => {
        const terms = parseTerms(inputValue)
        if (terms.length > 0) {
            addTerms(terms)
            setInputValue('')
        }
    }, [inputValue, parseTerms, addTerms])

    const removeTerm = useCallback((indexToRemove: number) => {
        onChange(value.filter((_, index) => index !== indexToRemove))
    }, [value, onChange])

    const hasLimitError = value.length > MAX_KEY_TERMS
    const termLengthError = value.find(t => t.length > MAX_KEY_TERM_LENGTH)

    return (
        <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">
                Key terms (optional)
            </label>

            <input
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                disabled={disabled}
                placeholder="e.g., PAS-X, Helsingborg, Move-X"
                className="w-full px-3 py-2 border border-base rounded bg-surface text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />

            <p className="text-xs text-muted">
                Add up to {MAX_KEY_TERMS} terms. Separate with commas.
            </p>

            {/* Chips display */}
            {value.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2 max-h-32 overflow-y-auto pr-1">
                    {value.map((term, index) => {
                        const isTooLong = term.length > MAX_KEY_TERM_LENGTH
                        return (
                            <span
                                key={`${term}-${index}`}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm ${isTooLong
                                    ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border border-red-300'
                                    : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                                    }`}
                            >
                                <span className="max-w-[200px] truncate" title={term}>
                                    {term}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => removeTerm(index)}
                                    disabled={disabled}
                                    className="ml-1 hover:text-red-600 focus:outline-none disabled:opacity-50"
                                    aria-label={`Remove ${term}`}
                                >
                                    ×
                                </button>
                            </span>
                        )
                    })}
                </div>
            )}

            {/* Validation errors */}
            {hasLimitError && (
                <p className="text-sm text-red-600 dark:text-red-400">
                    Too many terms: {value.length} exceeds limit of {MAX_KEY_TERMS}
                </p>
            )}
            {termLengthError && !hasLimitError && (
                <p className="text-sm text-red-600 dark:text-red-400">
                    Term too long: "{termLengthError.slice(0, 20)}..." exceeds {MAX_KEY_TERM_LENGTH} characters
                </p>
            )}
            {error && !hasLimitError && !termLengthError && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
        </div>
    )
}

/**
 * Validate key terms before submission.
 * Returns null if valid, or an error message string.
 */
export function validateKeyTerms(terms: string[]): string | null {
    if (terms.length > MAX_KEY_TERMS) {
        return `Too many key terms: ${terms.length} exceeds limit of ${MAX_KEY_TERMS}`
    }

    const longTerm = terms.find(t => t.length > MAX_KEY_TERM_LENGTH)
    if (longTerm) {
        return `Key term too long: "${longTerm.slice(0, 20)}..." exceeds ${MAX_KEY_TERM_LENGTH} characters`
    }

    return null
}
