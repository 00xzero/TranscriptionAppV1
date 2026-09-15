"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { createClient } from '@/infra/supabase/client'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { TranscriptActionsMenu } from '@/components/TranscriptActionsMenu'
import { TranscriptRow } from '@/components/Projects/TranscriptRow'
import { transcriptActionTarget } from '@/lib/transcripts/actions'
import { TranscriptActionDialogs, useTranscriptActions } from '@/lib/transcripts/useTranscriptActions'
import type { User } from '@supabase/supabase-js'

export default function LibraryView() {
  const supabase = useMemo(() => createClient(), [])
  const [user, setUser] = useState<User | null>(null)
  const { transcripts, transcriptsLoading: isLoading } = useProjectsData()
  const transcriptActions = useTranscriptActions()

  // Fetch user for greeting
  useEffect(() => {
    const getUser = async () => {
      try {
        const { data, error } = await supabase.auth.getUser()
        if (error) {
          console.error('Failed to fetch user:', error)
          setUser(null)
          return
        }
        setUser(data.user ?? null)
      } catch (error) {
        console.error('Unexpected error fetching user:', error)
        setUser(null)
      }
    }
    void getUser()
  }, [supabase])

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

  return (
    <>
      <div className="pt-[80px] px-6 pb-6 md:pt-[80px] md:px-10 md:pb-10 space-y-10 scroll-smooth">
      <section>
        <h2 className="font-serif text-3xl text-ink dark:text-paper mb-6">
          {getGreeting()}, {getUserFirstName()}.
        </h2>

        {/* Recent Projects Section (future feature: projects group transcripts/files) */}
        <div className="flex items-center justify-between mb-4 border-b border-(--border) pb-2">
          <h3 className="font-serif text-xl text-ink dark:text-paper">Recent Projects</h3>
          <Link href="/projects" title="View all projects" className="text-xs font-mono text-trust-blue hover:underline uppercase tracking-wide">
            View All
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Sample Project Cards (Placeholder per Olivetti spec) */}
          <div className="group cursor-pointer relative bg-paper dark:bg-night-surface rounded-lg border border-(--border) p-5 shadow-xs hover:shadow-elevation hover:-translate-y-1 transition-all duration-300">
            <div className="absolute -top-2.5 left-4 w-16 h-4 bg-warm-highlight dark:bg-night-highlight rounded-t-sm border-t border-l border-r border-(--border) z-0" />
            <div className="relative z-10">
              <div className="flex justify-between items-start mb-3">
                <span className="font-mono text-[10px] text-trust-blue bg-trust-blue/5 dark:bg-trust-blue/10 px-1.5 py-0.5 rounded-sm border border-trust-blue/10 dark:border-trust-blue/20">ACTIVE</span>
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
          <div className="group cursor-pointer relative bg-paper dark:bg-night-surface rounded-lg border border-(--border) p-5 shadow-xs hover:shadow-elevation hover:-translate-y-1 transition-all duration-300 opacity-80 hover:opacity-100">
            <div className="absolute -top-2.5 left-4 w-16 h-4 bg-(--border) rounded-t-sm border-t border-l border-r border-(--border) z-0" />
            <div className="relative z-10">
              <div className="flex justify-between items-start mb-3">
                <span className="font-mono text-[10px] text-ink/40 dark:text-paper/40 bg-ink/5 dark:bg-paper/10 px-1.5 py-0.5 rounded-sm border border-ink/10 dark:border-paper/20">FILED</span>
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
          <div className="group cursor-pointer border-2 border-dashed border-(--border) rounded-lg p-5 flex flex-col items-center justify-center text-ink/40 dark:text-paper/40 hover:text-trust-blue hover:border-trust-blue/50 hover:bg-trust-blue/5 transition-all">
            <span className="text-3xl mb-2 font-light">+</span>
            <span className="font-serif italic text-sm">New Project Folder</span>
          </div>
        </div>
      </section>

      {/* Recent Transcripts Section - Using Real Data */}
      <section className="mt-8">
        <div className="flex items-center justify-between mb-4 border-b border-(--border) pb-2">
          <h3 className="font-serif text-xl text-ink dark:text-paper">Recent Transcripts</h3>
          <Link href="/transcripts" title="View all transcripts" className="text-xs font-mono text-trust-blue hover:underline uppercase tracking-wide">
            View All
          </Link>
        </div>

        <div className="divide-y divide-border rounded-sm border border-border bg-panel">
          {isLoading ? (
            <div className="p-4 text-center text-ink/50 dark:text-paper/50 text-sm">
              Loading transcripts...
            </div>
          ) : transcripts.length === 0 ? (
            <div className="p-4 text-center text-ink/50 dark:text-paper/50 text-sm">
              No transcripts yet. Click &ldquo;Capture&rdquo; to start your first transcription.
            </div>
          ) : (
            transcripts.slice(0, 5).map((transcript) => {
              const target = transcriptActionTarget(transcript)
              return (
                <TranscriptRow
                  key={transcript.id}
                  transcript={transcript}
                  actions={(
                    <TranscriptActionsMenu
                      title={target.title}
                      onMove={() => transcriptActions.openMove(target)}
                      onDelete={() => transcriptActions.openDelete(target)}
                    />
                  )}
                />
              )
            })
          )}
        </div>
        </section>
      </div>
      <TranscriptActionDialogs actions={transcriptActions} />
    </>
  )
}
