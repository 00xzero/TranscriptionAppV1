"use client"

import { useId, useState } from 'react'
import { ChevronDown, Folder, Inbox } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ProjectTreePicker } from '@/components/Projects/ProjectTreePicker'
import { transcriptProjectLabel } from '@/components/Projects/format'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { isRealtimeScopeAbortError } from '@/lib/supabase/realtime'

interface CaptureProjectFieldProps {
  projectId: string | null
  onProjectChange: (projectId: string | null) => void
  disabled: boolean
}

/** Where the capture will be filed, changed through the project tree. */
export default function CaptureProjectField({ projectId, onProjectChange, disabled }: CaptureProjectFieldProps) {
  const { tree, projectsLoading, projectError, refetchProjects } = useProjectsData()
  const [open, setOpen] = useState(false)
  const labelId = useId()
  const valueId = useId()

  const label = projectsLoading ? null : transcriptProjectLabel(tree, projectId)
  // A failed load can leave an empty tree, or one without the chosen project:
  // nothing reliable to pick from. The capture still goes to the chosen project.
  const loadFailed =
    !projectsLoading && (label === null || (Boolean(projectError) && tree.byId.size === 0))
  const valueText = projectsLoading ? 'Loading projects…' : loadFailed ? "Couldn't load projects" : label?.label
  const ValueIcon = projectId === null ? Inbox : Folder

  const retry = () => {
    void refetchProjects().catch((error: unknown) => {
      if (isRealtimeScopeAbortError(error)) return
      console.error('[capture] Failed to retry loading projects:', error)
    })
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <Label id={labelId} className="text-xs font-medium opacity-80">Project</Label>
        {loadFailed && (
          <button
            type="button"
            onClick={retry}
            className="text-xs text-foreground/60 underline underline-offset-2 hover:text-foreground"
          >
            Retry
          </button>
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-labelledby={`${labelId} ${valueId}`}
            disabled={disabled || projectsLoading || loadFailed}
            className="flex w-full items-center gap-2 rounded-sm border border-border bg-field/50 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-field focus:border-accent focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-accent data-[state=open]:bg-field"
          >
            <ValueIcon className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
            <span id={valueId} className="min-w-0 flex-1 truncate" title={label?.full}>
              {valueText}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-foreground/40" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        {/* Modal, so its scroll lock sits above the dialog's: the tree scrolls with
            the wheel. Above the dialog (z-[100]), and no taller than the room left. */}
        <PopoverContent
          aria-labelledby={labelId}
          align="start"
          className="z-[110] max-h-(--radix-popover-content-available-height) w-(--radix-popover-trigger-width) overflow-y-auto p-3"
        >
          <ProjectTreePicker
            tree={tree}
            value={projectId}
            onChange={(nextProjectId) => {
              onProjectChange(nextProjectId)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
