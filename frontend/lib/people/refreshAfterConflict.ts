import { toast } from '@/components/ui/toaster'
import { CONFLICT_TOAST, STALE_TOAST } from './errors'

/** Retry the read, never the refused write, and report whether it succeeded. */
export async function refreshAfterConflict(reload: () => Promise<boolean>, title = CONFLICT_TOAST): Promise<boolean> {
  const refreshed = await reload()
  toast(refreshed ? { title, variant: 'error' } : {
    title: STALE_TOAST,
    variant: 'error',
    action: { label: 'Retry', onClick: () => void refreshAfterConflict(reload, title) },
  })
  return refreshed
}
