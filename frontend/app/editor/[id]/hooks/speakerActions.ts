import {
  correctSegmentsToPerson,
  createLocalSpeaker,
  reassignSegments,
  renamePerson,
  setSpeakerCustomLabel,
  undoCreatedPerson,
} from '@/lib/supabase/queries'
import { leastUsedSpeakerColor } from '@/lib/speakers/palette'
import type {
  EditorPeopleContext,
  EditorPerson,
  PersonCorrectionResult,
  SegmentSpeakerAssignment,
  SegmentSpeakerChange,
  Speaker,
} from '@/contracts/db'
import type { Seg } from '../types'

/**
 * Editor speaker actions (spec §5–§7). Each one applies optimistically, writes
 * with one guarded database call, settles local state from that call's result
 * and returns its own Undo. A builder returns null when the state it was asked
 * to change is gone, which the editor treats like a refused write.
 *
 * A detected speaker (Deepgram's `Speaker N`) never carries a name. Naming one
 * moves its segments to a named speaker, and Remove moves segments back to the
 * detected speaker Deepgram gave them (spec §3).
 */

export type SpeakerTarget =
  | { kind: 'person'; id: string }
  | { kind: 'new-person'; name: string }
  | { kind: 'speaker'; id: string }

/** Where an action applies: every segment of the identity, or one passage. */
export type ApplyTo = 'speaker' | 'segment' | 'turn'

/** The editor state the actions read and change. Reads see every change at once. */
export type SpeakerStore = {
  transcriptId: string
  speakers(): Speaker[]
  segments(): Seg[]
  people(): EditorPeopleContext
  updateSpeakers(edit: (rows: Speaker[]) => Speaker[]): void
  updateSegments(edit: (rows: Seg[]) => Seg[]): void
  updatePeople(edit: (context: EditorPeopleContext) => EditorPeopleContext): void
}

export type SpeakerUndo = { apply(): void; restore(): void; write(): Promise<void> }

export type SpeakerAction = {
  /** Success toast, e.g. "Identified Speaker 1 as Hamza". */
  done: string
  /** Failure toast, e.g. "Couldn't identify Speaker 1 as Hamza". */
  failed: string
  apply(): void
  restore(): void
  write(): Promise<SpeakerUndo>
}

// Ids for rows shown before the database has created them, and the ids the
// database then gave them. An action queued behind the one that created a row
// was chosen while the row still had its provisional id.
let provisionalCount = 0
const provisionalId = () => `pending-${++provisionalCount}`
const savedIds = new Map<string, string>()

/** The database's id for a row first shown under a provisional id; any other id as is. */
export const savedId = (id: string) => savedIds.get(id) ?? id

