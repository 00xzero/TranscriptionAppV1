import {
  correctSegmentsToPerson,
  createLocalSpeaker,
  reassignSegments,
  renamePerson,
  restoreCreatedPerson,
  setSpeakerCustomLabel,
  undoCreatedPerson,
} from '@/lib/supabase/queries'
import { leastUsedSpeakerColor } from '@/lib/speakers/palette'
import { reverseSpeakerChange, speakerChangeFrom } from '@/core/speakers/changes'
import { randomUuid } from '@/lib/ids'
import type { Send } from '@/lib/editor/untilAnswered'
import { changedSince } from '@/lib/people/errors'
import type {
  EditorPeopleContext,
  EditorPerson,
  NewSpeakerSegmentChange,
  PersonCorrectionResult,
  SegmentSpeakerAssignment,
  SegmentSpeakerChange,
  Speaker,
} from '@/contracts/db'
import type { Seg } from '../types'
import { revisionsMatch } from '../utils'

/**
 * Editor speaker actions (spec §5–§7). Each one applies optimistically, writes
 * with one guarded database call, settles local state from that call's result
 * and returns the op that undoes it; every op's write returns the op that
 * reverses it again, so undo and redo alternate for as long as the history
 * keeps the step. A builder returns null when the state it was asked to change
 * is gone, which the editor treats like a refused write; RESHAPED when a
 * segment it was chosen for has been split or rejoined since; and UNCHANGED
 * when it would change nothing, such as a rename to the same name.
 *
 * Every write is built in full before it is sent, so a resend after a lost
 * answer is the same request; the database recognises one it already made.
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
  /** Sends a write until the database answers it. */
  send: Send
  speakers(): Speaker[]
  segments(): Seg[]
  people(): EditorPeopleContext
  updateSpeakers(edit: (rows: Speaker[]) => Speaker[]): void
  updateSegments(edit: (rows: Seg[]) => Seg[]): void
  updatePeople(edit: (context: EditorPeopleContext) => EditorPeopleContext): void
}

/** One direction of a step: shown at once, written once, answering with the op that reverses it. */
export type SpeakerOp = { apply(): void; restore(): void; write(): Promise<SpeakerOp> }

/** Shows an op, then writes it, putting it back if the write fails. Resolves to the op that reverses it. */
export async function runOp(op: SpeakerOp, applied?: () => void): Promise<SpeakerOp> {
  op.apply()
  applied?.()
  try { return await op.write() } catch (error) { op.restore(); throw error }
}

export const RESHAPED = 'reshaped'
export const UNCHANGED = 'unchanged'

/**
 * The segments an action was chosen for, as they are now; RESHAPED if any has
 * been split, rejoined or removed since it was chosen. An action runs after
 * the writes queued ahead of it, and applied to part of a segment chosen
 * whole, it would do less than was asked.
 */
function chosenNow(store: SpeakerStore, chosen: readonly Seg[]): Seg[] | typeof RESHAPED {
  if (!revisionsMatch(store.segments(), chosen)) return RESHAPED
  const ids = new Set(chosen.map((segment) => segment.id))
  return store.segments().filter((segment) => ids.has(segment.id))
}

export type SpeakerAction = SpeakerOp & {
  /** Failure toast, e.g. "Couldn't identify Speaker 1 as Hamza". */
  failed: string
}

// Ids for rows shown before the database has created them, and the ids the
// database then gave them. An action queued behind the one that created a row
// was chosen while the row still had its provisional id. A new person or local
// speaker takes the id the editor chose, so only a person's speaker, which the
// database makes, needs this.
let provisionalCount = 0
const provisionalId = () => `pending-${++provisionalCount}`
const savedIds = new Map<string, string>()

/** The database's id for a row first shown under a provisional id; any other id as is. */
export const savedId = (id: string) => savedIds.get(id) ?? id

