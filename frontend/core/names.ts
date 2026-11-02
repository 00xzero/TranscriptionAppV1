// Matching user-chosen names (organisations, tags) the way the database tells
// them apart: trimmed and without case.

/** Names equal once trimmed and compared without case. */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
}

/** Entries whose name contains the query, for a type-ahead; all of them for a blank query. */
export function matchByName<T extends { name: string }>(entries: readonly T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return [...entries]
  return entries.filter((entry) => entry.name.toLocaleLowerCase().includes(needle))
}

/** The entry already called `name`, ignoring case, which the database would reuse. */
export function exactByName<T extends { name: string }>(entries: readonly T[], name: string): T | undefined {
  if (!name.trim()) return undefined
  return entries.find((entry) => sameName(entry.name, name))
}
