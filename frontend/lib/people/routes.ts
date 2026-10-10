import { UuidSchema } from '@/contracts/primitives'

/**
 * `?from=<transcriptId>` marks a visit that started in the editor (spec §4).
 * People pages keep it on their own links, so the Back link survives moving
 * between the list and a person.
 */
export function peopleHref(path: string, from: string | null): string {
  return from ? `${path}?from=${encodeURIComponent(from)}` : path
}

export function personHref(personId: string, from: string | null): string {
  return peopleHref(`/people/${personId}`, from)
}

/** The transcript a People page was opened from, if the parameter holds a valid id. */
export function fromTranscriptId(value: string | null): string | null {
  return value && UuidSchema.safeParse(value).success ? value : null
}

export function isPersonId(value: string): boolean {
  return UuidSchema.safeParse(value).success
}

/** The person whose dialog `/people/<id>` opens, if the path names one. */
export function personIdFromPathname(pathname: string | null): string | null {
  const id = pathname?.match(/^\/people\/([^/]+)\/?$/)?.[1]
  return id && isPersonId(id) ? id : null
}
