"use client"
import { useState, useRef, useEffect } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'

type ExportFormat = 'DOCX' | 'VTT'

interface ExportModalProps {
  projectId: string
  projectTitle?: string | null
  onClose: () => void
}

export default function ExportModal({ projectId, projectTitle, onClose }: ExportModalProps) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('DOCX')
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const isExportingRef = useRef(isExporting)
  useFocusTrap(panelRef, true)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    isExportingRef.current = isExporting
  }, [isExporting])

  // ESC handler + body scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isExportingRef.current) {
        e.preventDefault()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [])

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
        onCloseRef.current()
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
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-paper/20 dark:bg-black/60 backdrop-blur-sm"
        onClick={() => { if (!isExporting) onClose() }}
      />

      {/* Panel */}
      <div className="flex justify-center" style={{ paddingTop: '20vh' }}>
        <div
          ref={panelRef}
          className="relative w-[480px] max-w-[90vw] bg-[#F2EFED]/45 dark:bg-[#1A1A1A]/45 backdrop-blur-md border border-[#D1CEC5] dark:border-[#333] rounded-xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 pt-6 pb-4">
            <h2 className="font-serif italic text-xl text-ink dark:text-paper">Export Transcript</h2>
            <p className="text-[10px] text-ink/50 dark:text-white/50 font-mono mt-1">
              Select your preferred download format
            </p>
          </div>

          {/* Format Selection */}
          <div className="px-6 pb-5 space-y-2">
            {formats.map((fmt) => {
              const isSelected = !fmt.disabled && selectedFormat === fmt.value
              const isDisabled = fmt.disabled || isExporting
              const inputId = `export-format-${fmt.value.toLowerCase()}`

              return (
                <label
                  key={fmt.value}
                  htmlFor={inputId}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${isDisabled
                    ? 'opacity-50 cursor-not-allowed border-ink/5 dark:border-paper/5'
                    : isSelected
                      ? 'border-trust-blue bg-trust-blue/10 dark:bg-trust-blue/20 cursor-pointer'
                      : 'border-ink/10 dark:border-paper/10 hover:bg-ink/5 dark:hover:bg-paper/5 cursor-pointer'
                    }`}
                >
                  <input
                    id={inputId}
                    type="radio"
                    name="export-format"
                    className="sr-only"
                    checked={isSelected}
                    disabled={isDisabled}
                    onChange={() => {
                      if (!isDisabled && !fmt.disabled) {
                        setSelectedFormat(fmt.value as ExportFormat)
                      }
                    }}
                    aria-label={fmt.label}
                  />
                  {/* Custom radio circle */}
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${isSelected ? 'border-trust-blue' : 'border-ink/20 dark:border-paper/20'
                    }`}>
                    {isSelected && (
                      <div className="w-2 h-2 rounded-full bg-trust-blue" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm text-ink dark:text-paper flex items-center gap-2">
                      {fmt.label}
                      {fmt.disabled && (
                        <span className="text-[9px] font-mono bg-ink/10 dark:bg-white/10 px-1.5 py-0.5 h-[17.5px] inline-flex items-center rounded text-ink/60 dark:text-white/60">
                          COMING SOON
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink/50 dark:text-paper/40">{fmt.description}</div>
                  </div>
                </label>
              )
            })}
          </div>

          {/* Status Messages */}
          <div className="px-6">
            {/* Loading */}
            {isExporting && (
              <div className="mb-4 p-3 bg-trust-blue/5 dark:bg-trust-blue/10 border border-trust-blue/20 rounded-lg text-sm flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-trust-blue shrink-0" />
                <span className="text-ink/80 dark:text-paper/70 font-mono text-xs">
                  Preparing your export...
                </span>
              </div>
            )}

            {/* Success */}
            {showSuccess && (
              <div className="mb-4 p-3 bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-sm text-emerald-700 dark:text-emerald-300 font-mono text-xs">
                Download started successfully.
              </div>
            )}

            {/* Error */}
            {exportError && (
              <div className="mb-4 p-3 bg-ember-red/5 dark:bg-ember-red/10 border border-ember-red/20 rounded-lg text-sm text-ember-red dark:text-ember-red/80 font-mono text-xs">
                {exportError}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 bg-ink/5 dark:bg-white/5 border-t border-[#D1CEC5] dark:border-white/10">
            <button
              onClick={onClose}
              disabled={isExporting}
              className="px-4 py-2 rounded-lg text-sm font-medium text-ink/60 dark:text-paper/50 hover:text-ink dark:hover:text-paper disabled:opacity-40 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting || showSuccess}
              className="px-5 py-2 rounded-lg bg-trust-blue text-white text-sm font-medium disabled:opacity-40 hover:bg-trust-blue/90 transition-colors"
            >
              {isExporting ? 'Exporting...' : 'Export'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
