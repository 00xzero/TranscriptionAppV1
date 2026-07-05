"use client"

import { useState } from 'react'
import {
  useRecordingActions,
  useRecordingSession,
} from '@/lib/recording/RecordingSessionContext'
import KeyTermsInput from '@/components/CaptureModal/KeyTermsInput'
import { useKeyTermsField } from '@/components/CaptureModal/useKeyTermsField'

const KEY_TERMS_PANEL_ID = 'recording-key-terms-panel'
const KEY_TERMS_INPUT_ID = 'recording-key-terms-input'

export default function RecordingKeyTerms() {
  const snapshot = useRecordingSession()
  const actions = useRecordingActions()
  const [expanded, setExpanded] = useState(false)

  const {
    keyTermInput,
    setKeyTermInput,
    keyTermsError,
    handleKeyTermKeyDown,
    handleAddTermClick,
    removeTerm,
  } = useKeyTermsField({
    keyTerms: snapshot.keyTerms,
    onKeyTermsChange: actions.updateSessionKeyTerms,
  })

  // Only editable while capture is live; the parent already hides this once the
  // recording is in flight, but guard here too.
  const editable = snapshot.state === 'recording' || snapshot.state === 'paused'
  if (!editable) return null

  const count = snapshot.keyTerms.length

  return (
    <div data-testid="recording-key-terms">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={KEY_TERMS_PANEL_ID}
        data-testid="recording-key-terms-toggle"
        className="inline-flex items-center gap-2 text-sm text-ink/60 transition-colors hover:text-ink dark:text-paper/60 dark:hover:text-paper"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
          className={`transition-transform ${expanded ? 'rotate-45' : ''}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        <span>Add key terms{count > 0 ? ` (${count})` : ''}</span>
      </button>

      {expanded && (
        <div id={KEY_TERMS_PANEL_ID}>
          <KeyTermsInput
            keyTerms={snapshot.keyTerms}
            keyTermInput={keyTermInput}
            setKeyTermInput={setKeyTermInput}
            keyTermsError={keyTermsError}
            isUploading={false}
            onKeyDown={handleKeyTermKeyDown}
            onAddClick={handleAddTermClick}
            onRemoveTerm={removeTerm}
            inputId={KEY_TERMS_INPUT_ID}
          />
        </div>
      )}
    </div>
  )
}
