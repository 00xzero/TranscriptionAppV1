"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { createClient } from '@/infra/supabase/client'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { TranscriptActionsMenu } from '@/components/TranscriptActionsMenu'
import { TranscriptActionDialogs } from '@/components/TranscriptActionDialogs'
import { TranscriptRow } from '@/components/Projects/TranscriptRow'
import {
  RecentProjectCard,
  RecentProjectCardSkeleton,
} from '@/components/Projects/RecentProjectCard'
import { rankProjectsByActivity } from '@/core/projects/activity'
import {
  descendantCount,
  pathLabel,
  transcriptCountsByProject,
} from '@/core/projects/tree'
import { transcriptActionTarget } from '@/lib/transcripts/actions'
import { useTranscriptActions } from '@/lib/transcripts/useTranscriptActions'
import type { User } from '@supabase/supabase-js'

export default function LibraryView() {
  const supabase = useMemo(() => createClient(), [])
  const [user, setUser] = useState<User | null>(null)
  const {
    projects,
    tree,
    projectsLoading,
    transcripts,
    transcriptsLoading: isLoading,
  } = useProjectsData()
  const transcriptActions = useTranscriptActions()
  const recentProjectCards = useMemo(() => {
    const transcriptCounts = transcriptCountsByProject(transcripts)
    return rankProjectsByActivity(projects, transcripts, 3).map(({ project, lastActivityAt }) => ({
      project,
      lastActivityAt,
      parentPath: project.parent_id ? pathLabel(tree, project.parent_id) : null,
      directTranscriptCount: transcriptCounts.get(project.id) ?? 0,
      nestedProjectCount: descendantCount(tree, project.id),
    }))
  }, [projects, transcripts, tree])
  const projectsAreLoading = projectsLoading || isLoading

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

        <div className="flex items-center justify-between mb-4 border-b border-(--border) pb-2">
          <h3 className="font-serif text-xl text-ink dark:text-paper">Recent Projects</h3>
          <Link href="/projects" title="View all projects" className="text-xs font-mono text-trust-blue hover:underline uppercase tracking-wide">
            View All
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {projectsAreLoading ? (
            [0, 1, 2].map((item) => <RecentProjectCardSkeleton key={item} />)
          ) : recentProjectCards.length === 0 ? (
            <Link
              href="/projects"
              title="Create a project"
              className="group flex min-h-44 flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-5 text-muted transition-all hover:border-trust-blue/50 hover:bg-trust-blue/5 hover:text-trust-blue"
            >
              <span className="mb-2 text-3xl font-light">+</span>
              <span className="font-serif text-sm italic">Create your first project</span>
            </Link>
          ) : (
            recentProjectCards.map((card) => (
              <RecentProjectCard key={card.project.id} {...card} />
            ))
          )}
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
