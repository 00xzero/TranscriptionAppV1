/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'

const sql = fs.readFileSync(
  path.resolve(__dirname, '../../infra/supabase/migrations/20261013120000_editor_history_guards.sql'),
  'utf8'
).toLowerCase()
// One line per statement, for statements written across several.
const flat = sql.replace(/\s+/g, ' ')

/** The body of one function, from its CREATE to the closing $$. */
function body(name: string): string {
  const start = sql.search(new RegExp(`create (or replace )?function public\\.${name}\\(`))
  expect(start).toBeGreaterThanOrEqual(0)
  const end = sql.indexOf('$$;', start)
  return sql.slice(start, end)
}

// Static checks for the security contract and the resend rules only.
// Behaviour is checked against a real database as `authenticated`: every
// write called twice, and every write resent after a change made elsewhere.
describe('Editor history migration', () => {
  test('keeps no log of writes', () => {
    expect(sql).not.toContain('create table')
    expect(sql).not.toContain('execute_editor_write')
    expect(sql).not.toContain('receipt')
  })

  test.each([
    ['split_segment', 'definer'],
    ['rejoin_segments', 'definer'],
    ['create_local_speaker', 'definer'],
    ['correct_segments_to_person', 'definer'],
    ['rename_person_guarded', 'definer'],
    ['set_speaker_custom_label', 'definer'],
    ['undo_created_person_action', 'definer'],
    ['restore_created_person', 'definer'],
    ['set_segment_texts_guarded', 'invoker'],
    ['update_transcript_title_guarded', 'invoker'],
    ['apply_segment_speaker_changes', 'invoker'],
    ['create_transcript_speaker', 'invoker'],
  ])('%s runs as %s with a fixed search_path and checks the caller', (name, mode) => {
    const fn = body(name)
    expect(fn).toContain(`security ${mode}`)
    expect(fn).toMatch(/set search_path = (''|public)/)
    expect(fn).toMatch(/auth\.uid\(\)|require_completed_transcript/)
  })

  test.each([
    ['split_segment(uuid, integer, uuid, text, text, uuid, text, uuid)'],
    ['rejoin_segments(uuid, integer, uuid, integer, uuid, text, text, text, uuid, uuid)'],
    ['set_segment_texts_guarded(jsonb)'],
    ['update_transcript_title_guarded(uuid, text, text)'],
    ['create_local_speaker(uuid, text, jsonb, uuid)'],
    ['correct_segments_to_person(uuid, jsonb, uuid, text, uuid)'],
    ['undo_created_person_action(uuid, uuid, text, text, uuid, jsonb)'],
    ['restore_created_person(uuid, uuid, text, text, uuid, jsonb)'],
  ])('%s is callable by signed-in users only', (signature) => {
    expect(flat).toContain(`revoke all on function public.${signature} from public, anon, service_role;`)
    expect(flat).toContain(`grant execute on function public.${signature} to authenticated;`)
  })

  test.each([
    ['create_transcript_speaker(uuid, uuid, text, uuid)'],
    ['editor_create_person(uuid, text, uuid)'],
  ])('internal helper %s is callable by no Data API role', (signature) => {
    expect(flat).toContain(`revoke all on function public.${signature} from public, anon, authenticated, service_role;`)
    expect(flat).not.toContain(`grant execute on function public.${signature}`)
  })

  test('the person helper runs as its caller, a definer function that checked the user', () => {
    const fn = body('editor_create_person')
    expect(fn).toContain('security invoker')
    expect(fn).toContain('coalesce(p_person_id, gen_random_uuid())')
  })

  test('each write recognises its own earlier success', () => {
    // Text and title: the new value already there passes.
    expect(body('set_segment_texts_guarded')).toContain("sg.text = v_edit->>'expected_text' or sg.text = v_edit->>'text'")
    expect(body('update_transcript_title_guarded')).toContain('title is not distinct from p_title')
    // Speaker changes: a segment already on its target passes; the revision must still match.
    const changes = body('apply_segment_speaker_changes')
    expect(changes).toContain('sg.speaker_id is distinct from c.expected_speaker_id\n      and sg.speaker_id is distinct from c.speaker_id')
    expect(changes).toContain('sg.revision <> c.expected_revision')
    // Renames: already holding the new name or label is done.
    expect(body('rename_person_guarded')).toContain('if v_person.name = v_name then return v_person; end if;')
    expect(body('set_speaker_custom_label')).toContain('v_speaker.custom_label = v_label then return v_speaker; end if;')
  })

  test('a structural replay counts only while the segments hold what it wrote', () => {
    const split = body('split_segment')
    expect(split).toContain('v_segment.text is not distinct from p_first_text')
    expect(split).toContain('v_new.text is not distinct from p_second_text')
    expect(split).toContain('v_new.speaker_id is not distinct from p_expected_speaker_id')
    const rejoin = body('rejoin_segments')
    expect(rejoin).toContain('v_first.text is not distinct from p_text')
    expect(rejoin).toContain('v_first.speaker_id is not distinct from p_expected_speaker_id')
  })

  test('a person found already made is adopted only while untouched since', () => {
    const correct = body('correct_segments_to_person')
    expect(correct).toContain('v_person.updated_at <> v_person.created_at')
    expect(correct).toContain("raise exception 'person id is already in use' using errcode = 'sp003'")
    const restore = body('restore_created_person')
    expect(restore).toContain('v_person.updated_at <> v_person.created_at')
    expect(restore).toContain('v_person.preferred_color is distinct from p_preferred_color')
  })

  test('undo of a new person guards on the person, not a timestamp', () => {
    const undo = body('undo_created_person_action')
    expect(undo).not.toContain('updated_at')
    expect(undo).toContain('v_person.name is distinct from p_expected_name')
    expect(undo).toContain('v_person.preferred_color is distinct from p_expected_color')
    expect(undo).toContain('v_person.organisation_id is not null or v_person.hidden')
  })

  test('every resend that answers without writing still checks segment revisions', () => {
    // The undo of a new person answers a resend itself, without the speaker
    // helper's revision check, so it checks revisions on its own.
    expect(body('undo_created_person_action')).toContain('sg.revision is distinct from c.expected_revision')
  })
})
