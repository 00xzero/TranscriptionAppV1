import { toast } from '@/components/ui/toaster'

/** Says changes may not be in the database, offering their text to copy when there is some. */
export function toastUnsaved(title: string, description: string, texts: readonly string[] = []) {
  if (!texts.length) { toast({ title, description, variant: 'error' }); return }
  toast({
    title, description, variant: 'error', durationMs: 15000,
    action: { label: 'Copy text', onClick: () => { void copyText(texts) } },
  })
}

/** Puts these texts on the clipboard, one paragraph each; quietly does nothing if it can't. */
export async function copyText(texts: readonly string[]) {
  await navigator.clipboard?.writeText(texts.join('\n\n')).catch(() => undefined)
}

/** Said when the editor closed (browser Back or Forward) before its last changes were saved. */
export const LEFT_UNSAVED_TOAST = 'Your last changes may not have been saved'
export const LEFT_UNSAVED_MESSAGE = 'You left the editor before they were saved.'
