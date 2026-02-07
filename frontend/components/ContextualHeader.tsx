"use client"

import React from 'react'
import { useModal } from '@/lib/ModalContext'

interface ContextualHeaderProps {
    viewType?: 'library' | 'editor'
    projectTitle?: string
}

export default function ContextualHeader({ viewType = 'library', projectTitle }: ContextualHeaderProps) {
    const { openCaptureModal } = useModal()

    return (
        <header className="h-16 border-b border-[#D1CEC5] dark:border-night-border bg-paper/80 dark:bg-night-bg/80 backdrop-blur-sm flex items-center justify-between px-6 z-10 transition-colors duration-300">
            {/* Left: View Title / Breadcrumbs */}
            <div className="flex items-center gap-2">
                {viewType === 'library' ? (
                    <span className="font-serif text-xl italic text-ink dark:text-paper">Library</span>
                ) : (
                    <div className="flex items-center gap-[5px]">
                        <span className="font-sans text-[12px] leading-[20px] text-ink/50 dark:text-paper/50">
                            Library
                        </span>
                        <span className="font-sans text-[12px] leading-[20px] text-ink/50 dark:text-paper/50">/</span>
                        <span className="font-sans font-medium text-[12px] leading-[20px] text-ink dark:text-paper">
                            {projectTitle || 'Project'}
                        </span>
                    </div>
                )}
            </div>

            {/* Right: Search + Capture Button */}
            <div className="flex items-center gap-6">
                {/* Global Search - Desktop Only */}
                <div className="relative hidden md:flex items-center gap-3 bg-white/50 dark:bg-white/5 border border-[#D1CEC5] dark:border-night-border rounded-lg px-3 py-1.5 focus-within:border-trust-blue/50 focus-within:bg-white dark:focus-within:bg-[#1A1A1A] transition-all group">
                    <span className="font-mono text-[10px] text-ink/40 dark:text-paper/40 group-focus-within:text-trust-blue transition-colors">?</span>
                    <input
                        type="text"
                        placeholder="Recall a decision..."
                        className="bg-transparent border-none w-56 text-sm font-serif italic focus:outline-none focus:ring-0 placeholder-ink/30 dark:placeholder-paper/20 text-ink dark:text-paper"
                    />
                </div>

                {/* Capture Button */}
                <button
                    onClick={openCaptureModal}
                    className="bg-ember-red text-white px-4 py-2 rounded shadow-sm hover:shadow-md active:scale-95 transition-all flex items-center gap-2 font-medium text-sm"
                >
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                    <span className="hidden md:inline">Capture</span>
                </button>
            </div>
        </header>
    )
}
