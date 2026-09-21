/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(
  __dirname,
  '../../infra/supabase/migrations/20260920000000_project_speaker_summaries.sql'
)
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase()

function functionDefinition(name: string): string {
  const marker = `create or replace function public.${name}(`
  const start = sql.indexOf(marker)
  if (start === -1) throw new Error(`Missing function definition: ${name}`)
  const next = sql.indexOf('create or replace function public.', start + marker.length)
  return sql.slice(start, next === -1 ? sql.length : next)
}

describe('project_speaker_summaries migration', () => {
  const definition = functionDefinition('project_speaker_summaries')

  test('is a read-only invoker-rights function', () => {
    expect(definition).toContain('stable')
    expect(definition).toContain('security invoker')
    // Invoker rights ARE the ownership model here: RLS filters the projects the
    // caller may see, so definer rights would silently expose every project.
    expect(definition).not.toContain('security definer')
    expect(definition).toContain('set search_path = public')
  })

  test('prunes projects being deleted during recursion, not after', () => {
    // Once in the base term (the requested roots) and once in the recursive arm,
    // so a deleting project takes its whole subtree with it.
    const pruneCount = definition.match(/deleting_at is null/g) ?? []
    expect(pruneCount).toHaveLength(2)
    expect(definition).toMatch(/join public\.projects as c on c\.parent_id = b\.scope_project_id\s+where c\.deleting_at is null/)
  })

  test('guards the recursion against cycles', () => {
    expect(definition).toContain('cycle scope_project_id set is_cycle using path')
    expect(definition).toContain('where not b.is_cycle')
  })

  test('does not call the helper it is not granted execute on', () => {
    // project_branch_ids is revoked from PUBLIC and never granted to
    // authenticated, so an invoker-rights caller cannot execute it. Comments are
    // stripped first: the migration names it while explaining why it is avoided.
    const executable = definition.replace(/--[^\n]*/g, '')
    expect(executable).not.toContain('project_branch_ids')
  })

  test('ranks palette positions over every speaker of a transcript', () => {
    expect(definition).toMatch(
      /row_number\(\) over \(\s*partition by sp\.transcript_id\s*order by sp\.created_at, sp\.id\s*\)/
    )
    // The rank must be computed before the used-speaker filter, or dropping an
    // unused speaker would repaint the transcript.
    expect(definition.indexOf('ranked_speakers as')).toBeLessThan(
      definition.indexOf('used_speakers as')
    )
  })

  test('counts distinct speakers actually referenced by segments', () => {
    expect(definition).toMatch(/exists \(\s*select 1\s*from public\.segments as sg/)
    expect(definition).toContain('count(*)::integer as speaker_count')
    expect(definition).toContain('select distinct b.root_id, b.scope_project_id')
  })

  test('orders the preview inside the aggregate and bounds its size', () => {
    // An ordering in an upstream CTE is not binding on jsonb_agg.
    expect(definition).toMatch(/jsonb_agg\([\s\S]*order by o\.rn\s*\)/)
    expect(definition).toMatch(
      /order by st\.updated_at desc, st\.transcript_id, us\.created_at, us\.id/
    )
    expect(definition).toContain('least(greatest(coalesce(p_preview_limit, 4), 0), 4)')
  })

  test('always returns an array for preview and a number for the count', () => {
    // jsonb_agg yields NULL for an empty group, which a preview limit of 0 or a
    // speaker-less project both produce.
    expect(definition.match(/'\[\]'::jsonb/g) ?? []).toHaveLength(2)
    expect(definition).toContain('coalesce(a.speaker_count, 0)')
  })

  test('deduplicates and tolerates a null input array', () => {
    expect(definition).toContain("unnest(coalesce(p_project_ids, '{}'::uuid[]))")
    expect(definition).toContain('select distinct r.id')
  })

  test('grants execute to authenticated and to nothing else', () => {
    const granted = [...sql.matchAll(/grant execute on function public\.(\w+)\([^;]+\) to (\w+);/g)]
    expect(granted.map((match) => [match[1], match[2]])).toEqual([
      ['project_speaker_summaries', 'authenticated'],
    ])

    // service_role bypasses RLS and has a NULL auth.uid(), so it would read every
    // requested project regardless of owner.
    expect(sql).toContain('revoke all on function public.project_speaker_summaries(uuid[], boolean, integer) from service_role')
    expect(sql).toContain('revoke all on function public.project_speaker_summaries(uuid[], boolean, integer) from public')
    expect(sql).toContain('revoke all on function public.project_speaker_summaries(uuid[], boolean, integer) from anon')
  })

  test('indexes the segments probe the function performs', () => {
    expect(sql).toMatch(
      /create index if not exists idx_segments_transcript_speaker\s+on public\.segments \(transcript_id, speaker_id\)\s+where speaker_id is not null/
    )
  })
})
