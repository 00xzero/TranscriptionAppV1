"use client"
import { useState } from 'react'

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
                onClose()
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

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={(e) => {
                if (e.target === e.currentTarget && !isExporting) {
                    onClose()
                }
            }}
        >
            <div className="bg-surface border border-base rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
                {/* Title */}
                <h2 className="text-xl font-semibold mb-4">Export Transcript</h2>

                {/* Format Selection */}
                <div className="space-y-3 mb-6">
                    <p className="text-sm text-muted mb-2">Select format:</p>

                    {/* PDF - Coming Soon */}
                    <label className="flex items-center gap-3 p-3 border border-base rounded cursor-not-allowed opacity-60">
                        <input
                            type="radio"
                            name="format"
                            value="PDF"
                            disabled={true}
                            className="w-4 h-4"
                        />
                        <div className="flex-1">
                            <div className="font-medium flex items-center gap-2">
                                PDF
                                <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded">
                                    Coming Soon
                                </span>
                            </div>
                            <div className="text-sm text-muted">Portable Document Format</div>
                        </div>
                    </label>

                    <label className="flex items-center gap-3 p-3 border border-base rounded cursor-pointer hover:bg-surface-alt transition-colors">
                        <input
                            type="radio"
                            name="format"
                            value="DOCX"
                            checked={selectedFormat === 'DOCX'}
                            onChange={(e) => setSelectedFormat(e.target.value as ExportFormat)}
                            disabled={isExporting}
                            className="w-4 h-4"
                        />
                        <div>
                            <div className="font-medium">Word (.docx)</div>
                            <div className="text-sm text-muted">Microsoft Word document</div>
                        </div>
                    </label>

                    <label className="flex items-center gap-3 p-3 border border-base rounded cursor-pointer hover:bg-surface-alt transition-colors">
                        <input
                            type="radio"
                            name="format"
                            value="VTT"
                            checked={selectedFormat === 'VTT'}
                            onChange={(e) => setSelectedFormat(e.target.value as ExportFormat)}
                            disabled={isExporting}
                            className="w-4 h-4"
                        />
                        <div>
                            <div className="font-medium">VTT</div>
                            <div className="text-sm text-muted">WebVTT captions file</div>
                        </div>
                    </label>
                </div>

                {/* Loading State */}
                {isExporting && (
                    <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-sm">
                        <div className="flex items-center gap-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                            <span>Preparing your export. This may take a few seconds...</span>
                        </div>
                    </div>
                )}

                {/* Success State */}
                {showSuccess && (
                    <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded text-sm text-green-800 dark:text-green-200">
                        ✓ Your download should begin shortly.
                    </div>
                )}

                {/* Error State */}
                {exportError && (
                    <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-200">
                        {exportError}
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3 justify-end">
                    <button
                        onClick={onClose}
                        disabled={isExporting}
                        className="px-4 py-2 rounded border border-base bg-surface hover:bg-surface-alt disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={isExporting || showSuccess}
                        className="px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isExporting ? 'Exporting...' : 'Export'}
                    </button>
                </div>
            </div>
        </div>
    )
}
