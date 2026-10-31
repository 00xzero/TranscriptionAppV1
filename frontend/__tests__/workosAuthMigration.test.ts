/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'

const raw = fs.readFileSync(
  path.resolve(__dirname, '../../infra/supabase/migrations/20261023120000_workos_auth.sql'),
  'utf8'
)
const sql = raw.toLowerCase()
// The migration without its comments, so prose cannot satisfy a check.
const code = sql.replace(/--[^\n]*/g, '')

// Static checks for the security contract only. Behaviour is checked against a
// real database (SET ROLE, request.jwt.claims) in the smoke scripts.
describe('WorkOS auth migration', () => {
  test('nothing still reads auth.uid()', () => {
    // Quoted text aside: the final check names auth.uid() in its patterns.
    expect(code.replace(/'[^']*'/g, "''")).not.toContain('auth.uid()')
  })

  test('current_user_id resolves the token subject through app_users, for signed-in callers only', () => {
    expect(code).toMatch(
      /create function public\.current_user_id\(\)\s+returns uuid\s+language sql\s+stable\s+security definer\s+set search_path = ''/
    )
    expect(code).toContain("where workos_user_id = (select auth.jwt() ->> 'sub')")
    expect(code).toContain('revoke execute on function public.current_user_id() from public, anon;')
    expect(code).toContain('grant execute on function public.current_user_id() to authenticated, service_role;')
  })

  test('app_users is read-only for its owner; only the service role writes', () => {
    expect(code).toContain('revoke all on public.app_users from public, anon, authenticated, service_role;')
    expect(code).toContain('grant select on public.app_users to authenticated;')
    expect(code).toContain('grant select, insert, update on public.app_users to service_role;')
    expect(code).not.toMatch(/grant [^;]*(insert|update|delete)[^;]*on public\.app_users to authenticated/)
    expect(code).toMatch(/create policy "users can read own app user" on public\.app_users\s+for select\s+to authenticated/)
  })

  test('existing owners keep their ids, unlinked', () => {
    expect(code).toContain('insert into public.app_users (id, created_at)\nselect id, created_at from auth.users;')
  })

  test('owner foreign keys point at app_users', () => {
    for (const table of ['transcripts', 'projects', 'organisations', 'people']) {
      expect(code).toContain(
        `add constraint ${table}_user_id_fkey\n    foreign key (user_id) references public.app_users(id) on delete cascade;`
      )
    }
    expect(code).not.toContain('references auth.users')
  })

  test('recreates the storage and realtime policies, not only public ones', () => {
    expect(code).toContain('create policy "users can upload to own folder" on storage.objects')
    expect(code).toContain('create policy "users can read own waveforms" on storage.objects')
    expect(code).toContain(
      'create policy "users can receive own projects v1 delete invalidations" on realtime.messages'
    )
  })

  test('ends by refusing to apply while any policy or function still uses auth.uid()', () => {
    expect(code).toMatch(/where schemaname in \('public', 'storage', 'realtime'\)/)
    expect(code).toContain("raise exception 'auth.uid() is still used by: %'")
  })
})
