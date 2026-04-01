"use client"

import { useLayoutEffect, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useDialogFocusRestore } from '@/components/ui/use-dialog-focus-restore'

type ExportFormat = 'DOCX' | 'VTT'

interface ExportModalProps {
  projectId: string
  projectTitle?: string | null
  onClose: () => void
}

export default function ExportModal({ projectId, projectTitle, onClose }: ExportModalProps) {
  const { captureFocus, restoreFocus } = useDialogFocusRestore()
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('DOCX')
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)

  useLayoutEffect(() => {
    captureFocus()
  }, [captureFocus])

  const handleClose = () => {
    onClose()
    restoreFocus()
  }

  const handleExport = async () => {
    setIsExporting(true)
    setExportError(null)

    try {
      // Use new Next.js API routes (session cookie handles auth)
      const endpoint = `/api/projects/${projectId}/export/${selectedFormat.toLowerCase()}`

      const response = await fetch(endpoint)

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Please sign in to export')
        }
        throw new Error(`Export failed: ${response.status}`)
      }

      // Get the filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = `${projectTitle || 'transcript'}.${selectedFormat.toLowerCase()}`

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/)
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1]
        }
      }

      // Trigger download
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      // Show success and close after brief delay
      setShowSuccess(true)
      setTimeout(() => {
        handleClose()
      }, 1500)
    } catch (error) {
      console.error('Export failed:', error)
      setExportError(
        error instanceof Error
          ? error.message
          : 'Something went wrong while generating your export. Please try again.'
      )
    } finally {
      setIsExporting(false)
    }
  }

  const formats: Array<{ value: ExportFormat | 'PDF'; label: string; description: string; disabled?: boolean }> = [
    { value: 'PDF', label: 'PDF', description: 'Portable Document Format', disabled: true },
    { value: 'DOCX', label: 'Word (.docx)', description: 'Microsoft Word document' },
    { value: 'VTT', label: 'VTT', description: 'WebVTT captions file' },
  ]

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open && !isExporting) {
          handleClose()
        }
      }}
    >
      <DialogContent
        className="w-[480px] overflow-hidden p-0"
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (isExporting) {
            event.preventDefault()
          }
        }}
        onPointerDownOutside={(event) => {
          if (isExporting) {
            event.preventDefault()
          }
        }}
      >
        <div className="px-6 pt-6 pb-4">
          <DialogTitle>Export Transcript</DialogTitle>
          <p className="mt-1 text-[10px] font-mono text-ink/50 dark:text-white/50">
            Select your preferred download format
          </p>
        </div>

        <RadioGroup
          value={selectedFormat}
          onValueChange={(value) => setSelectedFormat(value as ExportFormat)}
          className="space-y-2 px-6 pb-5"
        >
          {formats.map((fmt) => {
            const isSelected = !fmt.disabled && selectedFormat === fmt.value
            const isDisabled = fmt.disabled || isExporting

            return (
              <div
                key={fmt.value}
                title={fmt.disabled ? `${fmt.label} (coming soon)` : `Export as ${fmt.label}`}
                className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${isDisabled
                  ? 'cursor-not-allowed border-ink/5 opacity-50 dark:border-paper/5'
                  : isSelected
                    ? 'cursor-pointer border-trust-blue bg-trust-blue/10 dark:bg-trust-blue/20'
                    : 'cursor-pointer border-ink/10 hover:bg-ink/5 dark:border-paper/10 dark:hover:bg-paper/5'
                  }`}
                onClick={() => {
                  if (!isDisabled && !fmt.disabled) {
                    setSelectedFormat(fmt.value as ExportFormat)
                  }
                }}
              >
                <RadioGroupItem
                  value={fmt.value}
                  disabled={isDisabled}
                  aria-label={fmt.label}
                  className="shrink-0"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-ink dark:text-paper">
                    {fmt.label}
                    {fmt.disabled && (
                      <span className="inline-flex h-[17.5px] items-center rounded-sm bg-ink/10 px-1.5 py-0.5 text-[9px] font-mono text-ink/60 dark:bg-white/10 dark:text-white/60">
                        COMING SOON
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink/50 dark:text-paper/40">{fmt.description}</div>
                </div>
              </div>
            )
          })}
        </RadioGroup>

        <div className="px-6">
          {isExporting && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-trust-blue/20 bg-trust-blue/5 p-3 text-sm dark:bg-trust-blue/10">
              <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-b-2 border-trust-blue" />
              <span className="font-mono text-xs text-ink/80 dark:text-paper/70">
                Preparing your export...
              </span>
            </div>
          )}

          {showSuccess && (
            <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 font-mono text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              Download started successfully.
            </div>
          )}

          {exportError && (
            <div className="mb-4 rounded-lg border border-ember-red/20 bg-ember-red/5 p-3 font-mono text-xs text-ember-red dark:bg-ember-red/10 dark:text-ember-red/80">
              {exportError}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#D1CEC5] bg-ink/5 px-6 py-4 dark:border-white/10 dark:bg-white/5">
          <button
            onClick={handleClose}
            disabled={isExporting}
            title="Cancel export"
            className="rounded-lg px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:text-ink disabled:opacity-40 dark:text-paper/50 dark:hover:text-paper"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || showSuccess}
            title={isExporting ? 'Export in progress' : 'Export transcript'}
            className="rounded-lg bg-trust-blue px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-trust-blue/90 disabled:opacity-40"
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