function patchSpeaker(store: SpeakerStore, id: string, patch: Partial<Speaker>) {
  store.updateSpeakers((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
}

/** A speaker as the database will create it, shown until it answers. */
function provisionalSpeaker(store: SpeakerStore, patch: Pick<Speaker, 'custom_label' | 'person_id'>): Speaker {
  const speakers = store.speakers()
  const now = new Date().toISOString()
  return {
    id: provisionalId(), transcript_id: store.transcriptId, user_id: speakers[0]?.user_id ?? '',
    ordinal: Math.max(-1, ...speakers.map((speaker) => speaker.ordinal)) + 1,
    diarization_index: null, created_at: now, updated_at: now, ...patch,
  }
}

/** Put the database's row in place, dropping the provisional row it replaces. */
function settleSpeaker(store: SpeakerStore, row: Speaker, replacesId?: string) {
  if (replacesId) savedIds.set(replacesId, row.id)
  store.updateSpeakers((rows) => {
    const rest = rows.filter((existing) => existing.id !== replacesId)
    return rest.some((existing) => existing.id === row.id)
      ? rest.map((existing) => (existing.id === row.id ? row : existing))
      : [...rest, row]
  })
}

function assignSegments(store: SpeakerStore, assignments: readonly SegmentSpeakerAssignment[]) {
  const speakerBySegment = new Map(assignments.map((a) => [a.segment_id, a.speaker_id]))
  store.updateSegments((rows) => rows.map((row) => speakerBySegment.has(row.id)
    ? { ...row, speaker_id: speakerBySegment.get(row.id) ?? null }
    : row))
}

/** The detected speaker Deepgram gave a segment, where Remove sends it. */
export function homeSpeakerId(
  speakers: readonly Speaker[],
  segment: Pick<Seg, 'diarization_index'>
): string | null {
  if (segment.diarization_index === null) return null
  return speakers.find((speaker) => speaker.diarization_index === segment.diarization_index)?.id ?? null
}

/** What Remove would change: each segment not already on its detected speaker. */
export function removalChanges(speakers: readonly Speaker[], segments: readonly Seg[]): SegmentSpeakerChange[] {
  return segments.flatMap((segment) => {
    const home = homeSpeakerId(speakers, segment)
    return home && home !== segment.speaker_id
      ? [{ segment_id: segment.id, expected_speaker_id: segment.speaker_id, speaker_id: home }]
      : []
  })
}

/** Undo for a reassignment: each segment goes back to the speaker it had. */
function reassignUndo(store: SpeakerStore, changes: readonly SegmentSpeakerChange[]): SpeakerUndo {
  const moveTo = (pick: (change: SegmentSpeakerChange) => string | null) =>
    assignSegments(store, changes.map((change) => ({ segment_id: change.segment_id, speaker_id: pick(change) })))
  return {
    apply: () => moveTo((change) => change.expected_speaker_id),
    restore: () => moveTo((change) => change.speaker_id),
    write: async () => assignSegments(store, await reassignSegments(store.transcriptId, changes.map((change) => ({
      segment_id: change.segment_id, expected_speaker_id: change.speaker_id, speaker_id: change.expected_speaker_id,
    })))),
  }
}

/** Move segments to the speakers the changes name, as one guarded write. */
function reassignAction(
  store: SpeakerStore,
  changes: readonly SegmentSpeakerChange[],
  messages: Pick<SpeakerAction, 'done' | 'failed'>
): SpeakerAction {
  const undo = reassignUndo(store, changes)
  return {
    ...messages,
    apply: undo.restore,
    restore: undo.apply,
    async write() {
      assignSegments(store, await reassignSegments(store.transcriptId, [...changes]))
      return undo
    },
  }
}

const findPerson = (store: SpeakerStore, id: string) =>
  store.people().people.find((person) => person.id === id)

function addPerson(store: SpeakerStore, person: EditorPerson) {
  store.updatePeople((context) => ({ ...context, people: [...context.people, person] }))
}

function removePerson(store: SpeakerStore, personId: string) {
  store.updatePeople((context) => ({ ...context, people: context.people.filter((person) => person.id !== personId) }))
}

// A new person has no organisation yet and no appearances elsewhere.
const NEW_PERSON = {
  organisation_name: null, other_transcript_count: 0, last_other_title: null, last_other_seen_at: null,
  in_project: false,
} as const

/** A person as they will look once created, shown while the database works. */
function provisionalPerson(store: SpeakerStore, name: string, userId: string): EditorPerson {
  const now = new Date().toISOString()
  return {
    id: provisionalId(), user_id: userId, name, organisation_id: null,
    preferred_color: leastUsedSpeakerColor(store.people().people), hidden: false,
    created_at: now, updated_at: now, ...NEW_PERSON,
  }
}

/** Replace a provisional person with the one the database created. */
function settlePerson(store: SpeakerStore, replacesId: string, result: PersonCorrectionResult) {
  savedIds.set(replacesId, result.person.id)
  store.updatePeople((context) => ({
    ...context,
    people: [...context.people.filter((row) => row.id !== replacesId), { ...result.person, ...NEW_PERSON }],
  }))
}

/**
 * Move segments to a person (the database reuses or creates their speaker in
 * this transcript) or to another speaker here. `applyTo` 'speaker' moves every
 * segment of the identity, which is how a voice is identified or changed.
 */
export function correctAction(
  store: SpeakerStore,
  { segmentIds, applyTo, target, fromLabel, labelForSpeaker }: {
    segmentIds: ReadonlySet<string>
    applyTo: ApplyTo
    target: SpeakerTarget
    fromLabel: string
    labelForSpeaker: (speakerId: string) => string
  }
): SpeakerAction | null {
  const segments = store.segments().filter((segment) => segmentIds.has(segment.id))
  const changes = segments.map((segment) => ({ segment_id: segment.id, expected_speaker_id: segment.speaker_id }))
  // A target made by an action queued ahead of this one was chosen under its
  // provisional id: find and write it under the saved one, but label it as it
  // was shown when chosen.
  const targetName = target.kind === 'person' ? findPerson(store, savedId(target.id))?.name
    : target.kind === 'new-person' ? target.name
    : store.speakers().some((speaker) => speaker.id === savedId(target.id)) ? labelForSpeaker(target.id)
    : undefined
  if (changes.length === 0 || targetName === undefined) return null

  const detected = new Set(store.speakers().flatMap((speaker) => speaker.diarization_index === null ? [] : [speaker.id]))
  const identifying = segments.every((segment) => segment.speaker_id !== null && detected.has(segment.speaker_id))
  const [done, failed] = applyTo !== 'speaker'
    ? [`Moved this ${applyTo} to ${targetName}`, `Couldn't move this ${applyTo} to ${targetName}`]
    : identifying
      ? [`Identified ${fromLabel} as ${targetName}`, `Couldn't identify ${fromLabel} as ${targetName}`]
      : [`Changed ${fromLabel} to ${targetName}`, `Couldn't change ${fromLabel} to ${targetName}`]

  if (target.kind === 'speaker') {
    const speakerId = savedId(target.id)
    return reassignAction(store, changes.map((change) => ({ ...change, speaker_id: speakerId })), { done, failed })
  }

  // Until the database answers, the segments sit on any speaker already linked
  // to the person here (every such voice displays the same) or on a
  // provisional one.
  const created = target.kind === 'new-person'
    ? provisionalPerson(store, target.name, store.speakers()[0]?.user_id ?? '') : null
  const personId = target.kind === 'person' ? savedId(target.id) : created!.id
  const linked = store.speakers().find((speaker) => speaker.person_id === personId)
  const provisional = linked ? null : provisionalSpeaker(store, { custom_label: null, person_id: personId })
  const shownId = linked?.id ?? provisional!.id
  const moved = (speakerId: string) => changes.map((change) => ({ ...change, speaker_id: speakerId }))
  const shown = reassignUndo(store, moved(shownId))

  return {
    done, failed,
    apply() {
      if (created) addPerson(store, created)
      if (provisional) store.updateSpeakers((rows) => [...rows, provisional])
      shown.restore()
    },
    restore() {
      shown.apply()
      if (provisional) store.updateSpeakers((rows) => rows.filter((row) => row.id !== provisional.id))
      if (created) removePerson(store, created.id)
    },
    async write() {
      const result = await correctSegmentsToPerson(store.transcriptId, changes,
        target.kind === 'person' ? { personId } : { newPersonName: target.name })
      if (created) settlePerson(store, created.id, result)
      settleSpeaker(store, result.speaker, provisional?.id)
      assignSegments(store, result.assignments)
      const undo = reassignUndo(store, moved(result.speaker.id))
      if (target.kind === 'person') return undo
      return {
        ...undo,
        async write() {
          await undoCreatedPerson({
            transcriptId: store.transcriptId, speakerId: result.speaker.id, person: result.person,
            changes: moved(result.speaker.id).map((change) => ({
              segment_id: change.segment_id, expected_speaker_id: change.speaker_id, speaker_id: change.expected_speaker_id,
            })),
          })
          // The correction's speaker stays, unlinked and silent.
          patchSpeaker(store, result.speaker.id, { person_id: null })
          removePerson(store, result.person.id)
        },
      }
    },
  }
}

/**
 * Remove: segments go back to the detected speaker Deepgram gave them. Nothing
 * is invented; a segment already there is left alone.
 */
export function removeAction(
  store: SpeakerStore,
  { segmentIds, applyTo, fromLabel, labelForSpeaker }: {
    segmentIds: ReadonlySet<string>
    applyTo: ApplyTo
    fromLabel: string
    labelForSpeaker: (speakerId: string) => string
  }
): SpeakerAction | null {
  const segments = store.segments().filter((segment) => segmentIds.has(segment.id))
  const changes = removalChanges(store.speakers(), segments)
  if (changes.length === 0) return null
  const homes = [...new Set(changes.map((change) => change.speaker_id!))]
  const where = applyTo === 'speaker' ? '' : ` from this ${applyTo}`
  const back = homes.length === 1 ? ` — back to ${labelForSpeaker(homes[0])}` : ''
  return reassignAction(store, changes, {
    done: `Removed ${fromLabel}${where}${back}`,
    failed: `Couldn't remove ${fromLabel}${where}`,
  })
}

/**
 * Rename in this transcript only. A speaker with a local label is renamed; a
 * detected speaker has no name of its own, so its segments move to a new
 * speaker with the label. A linked speaker shows its person's name instead.
 */
export function renameLocalAction(
  store: SpeakerStore,
  { speakerId, label, segmentIds, fromLabel }: {
    speakerId: string
    label: string
    segmentIds: ReadonlySet<string>
    fromLabel: string
  }
): SpeakerAction | null {
  const speaker = store.speakers().find((row) => row.id === savedId(speakerId))
  if (!speaker || speaker.person_id) return null
  const messages = { done: `Renamed ${fromLabel} to ${label} in this transcript`, failed: `Couldn't rename ${fromLabel} to ${label}` }

  const previous = speaker.custom_label
  if (previous !== null) {
    const setLabel = (value: string) => patchSpeaker(store, speaker.id, { custom_label: value })
    return {
      ...messages,
      apply: () => setLabel(label),
      restore: () => setLabel(previous),
      async write() {
        const saved = await setSpeakerCustomLabel(speaker.id, previous, label)
        settleSpeaker(store, saved)
        const savedLabel = saved.custom_label ?? label
        return {
          apply: () => setLabel(previous),
          restore: () => setLabel(savedLabel),
          write: async () => settleSpeaker(store, await setSpeakerCustomLabel(speaker.id, savedLabel, previous)),
        }
      },
    }
  }

  const changes = store.segments()
    .filter((segment) => segmentIds.has(segment.id))
    .map((segment) => ({ segment_id: segment.id, expected_speaker_id: segment.speaker_id }))
  if (changes.length === 0) return null
  const provisional = provisionalSpeaker(store, { custom_label: label, person_id: null })
  const moved = (id: string) => changes.map((change) => ({ ...change, speaker_id: id }))
  const shown = reassignUndo(store, moved(provisional.id))
  return {
    ...messages,
    apply() {
      store.updateSpeakers((rows) => [...rows, provisional])
      shown.restore()
    },
    restore() {
      shown.apply()
      store.updateSpeakers((rows) => rows.filter((row) => row.id !== provisional.id))
    },
    async write() {
      const result = await createLocalSpeaker(store.transcriptId, label, changes)
      settleSpeaker(store, result.speaker, provisional.id)
      assignSegments(store, result.assignments)
      // Undo moves the segments back; the emptied local speaker stays, hidden.
      return reassignUndo(store, moved(result.speaker.id))
    },
  }
}

/** Rename person everywhere: every linked transcript shows the new name. */
export function renamePersonAction(store: SpeakerStore, personId: string, name: string): SpeakerAction | null {
  const person = findPerson(store, savedId(personId))
  if (!person) return null
  const previous = person.name
  const setName = (value: string) => store.updatePeople((context) => ({
    ...context,
    people: context.people.map((row) => (row.id === person.id ? { ...row, name: value } : row)),
  }))

  return {
    done: `Renamed ${previous} to ${name} everywhere`,
    failed: `Couldn't rename ${previous} to ${name}`,
    apply: () => setName(name),
    restore: () => setName(previous),
    async write() {
      const saved = await renamePerson(person.id, previous, name)
      setName(saved.name)
      return {
        apply: () => setName(previous),
        restore: () => setName(saved.name),
        write: async () => setName((await renamePerson(person.id, saved.name, previous)).name),
      }
    },
  }
}
