/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'

const sql = fs.readFileSync(
  path.resolve(__dirname, '../../infra/supabase/migrations/20261017000000_project_people.sql'),
  'utf8'
).toLowerCase()

// Static checks for the security contract only. Behaviour is covered by
// scripts/smoke-test-project-people.sql against a real database.
describe('Project people migration', () => {
  test('changes no table', () => {
    expect(sql).not.toMatch(/\balter table\b/)
    expect(sql).not.toMatch(/\bcreate table\b/)
    expect(sql).not.toMatch(/\b(insert into|update public\.|delete from)\b/)
  })

  test('is an authenticated, definer-rights read that checks the caller owns the project', () => {
    expect(sql).toContain('create function public.project_people(p_project_id uuid)')
    expect(sql).toContain('stable security definer set search_path = public')
    expect(sql).toContain("errcode = '42501'")
    expect(sql).toMatch(/where id = p_project_id and user_id = v_user and deleting_at is null/)
    expect(sql).toContain("errcode = 'sp001'")
  })

  test('every table it reads past the project check is filtered to the caller', () => {
    expect(sql).toContain('where c.user_id = v_user and c.deleting_at is null')
    expect(sql).toContain('where t.user_id = v_user')
    expect(sql).toContain('pe.user_id = v_user')
  })

  test('grants execute to authenticated and nothing else', () => {
    expect(sql).toContain('revoke all on function public.project_people(uuid) from public, anon, service_role;')
    expect([...sql.matchAll(/grant execute on function public\.(\w+)\(([^)]*)\) to (\w+);/g)]
      .map((match) => [match[1], match[2], match[3]]))
      .toEqual([['project_people', 'uuid', 'authenticated']])
  })
})
