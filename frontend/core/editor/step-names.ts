/** The longest typed text a step's name quotes, as Word's Typing "sno". */
export const QUOTE_MAX = 12

/**
 * What one typing step typed, when it is short enough to quote: the text
 * between what before and after share at each end. Nothing to quote when it
 * deleted, ran over a line break, or is longer than QUOTE_MAX.
 */
export function typedQuote(before: string, after: string): string | undefined {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let end = 0
  while (end < before.length - start && end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  const typed = after.slice(start, after.length - end)
  return typed && typed.length <= QUOTE_MAX && !/\n/.test(typed) ? typed : undefined
}

/** A step's name in the undo list, Word-style: "Typing", Typing "sno", "Replace All", "Drag and Drop". */
export function stepName(label: string, quote?: string): string {
  const name = label.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bAnd\b/g, 'and')
  return quote ? `${name} "${quote}"` : name
}