function patchSpeaker(store: SpeakerStore, id: string, patch: Partial<Speaker>) {
  store.updateSpeakers((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
}

/** A speaker as the database will create it, shown until it answers. */
function provisionalSpeaker(store: SpeakerStore, patch: Pick<Speaker, 'custom_label' | 'person_id'>, id = provisionalId()): Speaker {
  const speakers = store.speakers()
  const now = new Date().toISOString()
  return {
    id, transcript_id: store.transcriptId, user_id: speakers[0]?.user_id ?? '',
    ordinal: Math.max(-1, ...speakers.map((speaker) => speaker.ordinal)) + 1,
    diarization_index: null, created_at: now, updated_at: now, ...patch,
  }
}

/** Put the database's row in place, dropping the provisional row it replaces. */
function settleSpeaker(store: SpeakerStore, row: Speaker, replacesId?: string) {
  if (replacesId && replacesId !== row.id) savedIds.set(replacesId, row.id)
  store.updateSpeakers((rows) => {
    const rest = replacesId && replacesId !== row.id ? rows.filter((existing) => existing.id !== replacesId) : rows
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

/**
 * Where Remove sends a segment: the detected speaker Deepgram gave it, or null
 * (Unknown) when Deepgram gave it no number. Undefined when a numbered
 * segment's detected speaker is missing, which the database's foreign key
 * rules out; such a segment is left alone rather than blanked to Unknown.
 */
function homeSpeakerId(
  speakers: readonly Speaker[],
  segment: Pick<Seg, 'diarization_index'>
): string | null | undefined {
  if (segment.diarization_index === null) return null
  return speakers.find((speaker) => speaker.diarization_index === segment.diarization_index)?.id
}

/** What Remove would change: each segment not on Deepgram's original assignment. */
export function removalChanges(speakers: readonly Speaker[], segments: readonly Seg[]): SegmentSpeakerChange[] {
  return segments.flatMap((segment) => {
    const home = homeSpeakerId(speakers, segment)
    return home !== undefined && home !== segment.speaker_id
      ? [{ ...speakerChangeFrom(segment), speaker_id: home }]
      : []
  })
}

const segmentsById = (store: SpeakerStore) => new Map(store.segments().map((segment) => [segment.id, segment]))

/**
 * Fill in each change's revision from the segments as they are now: split and
 * rejoin raise it, and the history runs a step only once every later split has
 * been undone, so the segment has the shape the change was chosen for. A
 * segment that is gone has changed elsewhere.
 */
function withRevisionsNow<T extends { segment_id: string }>(store: SpeakerStore, changes: readonly T[]): (T & { expected_revision: number })[] {
  const segments = segmentsById(store)
  return changes.map((change) => {
    const segment = segments.get(change.segment_id)
    if (!segment) throw changedSince('A segment changed since')
    return { ...change, expected_revision: segment.revision }
  })
}

/** Throws unless every segment still shows the speaker the step left it on. */
function expectSpeakers(store: SpeakerStore, changes: readonly SegmentSpeakerChange[]) {
  const segments = segmentsById(store)
  if (changes.some((change) => segments.get(change.segment_id)?.speaker_id !== change.speaker_id)) {
    throw changedSince('A segment changed since')
  }
}

/** Moves segments to the speakers the changes name, as one guarded write, and back again. */
function reassignOp(store: SpeakerStore, changes: readonly SegmentSpeakerChange[]): SpeakerOp {
  const moveTo = (pick: (change: SegmentSpeakerChange) => string | null) =>
    assignSegments(store, changes.map((change) => ({ segment_id: change.segment_id, speaker_id: pick(change) })))
  return {
    apply() {
      expectSpeakers(store, changes.map(reverseSpeakerChange))
      moveTo((change) => change.speaker_id)
    },
    restore: () => moveTo((change) => change.expected_speaker_id),
    async write() {
      const request = withRevisionsNow(store, changes)
      assignSegments(store, await store.send(() => reassignSegments(store.transcriptId, request)))
      return reassignOp(store, changes.map(reverseSpeakerChange))
    },
  }
}

const findPerson = (store: SpeakerStore, id: string) =>
  store.people().people.find((person) => person.id === id)

function addPerson(store: SpeakerStore, person: EditorPerson) {
  store.updatePeople((context) => ({ ...context, people: [...context.people.filter((row) => row.id !== person.id), person] }))
}

function removePerson(store: SpeakerStore, personId: string) {
  store.updatePeople((context) => ({ ...context, people: context.people.filter((person) => person.id !== personId) }))
}

// A new person has no organisation yet and no appearances elsewhere.
const NEW_PERSON = {
  organisation_name: null, other_transcript_count: 0, last_other_title: null, last_other_seen_at: null,
  in_project: false,
} as const

/** A person as they will look once created, under the id the editor chose for them. */
function provisionalPerson(store: SpeakerStore, name: string, userId: string): EditorPerson {
  const now = new Date().toISOString()
  return {
    id: randomUuid(), user_id: userId, name, organisation_id: null,
    preferred_color: leastUsedSpeakerColor(store.people().people), hidden: false,
    created_at: now, updated_at: now, ...NEW_PERSON,
  }
}

/** Put the person the database created (or restored) in place of the one shown. */
function settlePerson(store: SpeakerStore, result: PersonCorrectionResult, replacesId?: string) {
  store.updatePeople((context) => ({
    ...context,
    people: [...context.people.filter((row) => row.id !== result.person.id && row.id !== replacesId), { ...result.person, ...NEW_PERSON }],
  }))
}

/**
 * Undo and redo of a correction that created a person. Undo moves the segments
 * back and deletes the person, refused unless the person still has the name
 * and colour they were created with; redo brings them back under the same id,
 * relinking the speaker the undo left silent.
 */
function createdPersonOp(store: SpeakerStore, created: PersonCorrectionResult['person'], speakerId: string,
  changes: readonly NewSpeakerSegmentChange[], remove: boolean): SpeakerOp {
  const person = { id: created.id, name: created.name, preferred_color: created.preferred_color }
  const forward: SegmentSpeakerChange[] = changes.map((change) => ({ ...change, speaker_id: speakerId }))
  const move = reassignOp(store, remove ? forward.map(reverseSpeakerChange) : forward)
  return {
    apply() {
      move.apply()
      if (remove) return
      addPerson(store, { ...created, ...NEW_PERSON })
      patchSpeaker(store, speakerId, { person_id: person.id })
    },
    restore() {
      move.restore()
      if (remove) return
      removePerson(store, person.id)
      patchSpeaker(store, speakerId, { person_id: null })
    },
    async write() {
      if (remove) {
        const request = { transcriptId: store.transcriptId, speakerId, person, changes: withRevisionsNow(store, forward.map(reverseSpeakerChange)) }
        await store.send(() => undoCreatedPerson(request))
        // The correction's speaker stays, unlinked and silent.
        patchSpeaker(store, speakerId, { person_id: null })
        removePerson(store, person.id)
      } else {
        const request = { transcriptId: store.transcriptId, person, speakerId, changes: withRevisionsNow(store, changes) }
        const restored = await store.send(() => restoreCreatedPerson(request))
        settlePerson(store, restored)
        settleSpeaker(store, restored.speaker)
        assignSegments(store, restored.assignments)
      }
      return createdPersonOp(store, created, speakerId, changes, !remove)
    },
  }
}

/**
 * Move segments to a person (the database reuses or creates their speaker in
 * this transcript) or to another speaker here. `applyTo` 'speaker' moves every
 * segment of the identity, which is how a voice is identified or changed.
 */
export function correctAction(
  store: SpeakerStore,
  { chosen, applyTo, target, fromLabel, labelForSpeaker }: {
    /** The segments as they were shown when chosen. */
    chosen: readonly Seg[]
    applyTo: ApplyTo
    target: SpeakerTarget
    fromLabel: string
    labelForSpeaker: (speakerId: string) => string
  }
): SpeakerAction | typeof RESHAPED | null {
  const segments = chosenNow(store, chosen)
  if (segments === RESHAPED) return RESHAPED
  const changes = segments.map(speakerChangeFrom)
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
  const failed = applyTo !== 'speaker' ? `Couldn't move this ${applyTo} to ${targetName}`
    : identifying ? `Couldn't identify ${fromLabel} as ${targetName}` : `Couldn't change ${fromLabel} to ${targetName}`

  if (target.kind === 'speaker') {
    const speakerId = savedId(target.id)
    return { failed, ...reassignOp(store, changes.map((change) => ({ ...change, speaker_id: speakerId }))) }
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
  const shown = changes.map((change) => ({ segment_id: change.segment_id, from: change.expected_speaker_id }))
  const showOn = (speakerOf: (from: string | null) => string | null) =>
    assignSegments(store, shown.map(({ segment_id, from }) => ({ segment_id, speaker_id: speakerOf(from) })))
  const request = target.kind === 'person' ? { personId } : { newPersonName: target.name, newPersonId: created!.id }

  return {
    failed,
    apply() {
      if (created) addPerson(store, created)
      if (provisional) store.updateSpeakers((rows) => [...rows, provisional])
      showOn(() => shownId)
    },
    restore() {
      showOn((from) => from)
      if (provisional) store.updateSpeakers((rows) => rows.filter((row) => row.id !== provisional.id))
      if (created) removePerson(store, created.id)
    },
    async write() {
      const result = await store.send(() => correctSegmentsToPerson(store.transcriptId, changes, request))
      if (created) settlePerson(store, result, created.id)
      settleSpeaker(store, result.speaker, provisional?.id)
      assignSegments(store, result.assignments)
      if (target.kind === 'person') {
        return reassignOp(store, changes.map((change) => reverseSpeakerChange({ ...change, speaker_id: result.speaker.id })))
      }
      return createdPersonOp(store, result.person, result.speaker.id, changes, true)
    },
  }
}

/**
 * Remove: segments go back to Deepgram's assignment, including Unknown when
 * Deepgram gave no number. A segment already there is left alone.
 */
export function removeAction(
  store: SpeakerStore,
  { chosen, applyTo, fromLabel }: {
    chosen: readonly Seg[]
    applyTo: ApplyTo
    fromLabel: string
  }
): SpeakerAction | typeof RESHAPED | null {
  const segments = chosenNow(store, chosen)
  if (segments === RESHAPED) return RESHAPED
  const changes = removalChanges(store.speakers(), segments)
  if (changes.length === 0) return null
  const where = applyTo === 'speaker' ? '' : ` from this ${applyTo}`
  return { failed: `Couldn't remove ${fromLabel}${where}`, ...reassignOp(store, changes) }
}

/**
 * Sets a name, guarded by the one it replaces, and back again: shown only
 * while what is shown is still `expected`, written expecting it too.
 */
function renameOp(read: () => string | null | undefined, show: (value: string) => void,
  save: (expected: string, value: string) => Promise<string>, expected: string, value: string): SpeakerOp {
  return {
    apply() {
      if (read() !== expected) throw changedSince('The name changed since')
      show(value)
    },
    restore: () => show(expected),
    async write() { return renameOp(read, show, save, await save(expected, value), expected) },
  }
}

/**
 * Rename in this transcript only. A speaker with a local label is renamed; a
 * detected speaker has no name of its own, so its segments move to a new
 * speaker with the label. A linked speaker shows its person's name instead.
 */
export function renameLocalAction(
  store: SpeakerStore,
  { speakerId, label, chosen, fromLabel }: {
    speakerId: string
    label: string
    /** The speaker's segments as they were shown when chosen. */
    chosen: readonly Seg[]
    fromLabel: string
  }
): SpeakerAction | typeof RESHAPED | typeof UNCHANGED | null {
  const speaker = store.speakers().find((row) => row.id === savedId(speakerId))
  if (!speaker || speaker.person_id) return null
  const messages = { failed: `Couldn't rename ${fromLabel} to ${label}` }

  const previous = speaker.custom_label
  if (previous !== null) {
    if (previous === label) return UNCHANGED
    const read = () => store.speakers().find((s) => s.id === speaker.id)?.custom_label
    const show = (value: string) => patchSpeaker(store, speaker.id, { custom_label: value })
    const save = async (expected: string, value: string) => {
      const row = await store.send(() => setSpeakerCustomLabel(speaker.id, expected, value))
      settleSpeaker(store, row)
      return row.custom_label ?? value
    }
    return { ...messages, ...renameOp(read, show, save, previous, label) }
  }

  // Naming a detected speaker moves its segments; renaming a label does not.
  const segments = chosenNow(store, chosen)
  if (segments === RESHAPED) return RESHAPED
  const changes = segments.map(speakerChangeFrom)
  if (changes.length === 0) return null
  // The new speaker takes the id chosen here, so a resend finds the one it made.
  const provisional = provisionalSpeaker(store, { custom_label: label, person_id: null }, randomUuid())
  const moved: SegmentSpeakerChange[] = changes.map((change) => ({ ...change, speaker_id: provisional.id }))
  return {
    ...messages,
    apply() {
      store.updateSpeakers((rows) => [...rows, provisional])
      assignSegments(store, moved.map(({ segment_id, speaker_id }) => ({ segment_id, speaker_id })))
    },
    restore() {
      assignSegments(store, moved.map(({ segment_id, expected_speaker_id }) => ({ segment_id, speaker_id: expected_speaker_id })))
      store.updateSpeakers((rows) => rows.filter((row) => row.id !== provisional.id))
    },
    async write() {
      const result = await store.send(() => createLocalSpeaker(store.transcriptId, label, changes, provisional.id))
      settleSpeaker(store, result.speaker, provisional.id)
      assignSegments(store, result.assignments)
      // Undo moves the segments back; the emptied local speaker stays, hidden,
      // and a redo moves them to it again.
      return reassignOp(store, moved.map(reverseSpeakerChange))
    },
  }
}

/** Rename person everywhere: every linked transcript shows the new name. */
export function renamePersonAction(store: SpeakerStore, personId: string, name: string): SpeakerAction | typeof UNCHANGED | null {
  const person = findPerson(store, savedId(personId))
  if (!person) return null
  if (person.name === name) return UNCHANGED
  const id = person.id
  const show = (value: string) => store.updatePeople((context) => ({ ...context,
    people: context.people.map((row) => row.id === id ? { ...row, name: value } : row) }))
  const save = async (expected: string, value: string) => {
    const row = await store.send(() => renamePerson(id, expected, value))
    store.updatePeople((context) => ({ ...context, people: context.people.map((p) => p.id === row.id ? { ...p, ...row } : p) }))
    return row.name
  }
  return { failed: `Couldn't rename ${person.name}`, ...renameOp(() => findPerson(store, id)?.name, show, save, person.name, name) }
}
