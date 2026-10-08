/** A calendar date as the directory shows it: `12 Sep 2026`, in the reader's locale. */
export function formatPeopleDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Characters as the database counts them, so an emoji is one. */
export function nameLength(name: string): number {
  return Array.from(name.trim()).length
}
