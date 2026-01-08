"use client"
import { useState, useCallback } from 'react'
import { KeyTermsInput, validateKeyTerms } from './KeyTermsInput'
import { getApiBase, getAuthHeaders } from '../lib/api'

type EditKeyTermsModalProps = {
    projectId: string
    currentTerms: string[]
    isOpen: boolean
    onClose: () => void
    onSaved: (newTerms: string[]) => void
    onRetry: () => Promise<void>  // Callback to trigger transcription retry
}

/**
 * Modal for editing key terms on an existing project.
 * Used for retry scenarios when initial key terms caused transcription failure.
 * After saving, automatically triggers transcription retry.
 */
export function EditKeyTermsModal({
    projectId,
    currentTerms,
    isOpen,
    onClose,
    onSaved,
    onRetry,
}: EditKeyTermsModalProps) {
    const [terms, setTerms] = useState<string[]>(currentTerms)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [status, setStatus] = useState<'editing' | 'saving' | 'retrying'>('editing')

    const handleTermsChange = useCallback((newTerms: string[]) => {
        setTerms(newTerms)
        setError(validateKeyTerms(newTerms))
    }, [])

    const handleSaveAndRetry = useCallback(async () => {
        const validationError = validateKeyTerms(terms)
        if (validationError) {
            setError(validationError)
            return
        }

        setSaving(true)
        setStatus('saving')
        setError(null)

        try {
            // Step 1: Update key terms
            const response = await fetch(`${getApiBase()}/projects/${projectId}/key-terms`, {
                method: 'PATCH',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ key_terms: terms }),
            })

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.detail || `Failed to update key terms: ${response.status}`)
            }

            const result = await response.json()
            onSaved(result.key_terms || [])

            // Step 2: Trigger transcription retry
            setStatus('retrying')
            await onRetry()

            onClose()
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
            setStatus('editing')
        } finally {
            setSaving(false)
        }
    }, [projectId, terms, onSaved, onRetry, onClose])

    if (!isOpen) return null

    const buttonLabel = status === 'saving' ? 'Saving...' : status === 'retrying' ? 'Starting transcription...' : 'Save & Retry'

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-surface border border-base rounded-lg shadow-xl w-full max-w-lg mx-4 p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold">Edit Key Terms</h2>
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className="text-muted hover:text-foreground text-xl leading-none"
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>

                <p className="text-sm text-muted mb-4">
                    Update your key terms to improve transcription accuracy.
                    Use proper capitalization for names and brands.
                </p>

                <KeyTermsInput
                    value={terms}
                    onChange={handleTermsChange}
                    disabled={saving}
                    error={error}
                />

                <div className="flex justify-end gap-3 mt-6">
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className="px-4 py-2 rounded border border-base text-foreground hover:bg-surface disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSaveAndRetry}
                        disabled={saving || !!error}
                        className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {buttonLabel}
                    </button>
                </div>
            </div>
        </div>
    )
}

