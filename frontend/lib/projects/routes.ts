/** The `[projectId]` segment of a `/projects/[projectId]` pathname, if there is one. */
export function projectIdFromPathname(pathname: string | null): string | undefined {
  if (!pathname?.startsWith('/projects/')) return undefined
  return pathname.split('/')[2] || undefined
}

/** The `[id]` segment of an `/editor/[id]` pathname, if there is one. */
export function transcriptIdFromEditorPathname(pathname: string | null): string | undefined {
  if (!pathname?.startsWith('/editor/')) return undefined
  return pathname.split('/')[2] || undefined
}
