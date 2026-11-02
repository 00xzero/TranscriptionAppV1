import type { Tag, TranscriptTag } from '@/contracts/db'

/** Every tag the user owns and every tag on their transcripts, as last read or changed. */
export type TagsSnapshot = {
  tags: readonly Tag[]
  links: readonly TranscriptTag[]
}

/** A change to the snapshot: shown at once as a pending edit, and folded in once confirmed. */
export type TagsEdit = (snapshot: TagsSnapshot) => TagsSnapshot

const sameLink = (link: TranscriptTag, transcriptId: string, tagId: string) =>
  link.transcript_id === transcriptId && link.tag_id === tagId

/** Puts a tag on a transcript, or takes it off. */
export function withLink(snapshot: TagsSnapshot, transcriptId: string, tagId: string, on: boolean): TagsSnapshot {
  const has = snapshot.links.some((link) => sameLink(link, transcriptId, tagId))
  if (on === has) return snapshot
  return {
    ...snapshot,
    links: on
      ? [...snapshot.links, { transcript_id: transcriptId, tag_id: tagId }]
      : snapshot.links.filter((link) => !sameLink(link, transcriptId, tagId)),
  }
}

/** Adds a tag, or replaces the one with its id. */
export function withTag(snapshot: TagsSnapshot, tag: Tag): TagsSnapshot {
  const exists = snapshot.tags.some((entry) => entry.id === tag.id)
  return {
    ...snapshot,
    tags: exists ? snapshot.tags.map((entry) => (entry.id === tag.id ? tag : entry)) : [...snapshot.tags, tag],
  }
}

/** Removes a tag and every link to it. */
export function withoutTag(snapshot: TagsSnapshot, tagId: string): TagsSnapshot {
  return {
    tags: snapshot.tags.filter((tag) => tag.id !== tagId),
    links: snapshot.links.filter((link) => link.tag_id !== tagId),
  }
}

/** Folds `fromId` into `into`: every transcript with either carries `into` once, and `fromId` is gone. */
export function withMerge(snapshot: TagsSnapshot, fromId: string, into: Tag): TagsSnapshot {
  const moved = snapshot.links.filter((link) => link.tag_id === fromId).map((link) => link.transcript_id)
  let next = withTag(withoutTag(snapshot, fromId), into)
  for (const transcriptId of moved) next = withLink(next, transcriptId, into.id, true)
  return next
}

/** A tag shown before the database confirms it. Its owner and times are filled in by the answer. */
export function provisionalTag(id: string, name: string, color: string): Tag {
  const now = new Date().toISOString()
  return { id, user_id: '', name, color, created_at: now, updated_at: now }
}
