/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(
  __dirname,
  '../../infra/supabase/migrations/20260924000000_speaker_identity_foundations.sql'
)
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase()

function functionDefinition(name: string): string {
  const marker = `create or replace function public.${name}(`
  const start = sql.indexOf(marker)
  if (start === -1) throw new Error(`Missing function definition: ${name}`)
  const next = sql.indexOf('create or replace function public.', start + marker.length)
  return sql.slice(start, next === -1 ? sql.length : next)
}

const GUARDED = [
  ['set_speaker_custom_label', 'uuid, text, text'],
  ['reassign_segments', 'uuid, jsonb'],
  ['assign_segments_to_new_speaker', 'uuid, text, jsonb'],
] as const

const INTERNAL = [
  ['create_transcript_speaker', 'uuid, uuid, text'],
  ['apply_segment_speaker_changes', 'uuid, jsonb'],
] as const

// Static checks for the security contract only: who may call what, and which
// write paths are closed. Behaviour (parsing, guards, ordinals) is covered by
// scripts/smoke-test-speakers.sql against a real database.
describe('speaker identity foundations migration', () => {
  test('enforces ownership and same-transcript references with composite keys', () => {
    expect(sql).toContain('add constraint transcripts_id_user_unique unique (id, user_id)')
    expect(sql).toMatch(
      /foreign key \(transcript_id, user_id\)\s+references public\.transcripts \(id, user_id\)\s+on delete cascade/
    )
    expect(sql).toMatch(
      /foreign key \(transcript_id, speaker_id\)\s+references public\.speakers \(transcript_id, id\)\s+on delete set null \(speaker_id\)/
    )
  })

  test('drops the label, its uniqueness, and the unused color', () => {
    expect(sql).toContain('drop constraint if exists speakers_transcript_id_label_unique')
    expect(sql).toMatch(/drop column label,\s+drop column color/)
  })

  test('makes speakers read-only and segment speakers writable only through functions', () => {
    expect(sql).toContain('revoke insert, update, delete on table public.speakers from authenticated')
    expect(sql).toContain('revoke update on table public.segments from authenticated')
    expect(sql).toContain('grant update (text, is_edited) on table public.segments to authenticated')
    expect(sql).toMatch(/on public\.speakers for select\s+to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)/)
  })

  test.each(GUARDED)('%s is an authenticated, definer-rights function', (name) => {
    const definition = functionDefinition(name)
    expect(definition).toContain('security definer')
    expect(definition).toContain('set search_path = public')
    expect(definition).toContain('auth.uid()')
    expect(definition).toContain("errcode = '42501'")
  })

  test.each(INTERNAL)('%s runs with invoker rights', (name) => {
    expect(functionDefinition(name)).toContain('security invoker')
  })

  test('grants execute on the guarded functions to authenticated and nothing else', () => {
    const granted = [...sql.matchAll(/grant execute on function public\.(\w+)\(([^)]*)\) to (\w+);/g)]
      .map((match) => [match[1], match[3]])
      .filter(([name]) => name !== 'save_transcript_segments' && name !== 'project_speaker_summaries')
    expect(granted).toEqual(GUARDED.map(([name]) => [name, 'authenticated']))

    for (const [name, args] of GUARDED) {
      for (const role of ['public', 'anon', 'service_role']) {
        expect(sql).toContain(`revoke all on function public.${name}(${args}) from ${role};`)
      }
    }
  })

  test('never grants the internal helpers to any role', () => {
    for (const [name, args] of INTERNAL) {
      expect(sql).not.toMatch(new RegExp(`grant [^;]* on function public\\.${name}\\(`))
      for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
        expect(sql).toContain(`revoke all on function public.${name}(${args}) from ${role};`)
      }
    }
  })
})
