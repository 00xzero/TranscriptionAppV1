import { toast } from '@/components/ui/toaster'

/** Says changes may not be in the database, offering their text to copy when there is some. */
export function toastUnsaved(title: string, description: string, texts: readonly string[] = []) {
  if (!texts.length) { toast({ title, description, variant: 'error' }); return }
  toast({
    title, description, variant: 'error', durationMs: 15000,
    action: { label: 'Copy text', onClick: () => { void copyText(texts) } },
  })
}

type OvertakenEdit = { text: string; reason?: 'reshaped' | 'deleted' }
export const TRANSCRIPT_DELETED_MESSAGE = 'This transcript was deleted in another tab'

function previewText(text: string): string {
  const compact = text.replace(/\s+/gu, ' ').trim()
  let preview = ''
  let count = 0
  for (const { segment } of new Intl.Segmenter().segment(compact)) {
    if (count === 60) return `${preview}…`
    preview += segment
    count++
  }
  return preview
}

export function toastOvertakenEdits(edits: readonly OvertakenEdit[], transcriptDeleted = false) {
  const texts = edits.map(({ text }) => text)
  const single = texts.length === 1
  const lead = transcriptDeleted ? TRANSCRIPT_DELETED_MESSAGE : single
    ? 'This segment changed elsewhere' : 'These segments changed elsewhere'
  const reasons = {
    reshaped: 'This segment was split or joined elsewhere',
    deleted: 'This segment was deleted elsewhere',
  }
  toast({
    title: single ? 'Your edit wasn’t saved' : `${texts.length} edits weren’t saved`,
    description: `${lead}. Copy your text before closing this message.`,
    variant: 'error',
    recovery: {
      texts,
      previews: edits.slice(0, 3).map(({ text, reason }) =>
        [previewText(text), reason && reasons[reason]].filter(Boolean).join(' · ')),
    },
    action: { label: 'Copy text', onClick: () => { void copyText(texts) } },
  })
}

/**
 * Puts these texts on the clipboard, one paragraph each. Without the
 * Clipboard API (plain http) it copies the old way; says so if neither works.
 * True once copied.
 */
export async function copyText(texts: readonly string[]): Promise<boolean> {
  const text = texts.join('\n\n')
  const copied = await (navigator.clipboard?.writeText(text).then(() => true, () => false) ?? false) || copyByCommand(text)
  if (!copied) toast({ title: "Couldn't copy the text", description: 'Your browser blocked the clipboard.', variant: 'error' })
  return copied
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
