import type { CreateTranscriptWarning } from '@/contracts/api'
import { toast } from '@/components/ui/toaster'

export const PROJECT_MISSING_WARNING_MESSAGE =
    'Saved to Unfiled: the project is no longer available'

/**
 * Render a transcript-creation warning as a toast. UI boundaries only: workflow
 * modules report the warning in their results and never toast themselves.
 * Returns true when a toast was shown so callers can skip their default toast.
 */
export function showCaptureWarning(
  warning: CreateTranscriptWarning | undefined,
  description?: string
): boolean {
  if (warning !== 'project_missing') return false
  toast({ title: PROJECT_MISSING_WARNING_MESSAGE, description })
  return true
}
