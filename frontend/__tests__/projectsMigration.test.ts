/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(
  __dirname,
  '../../infra/supabase/migrations/20260912000000_projects.sql'
)
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase()

function functionDefinition(name: string): string {
  const marker = `create or replace function public.${name}(`
  const start = sql.indexOf(marker)
  if (start === -1) throw new Error(`Missing function definition: ${name}`)
  const next = sql.indexOf('create or replace function public.', start + marker.length)
  return sql.slice(start, next === -1 ? sql.length : next)
}

describe('projects v1 migration', () => {
  test('defines recursive ownership, sibling uniqueness, and deletion semantics', () => {
    expect(sql).toContain('unique (id, user_id)')
    expect(sql).toMatch(/foreign key \(parent_id, user_id\)[\s\S]*references public\.projects \(id, user_id\)/)
    expect(sql).toContain('nulls not distinct')
    expect(sql).toMatch(/references public\.projects \(id, user_id\)\s+on delete no action/)
    expect(sql).not.toContain('deferrable')
    expect(sql).toMatch(/on delete set null \(project_id\)/)
  })

  test('uses invoker triggers and the required locking protocol', () => {
    for (const fn of [
      'projects_before_insert',
      'projects_before_update',
      'projects_before_delete',
      'transcripts_project_guard',
    ]) {
      const definition = functionDefinition(fn)
      expect(definition).toContain('security invoker')
      expect(definition).not.toContain('security definer')
    }
    expect(functionDefinition('projects_before_insert')).toContain('for share')
    expect(functionDefinition('transcripts_project_guard')).toContain('for share')
    expect(sql).toMatch(/before insert or delete or update of project_id, source_object_key, waveform_object_key/)
    expect(sql).toMatch(/deleting_at is distinct from old\.deleting_at[\s\S]*current_user not in/)
  })

  test('defines guarded, user-scoped branch RPCs', () => {
    for (const fn of [
      'project_branch_transcript_count',
      'begin_project_delete',
      'finish_project_delete',
    ]) {
      const definition = functionDefinition(fn)
      expect(definition).toContain('security definer')
      expect(definition).toContain('auth.uid()')
    }
    expect(sql).toContain('cycle id set is_cycle using path')
    const beginDefinition = functionDefinition('begin_project_delete')
    expect(beginDefinition).toMatch(/loop[\s\S]*update public\.projects[\s\S]*exit when v_next <@ v_ids/)
    expect(beginDefinition).toContain('and deleting_at is null')
    expect(sql).toContain("using errcode = 'pj001'")
    expect(sql).toContain("using errcode = 'pj002'")
    expect(sql).toContain("using errcode = 'pj003'")
    expect(sql).toContain("using errcode = 'pj004'")
  })

  test('exposes only the intended table and public functions', () => {
    expect(sql).toContain('alter publication supabase_realtime add table public.projects')
    expect(sql).toMatch(/grant select, insert, update, delete on table public\.projects\s+to authenticated, service_role/)
    expect(sql).toMatch(/grant execute on function public\.project_branch_transcript_count\(uuid\) to authenticated/)
    expect(sql).toMatch(/grant execute on function public\.begin_project_delete\(uuid\) to authenticated/)
    expect(sql).toMatch(/grant execute on function public\.finish_project_delete\(uuid, uuid\[\], text\[\], text\[\]\) to authenticated/)
    const authenticatedFunctionGrants = Array.from(
      sql.matchAll(/grant execute on function public\.(\w+)\([^;]+\) to authenticated;/g),
      (match) => match[1]
    )
    expect(authenticatedFunctionGrants).toEqual([
      'project_branch_transcript_count',
      'begin_project_delete',
      'finish_project_delete',
    ])
    expect(sql).not.toContain('cancel_project_delete')
  })

  test('broadcasts compact, private, user-scoped delete invalidations', () => {
    const definition = functionDefinition('broadcast_projects_v1_deletes')
    expect(definition).toContain('security definer')
    expect(definition).toContain("set search_path = ''")
    expect(definition).toContain("jsonb_build_object('table', tg_table_name)")
    expect(definition).toContain("'projects-v1:' || v_user::text")
    expect(definition).toMatch(/realtime\.send\([\s\S]*'delete'[\s\S]*true/)
    expect(sql).toMatch(
      /after delete on public\.projects\s+referencing old table as deleted_rows\s+for each statement/
    )
    expect(sql).toMatch(
      /after delete on public\.transcripts\s+referencing old table as deleted_rows\s+for each statement/
    )
    expect(sql).toContain('on realtime.messages')
    expect(sql).toContain("realtime.topic() = 'projects-v1:' || (select auth.uid())::text")
    expect(sql).not.toContain('replica identity full')
  })
})
