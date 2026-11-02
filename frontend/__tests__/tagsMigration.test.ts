/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'
import { SPEAKER_COLORS } from '@/lib/speakers/palette'
import { TEXT_LIMITS } from '@/contracts/limits'

const raw = fs.readFileSync(
  path.resolve(__dirname, '../../infra/supabase/migrations/20261101000000_transcript_tags.sql'),
  'utf8'
)
const sql = raw.toLowerCase()

function functionDefinition(name: string): string {
  const marker = `create function public.${name}(`
  const start = sql.indexOf(marker)
  if (start === -1) throw new Error(`Missing function definition: ${name}`)
  const next = sql.slice(start + marker.length).search(/create function public\.|revoke all on function/)
  return next === -1 ? sql.slice(start) : sql.slice(start, start + marker.length + next)
}

// Every function the app calls, with its argument types.
const FUNCTIONS = [
  ['add_transcript_tag', 'uuid, uuid'],
  ['remove_transcript_tag', 'uuid, uuid'],
  ['create_transcript_tag', 'uuid, uuid, text, text'],
  ['undo_created_tag', 'uuid, uuid'],
  ['rename_tag', 'uuid, text, text'],
  ['set_tag_color', 'uuid, text, text'],
  ['delete_tag', 'uuid'],
  ['merge_tags', 'uuid, uuid'],
] as const

// Static checks for the security contract only. Behaviour is covered by
// scripts/smoke-test-tags.sql and scripts/concurrency-test-tags.sh against a
// real database.
describe('transcript tags migration', () => {
  test('never uses auth.uid(), which is NULL under WorkOS', () => {
    expect(sql.replace(/--[^\n]*/g, '')).not.toContain('auth.uid()')
  })

  test('both tables are read-only to signed-in users, behind RLS on the owner', () => {
    expect(sql).toContain('revoke all on table public.tags from public, anon, authenticated;')
    expect(sql).toContain('revoke all on table public.transcript_tags from public, anon, authenticated;')
    expect(sql).toContain('grant select on table public.tags, public.transcript_tags to authenticated;')
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]* on table/)
    for (const table of ['tags', 'transcript_tags']) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`)
    }
    expect(sql.match(/for select to authenticated\s+using \(user_id = \(select public\.current_user_id\(\)\)\);/g))
      .toHaveLength(2)
    expect(sql).not.toMatch(/create policy[^;]* for (insert|update|delete|all)/)
  })

  test('required columns are NOT NULL, and links belong to their transcript and tag owner', () => {
    for (const column of ['user_id uuid not null', 'name text not null', 'color text not null',
      'created_at timestamptz not null', 'updated_at timestamptz not null',
      'transcript_id uuid not null', 'tag_id uuid not null']) {
      expect(sql).toContain(column)
    }
    expect(sql).toMatch(/foreign key \(transcript_id, user_id\)\s+references public\.transcripts \(id, user_id\) on delete cascade/)
    expect(sql).toMatch(/foreign key \(tag_id, user_id\)\s+references public\.tags \(id, user_id\) on delete cascade/)
    expect(sql).toContain('create unique index tags_user_name_unique on public.tags (user_id, lower(name));')
  })

  test('names follow TEXT_LIMITS.tagName and colours the speaker palette', () => {
    expect(sql).toContain(`char_length(name) between 1 and ${TEXT_LIMITS.tagName}`)
    expect(sql).toContain('color = any (public.speaker_palette())')
    expect(SPEAKER_COLORS).toHaveLength(10)
  })

  test.each(FUNCTIONS)('%s is an authenticated, definer-rights function', (name) => {
    const definition = functionDefinition(name)
    expect(definition).toContain('security definer')
    expect(definition).toContain('set search_path = public')
    expect(definition).toContain('v_user uuid := (select public.current_user_id());')
    expect(definition).toContain("errcode = '42501'")
  })

  test.each(FUNCTIONS)('%s checks ownership by the caller', (name) => {
    expect(functionDefinition(name)).toMatch(/user_id = v_user/)
  })

  test('grants execute to authenticated and nothing else', () => {
    const granted = [...sql.matchAll(/grant execute on function public\.(\w+)\(([^)]*)\) to (\w+);/g)]
      .map((match) => [match[1], match[2], match[3]])
    expect(granted).toEqual(FUNCTIONS.map(([name, args]) => [name, args, 'authenticated']))
    for (const [name, args] of FUNCTIONS) {
      expect(sql).toContain(`revoke all on function public.${name}(${args}) from public, anon, service_role;`)
    }
  })

  test('rename and recolour recognise their own result before checking what they expected', () => {
    for (const [name, field] of [['rename_tag', 'name'], ['set_tag_color', 'color']] as const) {
      const definition = functionDefinition(name)
      const recognised = definition.indexOf(`if v_tag.${field} = `)
      const guarded = definition.indexOf(`if v_tag.${field} is distinct from p_expected_`)
      expect(recognised).toBeGreaterThan(-1)
      expect(guarded).toBeGreaterThan(recognised)
    }
  })

  test('merge locks both tags in id order and refuses merging a tag into itself', () => {
    const definition = functionDefinition('merge_tags')
    expect(definition).toContain('p_from = p_into')
    expect(definition).toMatch(/for v_id in select unnest\(array\[p_from, p_into\]\) order by 1 loop/)
  })

  test('create retries a vanished namesake a bounded number of times', () => {
    const definition = functionDefinition('create_transcript_tag')
    expect(definition).toContain('for v_try in 1..3 loop')
    expect(definition).toContain('on conflict do nothing')
    expect(definition).toContain("errcode = 'sp002'")
    // A name lookup that finds the requested id is an overlapping resend of this create.
    expect(definition).toContain("case when v_tag.id = p_tag_id then 'own' else 'adopted' end")
  })
})
