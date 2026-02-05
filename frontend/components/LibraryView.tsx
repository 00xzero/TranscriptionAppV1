"use client"

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useProjectsRealtime } from '@/lib/supabase/hooks'
import type { User } from '@supabase/supabase-js'

export default function LibraryView() {
    const [user, setUser] = useState<User | null>(null)
    const { projects, isLoading } = useProjectsRealtime()

    // Fetch user for greeting
    useEffect(() => {
        const supabase = createClient()
        const getUser = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            setUser(user)
        }
        getUser()
    }, [])

    // Get greeting based on time of day
    const getGreeting = () => {
        const hour = new Date().getHours()
        if (hour < 12) return 'Good morning'
        if (hour < 17) return 'Good afternoon'
        return 'Good evening'
    }

    const getUserFirstName = () => {
        if (!user) return 'there'
        const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'there'
        return name.split(' ')[0]
    }

    // Format relative time
    const formatRelativeTime = (dateString: string) => {
        const date = new Date(dateString)
        const now = new Date()
        const diffMs = now.getTime() - date.getTime()
        const diffMins = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMins / 60)
        const diffDays = Math.floor(diffHours / 24)

        if (diffMins < 1) return 'Just now'
        if (diffMins < 60) return `${diffMins}m ago`
        if (diffHours < 24) return `${diffHours}h ago`
        if (diffDays === 1) return 'Yesterday'
        return `${diffDays}d ago`
    }

    return (
        <div className="p-6 md:p-10 space-y-10 scroll-smooth">
            <section>
                <h2 className="font-serif text-3xl text-ink dark:text-paper mb-6">
                    {getGreeting()}, {getUserFirstName()}.
                </h2>

                {/* Recent Projects Section */}
                <div className="flex items-center justify-between mb-4 border-b border-[#D1CEC5] dark:border-night-border pb-2">
                    <h3 className="font-serif text-xl text-ink dark:text-paper">Recent Projects</h3>
                    <Link href="/projects" className="text-xs font-mono text-trust-blue hover:underline uppercase tracking-wide">
                        View All
                    </Link>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Sample Project Cards (Placeholder per Olivetti spec) */}
                    <div className="group cursor-pointer relative bg-paper dark:bg-night-surface rounded-lg border border-[#D1CEC5] dark:border-night-border p-5 shadow-sm hover:shadow-elevation hover:-translate-y-1 transition-all duration-300">
                        <div className="absolute -top-2.5 left-4 w-16 h-4 bg-warm-highlight dark:bg-[#3A3025] rounded-t-sm border-t border-l border-r border-[#D1CEC5] dark:border-night-border z-0" />
                        <div className="relative z-10">
                            <div className="flex justify-between items-start mb-3">
                                <span className="font-mono text-[10px] text-trust-blue bg-trust-blue/5 dark:bg-trust-blue/10 px-1.5 py-0.5 rounded border border-trust-blue/10 dark:border-trust-blue/20">ACTIVE</span>
                                <span className="font-mono text-xs text-ink/40 dark:text-paper/40">2h ago</span>
                            </div>
                            <h3 className="font-serif text-xl italic text-ink dark:text-paper mb-1 group-hover:text-trust-blue transition-colors">The Sonic Archives</h3>
                            <p className="font-sans text-xs text-ink/60 dark:text-paper/60 mb-4 line-clamp-2">Deep dive into audio workstation interfaces.</p>
                            <div className="pt-3 border-t border-ink/5 dark:border-paper/10 flex items-center gap-2">
                                <span className="text-xs text-ink/50 dark:text-paper/50">3 Speakers</span>
                            </div>
                        </div>
                    </div>

                    {/* Second Sample Card */}
                    <div className="group cursor-pointer relative bg-paper dark:bg-night-surface rounded-lg border border-[#D1CEC5] dark:border-night-border p-5 shadow-sm hover:shadow-elevation hover:-translate-y-1 transition-all duration-300 opacity-80 hover:opacity-100">
                        <div className="absolute -top-2.5 left-4 w-16 h-4 bg-[#D1CEC5] dark:bg-[#333] rounded-t-sm border-t border-l border-r border-[#D1CEC5] dark:border-night-border z-0" />
                        <div className="relative z-10">
                            <div className="flex justify-between items-start mb-3">
                                <span className="font-mono text-[10px] text-ink/40 dark:text-paper/40 bg-ink/5 dark:bg-paper/10 px-1.5 py-0.5 rounded border border-ink/10 dark:border-paper/20">FILED</span>
                                <span className="font-mono text-xs text-ink/40 dark:text-paper/40">Yesterday</span>
                            </div>
                            <h3 className="font-serif text-xl italic text-ink dark:text-paper mb-1">Product Roadmap</h3>
                            <p className="font-sans text-xs text-ink/60 dark:text-paper/60 mb-4">Q4 feature prioritization session with engineering leads.</p>
                            <div className="pt-3 border-t border-ink/5 dark:border-paper/10">
                                <span className="text-xs text-ink/50 dark:text-paper/50">1 audio file</span>
                            </div>
                        </div>
                    </div>

                    {/* New Project Placeholder */}
                    <div className="group cursor-pointer border-2 border-dashed border-[#D1CEC5] dark:border-night-border rounded-lg p-5 flex flex-col items-center justify-center text-ink/40 dark:text-paper/40 hover:text-trust-blue hover:border-trust-blue/50 hover:bg-trust-blue/5 transition-all">
                        <span className="text-3xl mb-2 font-light">+</span>
                        <span className="font-serif italic text-sm">New Project Folder</span>
                    </div>
                </div>
            </section>

            {/* Recent Files Section - Using Real Data */}
            <section className="mt-8">
                <div className="flex items-center justify-between mb-4 border-b border-[#D1CEC5] dark:border-night-border pb-2">
                    <h3 className="font-serif text-xl text-ink dark:text-paper">Recent Files</h3>
                    <Link href="/projects" className="text-xs font-mono text-trust-blue hover:underline uppercase tracking-wide">
                        View All
                    </Link>
                </div>

                <div className="bg-white dark:bg-night-surface rounded border border-[#D1CEC5] dark:border-night-border divide-y divide-[#D1CEC5] dark:divide-night-border">
                    {isLoading ? (
                        <div className="p-4 text-center text-ink/50 dark:text-paper/50 text-sm">
                            Loading projects...
                        </div>
                    ) : projects.length === 0 ? (
                        <div className="p-4 text-center text-ink/50 dark:text-paper/50 text-sm">
                            No projects yet. Click "Capture" to start your first transcription.
                        </div>
                    ) : (
                        projects.slice(0, 5).map((project) => (
                            <div
                                key={project.id}
                                className="p-4 flex items-center justify-between hover:bg-warm-highlight/20 dark:hover:bg-white/5 transition-colors group"
                            >
                                <Link
                                    href={project.status === 'complete' ? `/editor/${project.id}` : `/projects`}
                                    className="flex items-center gap-4 flex-1 cursor-pointer"
                                >
                                    <div className="w-10 h-10 rounded bg-[#F2EFED] dark:bg-[#252525] flex items-center justify-center text-ink/40 dark:text-paper/40 flex-shrink-0">
                                        <span className="font-mono text-lg">¶</span>
                                    </div>
                                    <div>
                                        <h4 className="font-sans text-sm font-medium text-ink dark:text-paper group-hover:text-trust-blue transition-colors">
                                            {project.title}
                                        </h4>
                                        <p className="font-mono text-[10px] text-ink/50 dark:text-paper/50">
                                            {project.status === 'complete' ? 'Ready' : project.status}
                                        </p>
                                    </div>
                                </Link>
                                <div className="flex items-center gap-4">
                                    <span className="text-xs text-ink/60 dark:text-paper/60 font-sans hidden md:block">
                                        {formatRelativeTime(project.updated_at)}
                                    </span>
                                    <button
                                        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-ink/40 dark:text-paper/40 transition-colors"
                                        aria-label={`More options for ${project.title}`}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <span className="mb-2">...</span>
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </section>
        </div>
    )
}
