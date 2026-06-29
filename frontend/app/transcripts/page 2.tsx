"use client"
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { Suspense, useState, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranscriptsRealtime } from '@/lib/supabase/hooks'
import { fetchJobError } from '@/lib/supabase/queries'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useModal } from '@/lib/ModalContext'

export default function TranscriptsPage() {
  return (
    <Suspense fallback={<div className="text-muted">Loading...</div>}>
      <TranscriptsPageContent />
    </Suspense>
  )
}

function TranscriptsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { openCaptureModal } = useModal()
  const { transcripts, isLoading, connectionStatus, deleteTranscript: deleteTranscriptAction, refetch } = useTranscriptsRealtime()
  const [starting, setStarting] = useState<Record<string, boolean>>({})
  // Cache idempotency keys per transcript - reused until request completes to prevent double-click issues
  const [idempotencyKeys, setIdempotencyKeys] = useState<Record<string, string>>({})
  const [transcriptErrors, setTranscriptErrors] = useState<Record<string, { error: string; error_type: string }>>({})
  const [transcriptErrorLoadErrors, setTranscriptErrorLoadErrors] = useState<Record<string, string>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [captureOutcome, setCaptureOutcome] = useState<string | null>(null)
  const [captureTranscriptId, setCaptureTranscriptId] = useState<string | null>(null)

  useEffect(() => {
    setCaptureOutcome(searchParams.get('capture'))
    setCaptureTranscriptId(searchParams.get('transcriptId'))
  }, [searchParams])

  useEffect(() => {
    if (searchParams.get('capture') !== 'recording_session_not_found') return

    openCaptureModal({
      initialTab: 'record',
      message: 'Recording session not found. Please start a new recording.',
    })

    const params = new URLSearchParams(searchParams.toString())
    params.delete('capture')
    const nextQuery = params.toString()
    router.replace(nextQuery ? `/transcripts?${nextQuery}` : '/transcripts')
  }, [openCaptureModal, router, searchParams])

  const captureMessage = captureOutcome === 'saved_needs_retry'
    ? searchParams.get('captureMessage') ??
      'Upload completed and transcript was saved, but transcription did not start automatically. Click Transcribe to retry.'
    : captureOutcome === 'saved_status_unknown'
      ? searchParams.get('captureMessage') ??
        'Upload completed and transcript was saved, but transcription status is unknown due to a network interruption. Check the transcript status before retrying.'
      : null

  const dismissCaptureMessage = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('capture')
    params.delete('transcriptId')
    params.delete('captureMessage')
    const nextQuery = params.toString()
    setCaptureOutcome(null)
    setCaptureTranscriptId(null)
    router.replace(nextQuery ? `/transcripts?${nextQuery}` : '/transcripts')
  }, [router, searchParams])

  // Fetch error info for transcripts in error state
  const fetchTranscriptErrorInfo = useCallback(async (transcriptId: string) => {
    try {
      setTranscriptErrorLoadErrors(prev => {
        const next = { ...prev }
        delete next[transcriptId]
        return next
      })
      const errorInfo = await fetchJobError(transcriptId)
      if (errorInfo) {
        setTranscriptErrors(prev => ({
          ...prev,
          [transcriptId]: errorInfo
        }))
      }
    } catch (e) {
      console.error('Failed to fetch transcript error:', e)
      setTranscriptErrorLoadErrors(prev => ({
        ...prev,
        [transcriptId]: 'Failed to load error details. Please retry.'
      }))
    }
  }, [])

  // Fetch errors for transcripts in error state on initial load
  useEffect(() => {
    transcripts.forEach(p => {
      if (p.status === 'error' && !transcriptErrors[p.id]) {
        fetchTranscriptErrorInfo(p.id)
      }
    })
  }, [transcripts, transcriptErrors, fetchTranscriptErrorInfo])

  useEffect(() => {
    if (Object.keys(idempotencyKeys).length === 0) return

    const inProgressIds = new Set(
      transcripts
        .filter(p => p.status === 'queued' || p.status === 'processing' || p.status === 'error')
        .map(p => p.id)
    )

    if (inProgressIds.size === 0) return

    setIdempotencyKeys(prev => {
      let changed = false
      const next = { ...prev }

      Object.keys(prev).forEach(id => {
        if (inProgressIds.has(id)) {
          delete next[id]
          changed = true
        }
      })

      return changed ? next : prev
    })
  }, [transcripts, idempotencyKeys])

  const startTranscript = useCallback(async (id: string) => {
    if (starting[id]) return
    setStarting((prev) => ({ ...prev, [id]: true }))

    // Get or generate idempotency key - cached to prevent double-click from creating new keys
    let idempotencyKey = idempotencyKeys[id]
    if (!idempotencyKey) {
      idempotencyKey = `${id}-${Date.now()}-${crypto.randomUUID()}`
      setIdempotencyKeys((prev) => ({ ...prev, [id]: idempotencyKey }))
    }

    try {
      // Use existing Next.js API route for starting transcription
      const res = await fetch(`/api/transcripts/${id}/start`, {
        method: 'POST',
        headers: {
          'x-idempotency-key': idempotencyKey,
        },
      })
      if (!res.ok) {
        const text = await res.text()
        let parsed: { error?: string; status?: string } | null = null
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = null
        }

        if (res.status === 409 && parsed?.status === 'error') {
          setIdempotencyKeys((prev) => {
            const next = { ...prev }
            delete next[id]
            return next
          })
        }

        throw new Error(`Failed to start transcript: ${parsed?.error || text}`)
      }
      setActionError(null)
      setTranscriptErrorLoadErrors(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      // Clear any previous error
      setTranscriptErrors(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      // Refetch transcripts to get updated status
      refetch()
      // Clear cached idempotency key only after confirmed success
      setIdempotencyKeys((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } catch (e) {
      console.error(e)
      setActionError(String(e))
    } finally {
      setStarting((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }, [starting, idempotencyKeys, refetch])

  const handleDeleteTranscript = async (id: string) => {
    const ok = window.confirm(
      'Disclaimer: Deleting a transcript will permanently remove the transcript and all associated data (segments, speakers, and jobs). This action cannot be undone. Do you want to proceed?'
    )
    if (!ok) return
    try {
      await deleteTranscriptAction(id)
      setActionError(null)
    } catch (e) {
      console.error(e)
      setActionError(String(e))
    }
  }

  const getErrorInfo = (transcriptId: string) => transcriptErrors[transcriptId]

  // Connection status indicator
  const statusColor = connectionStatus === 'connected' ? 'bg-green-500' :
    connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'

  return (
    <div className="space-y-4 pt-[80px] px-6 md:px-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Transcripts</h1>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className={`w-2 h-2 rounded-full ${statusColor}`}></span>
          <span>{connectionStatus === 'connected' ? 'Live' : connectionStatus}</span>
        </div>
      </div>
      {actionError && (
        <div className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <div className="flex items-center justify-between gap-3">
            <span>{actionError}</span>
            <button
              className="text-xs font-medium text-red-700 hover:underline"
              onClick={() => setActionError(null)}
              title="Dismiss"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {captureMessage && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          <div className="flex items-center justify-between gap-3">
            <span>
              {captureMessage}
              {captureTranscriptId ? ` Transcript ID: ${captureTranscriptId}.` : ''}
            </span>
            <button
              className="text-xs font-medium text-amber-800 hover:underline"
              onClick={dismissCaptureMessage}
              title="Dismiss"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {isLoading && <div className="text-muted">Loading...</div>}
      {!isLoading && transcripts.length === 0 && <div className="text-muted">No transcripts yet.</div>}
      <ul className="space-y-2">
        {transcripts.map((p) => {
          const errorInfo = p.status === 'error' ? getErrorInfo(p.id) : null
          const errorLoadError = transcriptErrorLoadErrors[p.id]
          const isKeytermError = errorInfo?.error_type === 'keyterm_error'

          return (
            <li key={p.id} className="bg-surface border border-base rounded-sm p-3">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-medium">{p.title || p.id}</div>
                  <div className="text-xs text-muted">{p.status} • {new Date(p.created_at).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-3">
                  {(() => {
                    const isCompleted = p.status === 'completed'
                    const isTranscribing = !!starting[p.id] || ['queued', 'processing'].includes(p.status)
                    const canTranscribe = !isCompleted && !isTranscribing && ['created', 'error'].includes(p.status)
                    const label = isCompleted ? 'Transcribed' : isTranscribing ? 'Transcribing...' : 'Transcribe'
                    const className = isCompleted
                      ? 'px-3 py-1.5 rounded-sm bg-blue-600 text-white disabled:opacity-50'
                      : 'px-3 py-1.5 rounded-sm bg-emerald-600 text-white disabled:opacity-50'
                    return (
                      <button
                        className={className}
                        onClick={() => startTranscript(p.id)}
                        disabled={!canTranscribe}
                        title={label}
                      >
                        {label}
                      </button>
                    )
                  })()}
                  <Link href={`/editor/${p.id}`} title={`Open ${p.title || p.id}`} className="accent hover:underline">Open</Link>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="p-2 rounded-sm bg-red-600 text-white hover:bg-red-700"
                        onClick={() => handleDeleteTranscript(p.id)}
                        aria-label={`Delete transcript ${p.title || p.id}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                          <path fillRule="evenodd" d="M9 3.75A2.25 2.25 0 0 1 11.25 1.5h1.5A2.25 2.25 0 0 1 15 3.75V4.5h3.75a.75.75 0 0 1 0 1.5h-.6l-1.095 13.14A3 3 0 0 1 14.07 22.5H9.93a3 3 0 0 1-2.985-3.36L5.85 6H5.25a.75.75 0 0 1 0-1.5H9V3.75Zm1.5.75h3V3.75a.75.75 0 0 0-.75-.75h-1.5a.75.75 0 0 0-.75.75V4.5Zm-2.91 1.5h8.82l-1.08 12.96a1.5 1.5 0 0 1-1.485 1.29H9.93a1.5 1.5 0 0 1-1.485-1.29L7.59 6Z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Delete transcript</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {/* Error display */}
              {(errorInfo || errorLoadError) && (
                <div className="mt-3 p-3 rounded-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <div className="flex items-start gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5">
                      <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                    </svg>
                    <div className="flex-1">
                      {errorInfo ? (
                        <p className="text-sm text-red-700 dark:text-red-300">{errorInfo.error}</p>
                      ) : (
                        <p className="text-sm text-red-700 dark:text-red-300">{errorLoadError}</p>
                      )}
                      {!errorInfo && (
                        <button
                          onClick={() => fetchTranscriptErrorInfo(p.id)}
                          className="mt-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                          title="Retry loading error details"
                        >
                          Retry loading error details
                        </button>
                      )}
                      {isKeytermError && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          Try adjusting key terms and re-uploading.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

    </div>
  )
}
