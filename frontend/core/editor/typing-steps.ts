export type SelectionText = { text: string; start: number; end: number }
export type TextInput = { inputType: string; before: SelectionText; after: SelectionText; composition?: boolean }
export type InputKind = 'typing' | 'replace' | 'delete' | 'paste' | 'cut' | 'drag' | 'edit'
export function classifyInput(inputType: string, hadSelection: boolean): InputKind {
  if (inputType === 'deleteByCut') return 'cut'
  if (inputType.includes('Drag') || inputType.includes('Drop')) return 'drag'
  if (inputType.startsWith('delete')) return 'delete'
  if (inputType.includes('Paste')) return 'paste'
  if (['insertText', 'insertCompositionText', 'insertLineBreak'].includes(inputType)) return hadSelection ? 'replace' : 'typing'
  return 'edit'
}
/** A typing step is sealed once it holds this many characters, as in Word. */
export const TYPING_STEP_MAX = 128
export type OpenTyping = { segmentId: string; version: number; characters: number; sealed: boolean }
export function canExtend(open: OpenTyping, segmentId: string, kind: InputKind, version: number) {
  return !open.sealed && open.segmentId === segmentId && open.version === version && kind === 'typing'
}
