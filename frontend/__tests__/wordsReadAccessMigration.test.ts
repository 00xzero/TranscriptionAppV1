/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'

const sql = fs.readFileSync(
  path.resolve(__dirname, '../../infra/supabase/migrations/20261012120000_words_read_access.sql'),
  'utf8'
).toLowerCase()

// Static checks for the security contract only. Behaviour is checked against a
// real database with SET ROLE authenticated (see the slice's verification).
describe('Words read access migration', () => {
  test('signed-in users may read words and nothing more', () => {
    expect(sql).toContain('grant select on table public.words to authenticated;')
    expect(sql).toContain('revoke insert, update, delete on table public.words from authenticated;')
    expect(sql).not.toMatch(/grant [^;]*(insert|update|delete)[^;]*on table public\.words/)
  })

  test('replaces the FOR ALL policy with a SELECT-only one', () => {
    expect(sql).toContain('drop policy "users can access own transcript words" on public.words;')
    expect(sql).toMatch(/create policy "users can read own transcript words"\s+on public\.words for select to authenticated/)
    expect(sql).not.toMatch(/create policy[^;]*for (all|insert|update|delete)/)
  })

  test('scopes rows to the caller through their transcripts', () => {
    expect(sql).toContain('join public.transcripts as t on t.id = s.transcript_id')
    expect(sql).toContain('where t.user_id = (select auth.uid())')
  })
})
