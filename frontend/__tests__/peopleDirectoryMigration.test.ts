/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'

const sql = fs.readFileSync(
  path.resolve(__dirname, '../../infra/supabase/migrations/20260926000000_people_directory.sql'),
  'utf8'
).toLowerCase()

function functionDefinition(name: string): string {
  const marker = `create function public.${name}(`
  const start = sql.indexOf(marker)
  if (start === -1) throw new Error(`Missing function definition: ${name}`)
  const next = sql.slice(start + marker.length).search(/create (or replace )?function public\./)
  return next === -1 ? sql.slice(start) : sql.slice(start, start + marker.length + next)
}

// Every function the People pages call, with its argument types.
const DIRECTORY = [
  ['people_directory', ''],
  ['list_person_appearances', 'uuid'],
  ['merge_people_preview', 'uuid, uuid[]'],
  ['create_person', 'text'],
  ['set_person_organisation', 'uuid, uuid, uuid, text'],
  ['set_person_color', 'uuid, text, text'],
  ['set_person_hidden', 'uuid, boolean'],
  ['delete_person', 'uuid'],
  ['remove_person_from_transcript', 'uuid, uuid'],
  ['merge_people', 'uuid, uuid[]'],
  ['rename_organisation', 'uuid, text, text'],
  ['delete_organisation', 'uuid'],
] as const

// Static checks for the security contract only. Behaviour is covered by
// scripts/smoke-test-people-directory.sql against a real database.
describe('People directory migration', () => {
  test('changes no table: people and organisations stay read-only', () => {
    expect(sql).not.toMatch(/\balter table\b/)
    expect(sql).not.toMatch(/\bcreate table\b/)
    expect(sql).not.toMatch(/grant [^;]* on table/)
  })

  test.each(DIRECTORY)('%s is an authenticated, definer-rights function', (name) => {
    const definition = functionDefinition(name)
    expect(definition).toContain('security definer')
    expect(definition).toContain('set search_path = public')
    expect(definition).toContain('auth.uid()')
    expect(definition).toContain("errcode = '42501'")
  })

  test.each(DIRECTORY)('%s filters or checks ownership by the caller', (name) => {
    expect(functionDefinition(name)).toMatch(/user_id = v_user|check_merge_request\(v_user|editor_create_person\(v_user/)
  })

  test('grants execute to authenticated and nothing else', () => {
    const granted = [...sql.matchAll(/grant execute on function public\.(\w+)\(([^)]*)\) to (\w+);/g)]
      .map((match) => [match[1], match[2], match[3]])
    expect(granted).toEqual([
      ...DIRECTORY.map(([name, args]) => [name, args, 'authenticated']),
      ['project_speaker_summaries', 'uuid[], boolean, integer', 'authenticated'],
    ])

    // service_role is not granted: auth.uid() is NULL for it, so it could only
    // fail the authentication check -- or, for the invoker-rights summaries,
    // read every project regardless of owner.
    for (const [name, args] of [...DIRECTORY, ['project_speaker_summaries', 'uuid[], boolean, integer']]) {
      expect(sql).toContain(`revoke all on function public.${name}(${args}) from public, anon, service_role;`)
    }
  })

  test('the shared merge check is internal: invoker rights, granted to no role', () => {
    expect(functionDefinition('check_merge_request')).toContain('security invoker')
    expect(sql).toContain(
      'revoke all on function public.check_merge_request(uuid, uuid, uuid[]) from public, anon, authenticated, service_role;')
    expect(sql).not.toMatch(/grant [^;]* on function public\.check_merge_request\(/)
  })

  test('merge takes the organisation donor in the order given, not by id', () => {
    const definition = functionDefinition('merge_people')
    // Rows are locked in id order to avoid deadlocks...
    expect(definition).toMatch(/order by id for update/)
    // ...but the donor is the first person given who has an organisation.
    expect(definition).toMatch(/from unnest\(p_person_ids\) with ordinality as m\(id, ord\)[\s\S]*order by m\.ord\s+limit 1/)
  })

  test('remove from a transcript goes through the guarded segment helper', () => {
    const definition = functionDefinition('remove_person_from_transcript')
    // Deepgram's assignment: the detected speaker for the segment's number, or
    // Unknown when there is none.
    expect(definition).toContain('home.diarization_index = sg.diarization_index')
    expect(definition).toContain('public.apply_segment_speaker_changes(p_transcript_id, v_changes)')
  })

  test('remove locks the person before reading, so it serialises with merge and delete', () => {
    const definition = functionDefinition('remove_person_from_transcript')
    const lock = definition.indexOf('where id = p_person_id and user_id = v_user for share')
    expect(lock).toBeGreaterThan(-1)
    // The lock comes before the read of the person's segments.
    expect(lock).toBeLessThan(definition.indexOf('select jsonb_agg'))
    // Merge and delete take the conflicting lock on the same row.
    expect(functionDefinition('merge_people')).toContain('for update')
    expect(functionDefinition('delete_person')).toContain('for update')
  })

  test('the summaries stay invoker rights, so RLS does the ownership filtering', () => {
    const start = sql.indexOf('create or replace function public.project_speaker_summaries(')
    const definition = sql.slice(start, sql.indexOf('$$;', start))
    expect(definition).toContain('security invoker')
    expect(definition).not.toContain('security definer')
  })
})
