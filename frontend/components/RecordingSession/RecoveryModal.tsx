"use client"

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toaster'
import {
  discardRecovered,
  saveRecovered,
  type RecoverableInfo,
} from '@/lib/recording/session'

function formatApproxSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `~${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `~${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Blocking, global recovery modal. Surfaced by RecordingSessionProvider whenever
 * a recoverable orphan is found. Built on the shared Radix dialog so focus,
 * escape, and dismissal behave like ExportModal/FindReplaceModal — but made
 * non-dismissable: the recovery must be resolved via Save or Discard.
 */
export default function RecoveryModal({ info }: { info: RecoverableInfo }) {
  const [title, setTitle] = useState(info.title ?? info.generatedTitle ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(true)

  // Reset editable fields when a different orphan is surfaced (multi-orphan chain).
  useEffect(() => {
    setTitle(info.title ?? info.generatedTitle ?? '')
    setError(null)
    setSaving(false)
  }, [info.sessionId, info.title, info.generatedTitle])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const total = info.remainingCount + 1

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    const savedTitle =
      title.trim() || info.title || info.generatedTitle || 'Recording'
    const result = await saveRecovered(savedTitle)
    if (!result.ok) {
      setError(result.message ?? 'Could not save the recording.')
      setSaving(false)
      return
    }
    // On a final save the provider transitions to submitted and the route
    // redirects. When another orphan is queued the modal re-mounts with it (reset
    // effect above), so confirm the just-saved one with a toast — there is no
    // redirect to acknowledge it otherwise.
    if (result.chainedToNext) {
      toast({
        title: 'Recording saved',
        description: `“${savedTitle}” is uploading and will start transcribing.`,
      })
    }
  }

  const handleDiscard = async () => {
    setSaving(true)
    setError(null)
    try {
      await discardRecovered()
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not discard the recording.')
      setSaving(false)
    }
  }

  return (
    <Dialog open={true} onOpenChange={() => { /* blocking: resolve via Save/Discard */ }}>
      <DialogContent
        className="w-[480px] overflow-hidden p-0"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        data-testid="recovery-modal"
      >
        <div className="px-6 pt-6 pb-4">
          <DialogTitle>Recovered recording</DialogTitle>
          <p className="mt-1 text-[10px] font-mono text-ink/50 dark:text-white/50">
            We found an interrupted recording on this device.
            {info.remainingCount > 0 ? ` (1 of ${total})` : ''}
          </p>
        </div>

        <div className="space-y-4 px-6 pb-5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink/70 dark:text-paper/70">
              Title
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={saving}
              placeholder="Untitled recording"
              aria-label="Recovered recording title"
              className="w-full rounded-lg border border-base [background:color-mix(in_oklab,var(--surface)_60%,transparent)] px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-trust-blue focus:bg-surface disabled:opacity-50 dark:text-paper"
            />
          </label>

          <p className="text-xs text-ink/50 dark:text-paper/40">
            Approximate size {formatApproxSize(info.bytesSoFar)}. Recovered audio is
            saved as-is and can&apos;t be continued.
          </p>

          {info.mayBeTruncated && (
            <div
              role="status"
              className="rounded-lg border border-ink/15 bg-warm-highlight px-3 py-2 text-xs text-ink dark:border-night-border dark:bg-night-surface/60 dark:text-paper"
            >
              The recovered audio may be missing the end. Its local backup appears to
              have stopped before the recording ended.
            </div>
          )}

          {!online && (
            <div
              role="status"
              className="rounded-lg border border-ink/15 bg-warm-highlight px-3 py-2 text-xs text-ink dark:border-night-border dark:bg-night-surface/60 dark:text-paper"
            >
              You&apos;re offline. Reconnect to save this recording — or discard it.
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-ember-red/20 bg-ember-red/5 px-3 py-2 text-xs text-ember-red dark:bg-ember-red/10"
            >
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-base [background:color-mix(in_oklab,var(--text)_5%,transparent)] px-6 py-4">
          <button
            type="button"
            onClick={handleDiscard}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:text-ink disabled:opacity-40 dark:text-paper/50 dark:hover:text-paper"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !online}
            title={!online ? 'You are offline' : 'Save and transcribe'}
            className="rounded-lg bg-ember-red px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-ember-red/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-red/40 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save & transcribe'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
