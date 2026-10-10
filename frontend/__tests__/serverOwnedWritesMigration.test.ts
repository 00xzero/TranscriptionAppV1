/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'

const sql = fs.readFileSync(
  path.resolve(__dirname, '../../infra/supabase/migrations/20261010120000_server_owned_writes.sql'),
  'utf8'
).toLowerCase()

function functionDefinition(name: string): string {
  const match = sql.match(new RegExp(`create (or replace )?function public\\.${name}\\(`))
  if (!match || match.index === undefined) throw new Error(`Missing function definition: ${name}`)
  const rest = sql.slice(match.index + match[0].length)
  const end = rest.indexOf('$$;', rest.indexOf('$$') + 2)
  return sql.slice(match.index, match.index + match[0].length + end)
}

// Static checks for the security contract only. Behaviour is covered by
// scripts/smoke-test-server-owned-writes.sql against a real database.
describe('Server-owned writes migration', () => {
  test('revokes pipeline-owned writes and grants only the columns the app writes', () => {
    expect(sql).toContain('revoke insert, update, delete on table public.jobs from authenticated;')
    expect(sql).toContain('revoke insert, update, delete on table public.transcripts from authenticated;')
    expect(sql).toContain(
      'grant insert (user_id, title, project_id, upload_intent_id) on table public.transcripts to authenticated;'
    )
    expect(sql).toContain(
      'grant update (title, project_id, source_object_key) on table public.transcripts to authenticated;'
    )
    expect(sql).toContain('revoke insert, delete on table public.segments from authenticated;')
    expect(sql).toContain('revoke update, delete on table public.watchlist from authenticated;')
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*on table public\.jobs/)
    expect(sql).not.toMatch(/grant [^;]*status[^;]*on table public\.transcripts/)
  })

  test('replaces FOR ALL policies with the commands still granted', () => {
    for (const name of [
      'users can access own transcript jobs',
      'users can access own transcript segments',
      'users can access own transcript watchlist',
      'users can delete own transcripts',
    ]) {
      expect(sql).toContain(`drop policy "${name}"`)
    }
    expect(sql).not.toMatch(/create policy[^;]*for all/)
    expect(sql).not.toMatch(/create policy[^;]*for delete/)
    expect(sql).toMatch(/on public\.jobs for select to authenticated/)
    expect(sql).toMatch(/on public\.segments for update to authenticated/)
    expect(sql).toMatch(/on public\.watchlist for insert to authenticated/)
  })

  test('keeps every transcript file inside its own folder', () => {
    expect(sql).toContain('add constraint transcripts_source_object_key_in_folder check')
    expect(sql).toContain(
      "starts_with(source_object_key, user_id::text || '/' || id::text || '/')"
    )
    expect(sql).toContain('add constraint transcripts_waveform_object_key_in_folder check')
    expect(sql).toContain("user_id::text || '/' || id::text || '/waveform.json'")
  })

  test('links media once: the browser cannot clear or replace the source key', () => {
    const guard = functionDefinition('protect_transcript_server_columns')
    expect(sql).toContain('rename to protect_transcript_server_columns;')
    expect(sql).toContain('rename to protect_transcript_server_columns_trigger;')
    expect(guard).toContain('old.source_object_key is not null')
    expect(guard).toContain('new.source_object_key is distinct from old.source_object_key')
  })

  test('new delete functions run as definer with an empty search path', () => {
    for (const name of ['transcript_folder_objects', 'transcript_delete_inventory', 'delete_transcript']) {
      const definition = functionDefinition(name)
      expect(definition).toContain('security definer')
      expect(definition).toContain("set search_path = ''")
    }
  })

  test('the folder helper is internal; the delete functions are for signed-in users only', () => {
    expect(sql).toContain(
      'revoke all on function public.transcript_folder_objects(uuid, uuid[]) from public, anon, authenticated, service_role;'
    )
    expect(sql).not.toMatch(/grant execute on function public\.transcript_folder_objects/)
    for (const signature of [
      'transcript_delete_inventory(uuid[])',
      'delete_transcript(uuid)',
      'finish_project_delete(uuid, uuid[])',
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, service_role;`)
      expect(sql).toContain(`grant execute on function public.${signature} to authenticated;`)
    }
  })

  test('delete_transcript checks the project and the folder before deleting', () => {
    const definition = functionDefinition('delete_transcript')
    const lock = definition.indexOf('for update')
    const projectCheck = definition.indexOf("errcode = 'pj002'")
    const folderCheck = definition.indexOf("errcode = 'tr002'")
    const deletion = definition.indexOf('delete from public.transcripts')
    expect(lock).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(projectCheck)
    expect(projectCheck).toBeLessThan(folderCheck)
    expect(folderCheck).toBeLessThan(deletion)
  })

  test('finish_project_delete drops the key arguments and locks before checking folders', () => {
    expect(sql).toContain('drop function public.finish_project_delete(uuid, uuid[], text[], text[]);')
    const definition = functionDefinition('finish_project_delete')
    const lock = definition.indexOf('for update')
    const folderCheck = definition.indexOf("errcode = 'pj005'")
    const deletion = definition.indexOf('delete from public.transcripts')
    expect(lock).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(folderCheck)
    expect(folderCheck).toBeLessThan(deletion)
  })

  test('the project inventory comes from the folders, not the row keys', () => {
    const definition = functionDefinition('project_branch_inventory')
    expect(definition).toContain('public.transcript_folder_objects(p_user, branch.ids)')
    expect(definition).not.toContain('t.source_object_key')
    expect(definition).not.toContain('t.waveform_object_key')
  })
})
