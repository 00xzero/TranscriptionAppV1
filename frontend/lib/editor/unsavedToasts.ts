import { toast } from '@/components/ui/toaster'

/** Says changes may not be in the database, offering their text to copy when there is some. */
export function toastUnsaved(title: string, description: string, texts: readonly string[] = []) {
  if (!texts.length) { toast({ title, description, variant: 'error' }); return }
  toast({
    title, description, variant: 'error', durationMs: 15000,
    action: { label: 'Copy text', onClick: () => { void copyText(texts) } },
  })
}

/**
 * Puts these texts on the clipboard, one paragraph each. Without the
 * Clipboard API (plain http) it copies the old way; says so if neither works.
 */
export async function copyText(texts: readonly string[]) {
  const text = texts.join('\n\n')
  const copied = await (navigator.clipboard?.writeText(text).then(() => true, () => false) ?? false) || copyByCommand(text)
  if (!copied) toast({ title: "Couldn't copy the text", description: 'Your browser blocked the clipboard.', variant: 'error' })
}

function copyByCommand(text: string): boolean {
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  try { return document.execCommand('copy') } catch { return false } finally { field.remove() }
}

/** Said when the editor closed (browser Back or Forward) before its last changes were saved. */
export const LEFT_UNSAVED_TOAST = 'Your last changes may not have been saved'
export const LEFT_UNSAVED_MESSAGE = 'You left the editor before they were saved.'
