"use client"

import { useLayoutEffect, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useDialogFocusRestore } from '@/components/ui/use-dialog-focus-restore'

type ExportFormat = 'DOCX' | 'VTT' | 'TXT' | 'MD'

interface ExportModalProps {
  transcriptId: string
  transcriptTitle?: string | null
  onClose: () => void
}

export default function ExportModal({ transcriptId, transcriptTitle, onClose }: ExportModalProps) {
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
      const endpoint = `/api/transcripts/${transcriptId}/export/${selectedFormat.toLowerCase()}`

      const response = await fetch(endpoint)

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Please sign in to export')
        }
        throw new Error(`Export failed: ${response.status}`)
      }

      // Get the filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = `${transcriptTitle || 'transcript'}.${selectedFormat.toLowerCase()}`

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

  const formats: Array<{ value: ExportFormat; label: string; description: string }> = [
    { value: 'DOCX', label: 'Word (.docx)', description: 'Microsoft Word document' },
    { value: 'VTT', label: 'VTT', description: 'WebVTT captions file' },
    { value: 'TXT', label: 'TXT', description: 'Plain text file' },
    { value: 'MD', label: 'Markdown (.md)', description: 'Markdown formatted text' },
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
        onCloseAutoFocus={(event) => {
          event.preventDefault()
        }}
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
          <p className="mt-1 text-[10px] font-mono text-foreground/50">
            Select your preferred download format
          </p>
        </div>

        <RadioGroup
          value={selectedFormat}
          onValueChange={(value) => setSelectedFormat(value as ExportFormat)}
          className="space-y-2 px-6 pb-5"
        >
          {formats.map((fmt) => {
            const isSelected = selectedFormat === fmt.value

            return (
              <div
                key={fmt.value}
                title={`Export as ${fmt.label}`}
                className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${isExporting
                  ? 'cursor-not-allowed border-ink/5 opacity-50 dark:border-paper/5'
                  : isSelected
                    ? 'cursor-pointer border-trust-blue bg-trust-blue/10 dark:bg-trust-blue/20'
                    : 'cursor-pointer border-ink/10 hover:bg-ink/5 dark:border-paper/10 dark:hover:bg-paper/5'
                  }`}
                onClick={() => {
                  if (!isExporting) {
                    setSelectedFormat(fmt.value)
                  }
                }}
              >
                <RadioGroupItem
                  value={fmt.value}
                  disabled={isExporting}
                  aria-label={fmt.label}
                  className="shrink-0"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-ink dark:text-paper">
                    {fmt.label}
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

        <div className="flex items-center justify-end gap-3 border-t border-border bg-subtle px-6 py-4">
          <button
            onClick={handleClose}
            disabled={isExporting}
            title="Cancel export"
            className="rounded-lg px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:text-ink disabled:opacity-40 dark:text-paper/50 dark:hover:text-paper"
          >
            Cancel
          </button>
          <Button
            variant="primary"
            onClick={handleExport}
            disabled={isExporting || showSuccess}
            title={isExporting ? 'Export in progress' : 'Export transcript'}
            className="rounded-lg px-5 disabled:opacity-40"
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
