"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { createClient } from '@/infra/supabase/client'
import { useProjectsData, useTranscriptsData } from '@/lib/projects/ProjectsProvider'
import { TranscriptActionsMenu } from '@/components/TranscriptActionsMenu'
import { TranscriptActionDialogs } from '@/components/TranscriptActionDialogs'
import { TranscriptRow } from '@/components/Projects/TranscriptRow'
import { ProjectNameDialog } from '@/components/Projects/ProjectNameDialog'
import { RecentProjectsCarousel } from '@/components/Projects/RecentProjectsCarousel'
import {
  selectRecentProjects,
  type RecentProjectScope,
} from '@/core/projects/activity'
import { transcriptActionTarget } from '@/lib/transcripts/actions'
import { useTranscriptActions } from '@/lib/transcripts/useTranscriptActions'
import type { User } from '@supabase/supabase-js'

/**
 * Escape hatch. `'top-level'` shows ground-level folders only, with branch rollups.
 * Switch to `'all'` to restore the previous mixed parent/nested cards with direct
 * counts and parent-path labels; nothing else needs to change.
 */
const RECENT_PROJECT_SCOPE: RecentProjectScope = 'top-level'

/** Cards in the carousel. The creation control is extra and never counts against it. */
const RECENT_PROJECT_LIMIT = 6

/** Above this many ground-level projects the dashboard stops offering folder creation. */
const CREATE_AFFORDANCE_MAX_ROOTS = 3

export default function LibraryView() {
  const supabase = useMemo(() => createClient(), [])
  const [user, setUser] = useState<User | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const {
    projects,
    tree,
    projectsLoading,
    createProject,
  } = useProjectsData()
  const { transcripts, transcriptsLoading: isLoading } = useTranscriptsData()
  const transcriptActions = useTranscriptActions()

  const recentProjectCards = useMemo(
    () =>
      selectRecentProjects({
        scope: RECENT_PROJECT_SCOPE,
        tree,
        projects,
        transcripts,
        limit: RECENT_PROJECT_LIMIT,
      }),
    [projects, transcripts, tree]
  )

  // Gate on every eligible root, not just the ones that made the six-card cut.
  const activeRootCount = useMemo(
    () => tree.roots.filter((project) => !project.deleting_at).length,
    [tree]
  )

  const projectsAreLoading = projectsLoading || isLoading
  const showCreateTile = activeRootCount <= CREATE_AFFORDANCE_MAX_ROOTS

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
      <h2 className="font-serif text-3xl text-ink dark:text-paper mb-6">
        {getGreeting()}, {getUserFirstName()}.
      </h2>

      <RecentProjectsCarousel
        cards={recentProjectCards}
        loading={projectsAreLoading}
        showCreateTile={showCreateTile}
        onCreate={() => setCreateOpen(true)}
      />

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
      <ProjectNameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        parentId={null}
        onSubmit={(name) => createProject({ name, parent_id: null })}
      />
      <TranscriptActionDialogs actions={transcriptActions} />
    </>
  )
}
