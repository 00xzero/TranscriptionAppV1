"use client"

import React, { useEffect } from 'react'
import { useModal } from '@/lib/ModalContext'

export default function CaptureModal() {
    const { isCaptureModalOpen, closeCaptureModal } = useModal()

    // Handle ESC key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isCaptureModalOpen) {
                closeCaptureModal()
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [isCaptureModalOpen, closeCaptureModal])

    // Prevent body scroll when modal is open
    useEffect(() => {
        if (isCaptureModalOpen) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = ''
        }
        return () => {
            document.body.style.overflow = ''
        }
    }, [isCaptureModalOpen])

    if (!isCaptureModalOpen) return null

    return (
        <div className="fixed inset-0 z-[100]">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-paper/20 dark:bg-black/60 backdrop-blur-sm transition-opacity"
                onClick={closeCaptureModal}
            />

            {/* Modal Window */}
            <div className="absolute top-[10%] left-1/2 -translate-x-1/2 w-[500px] max-w-[90vw] bg-[#F2EFED]/90 dark:bg-[#141414]/90 backdrop-blur-xl border border-[#D1CEC5] dark:border-[#333] rounded-xl shadow-2xl overflow-hidden flex flex-col text-ink dark:text-[#EAEAEA]">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#D1CEC5] dark:border-white/10">
                    <div className="flex items-center gap-2">
                        <span className="text-ember-red">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                            </svg>
                        </span>
                        <h3 className="font-sans font-medium text-sm">Capture</h3>
                    </div>
                    <div className="flex items-center gap-2 cursor-pointer" onClick={closeCaptureModal}>
                        <span className="text-[10px] font-mono opacity-40 border border-current px-1.5 py-0.5 rounded">ESC</span>
                        <svg className="w-4 h-4 opacity-50 hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </div>
                </div>

                {/* Scrollable Content */}
                <div className="p-6 overflow-y-auto max-h-[70vh] space-y-6">

                    {/* Section 1: File Upload */}
                    <div className="space-y-3">
                        <label className="block text-[10px] font-mono uppercase tracking-wider opacity-60">Select File</label>
                        <p className="text-[10px] text-ink/40 dark:text-white/40 mb-2">MP3, WAV, M4A, AAC, FLAC, MP4, MOV, MKV (up to 1.5GB)</p>

                        <div className="border-2 border-dashed border-[#D1CEC5] dark:border-[#333] rounded-lg bg-ink/5 dark:bg-white/5 h-40 flex flex-col items-center justify-center gap-3 hover:border-trust-blue hover:bg-trust-blue/5 transition-colors cursor-pointer group">
                            <div className="w-10 h-10 rounded-full bg-paper dark:bg-[#222] border border-[#D1CEC5] dark:border-[#444] flex items-center justify-center text-ink/40 dark:text-white/40 group-hover:text-trust-blue group-hover:border-trust-blue transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12" />
                                </svg>
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-medium text-ink/80 dark:text-white/80">Drop recording here</p>
                                <p className="text-xs text-ink/40 dark:text-white/40 my-1">or</p>
                                <span className="text-xs font-mono border border-[#D1CEC5] dark:border-[#444] px-2 py-1 rounded bg-paper dark:bg-[#222]">Browse Files</span>
                            </div>
                        </div>
                    </div>

                    {/* Section 2: Project Title (Placeholder) */}
                    <div className="space-y-4 pt-2 border-t border-[#D1CEC5] dark:border-white/10">
                        <label className="block text-[10px] font-mono uppercase tracking-wider opacity-60 mt-4">Project Details</label>

                        <div className="space-y-1">
                            <label className="text-xs font-medium opacity-80">Title</label>
                            <input
                                type="text"
                                placeholder="e.g., Client Interview - January 2026"
                                className="w-full bg-white/50 dark:bg-[#222]/50 border border-[#D1CEC5] dark:border-[#444] rounded px-3 py-2 text-sm focus:outline-none focus:border-trust-blue focus:bg-white dark:focus:bg-[#222] transition-colors placeholder-ink/30 dark:placeholder-white/20"
                            />
                        </div>

                        {/* Language - Coming Soon */}
                        <div className="space-y-1">
                            <label className="text-xs font-medium opacity-80">
                                Language <span className="text-[10px] font-mono opacity-50 ml-1">(coming soon)</span>
                            </label>
                            <div className="relative">
                                <select
                                    className="w-full bg-white/50 dark:bg-[#222]/50 border border-[#D1CEC5] dark:border-[#444] rounded px-3 py-2 text-sm transition-colors appearance-none cursor-not-allowed opacity-60"
                                    disabled
                                >
                                    <option>English (US)</option>
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </div>
                            </div>
                        </div>

                        {/* Diarization - Coming Soon */}
                        <div className="flex items-center justify-between pt-2">
                            <div>
                                <p className="text-xs font-medium opacity-80">
                                    Speaker Diarization <span className="text-[10px] font-mono opacity-50">(coming soon)</span>
                                </p>
                                <p className="text-[10px] text-ink/40 dark:text-white/40">Automatically identify speakers</p>
                            </div>

                            {/* Disabled Toggle */}
                            <div className="relative inline-block w-10 mr-2 align-middle select-none opacity-50 cursor-not-allowed">
                                <div className="block overflow-hidden h-5 rounded-full bg-[#D1CEC5] dark:bg-[#333]">
                                    <div className="absolute block w-5 h-5 rounded-full bg-white border-4 border-paper dark:border-[#222] right-5" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 bg-ink/5 dark:bg-[#0f0f0f] border-t border-[#D1CEC5] dark:border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2 opacity-50">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-[10px] w-32 md:w-auto leading-tight">60-min file ≈ 5 min process</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={closeCaptureModal}
                            className="text-xs font-medium hover:text-ink/70 dark:hover:text-white/70 transition-colors"
                        >
                            Cancel
                        </button>
                        <button className="text-xs font-medium bg-[#4A2018] text-white/90 border border-[#5A2A20] px-4 py-2 rounded shadow-sm hover:bg-[#5A2A20] hover:text-white transition-all active:scale-95 cursor-not-allowed opacity-50" disabled>
                            Begin Transcription
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
