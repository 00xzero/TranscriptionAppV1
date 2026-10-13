/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'

const sql = fs.readFileSync(
  path.resolve(__dirname, '../../infra/supabase/migrations/20261013000000_segment_split.sql'),
  'utf8'
).toLowerCase()

/** The body of one function, from its CREATE to the closing $$. */
function body(name: string): string {
  const start = sql.indexOf(`create function public.${name}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = sql.indexOf('$$;', start)
  return sql.slice(start, end)
}

// Static checks for the security contract only. Behaviour is checked against a
// real database with SET ROLE authenticated (see the slice's verification).
describe('Segment split migration', () => {
  test('adds revision without granting signed-in users a way to set it', () => {
    expect(sql).toContain('alter table public.segments add column revision integer not null default 0;')
    expect(sql).not.toMatch(/grant [^;]*update[^;]*on table public\.segments/)
    expect(sql).not.toMatch(/grant [^;]*\(revision/)
  })

  test.each(['split_segment', 'rejoin_segments'])('%s runs as a guarded definer for the caller only', (name) => {
    const fn = body(name)
    expect(fn).toContain('security definer')
    expect(fn).toContain("set search_path = ''")
    expect(fn).toContain('v_user uuid := auth.uid();')
    expect(fn).toContain("raise exception 'authentication required' using errcode = '42501'")
    expect(fn).toContain('join public.transcripts as t on t.id = sg.transcript_id')
    expect(fn).toContain('t.user_id = v_user')
    expect(fn).toContain('perform public.require_completed_transcript(v_transcript_id, v_user);')
  })

  test('split checks the revision, and a replay counts only while nothing has changed since', () => {
    const fn = body('split_segment')
    expect(fn).toContain('v_segment.revision <> p_expected_revision')
    expect(fn).toContain('v_new.revision = 0')
    expect(fn).toContain('v_segment.revision = p_expected_revision + 1')
    expect(fn).toContain('revision = revision + 1')
  })

  test("split's replay looks the new id up only inside the caller's transcript", () => {
    const fn = body('split_segment')
    expect(fn).toContain('where id = p_new_segment_id and transcript_id = v_transcript_id')
    // The replay is checked before anything is written.
    expect(fn.indexOf('p_new_segment_id and transcript_id = v_transcript_id')).toBeLessThan(fn.indexOf('insert into public.segments'))
  })

  test('rejoin checks both revisions, and a replay counts only while nothing has changed since', () => {
    const fn = body('rejoin_segments')
    expect(fn).toContain('v_first.revision <> p_expected_revision or v_next.revision <> p_expected_next_revision')
    expect(fn).toContain('v_first.revision = p_expected_revision + 1')
    expect(fn).toContain('w.id = p_next_first_word_id and w.segment_id = p_segment_id')
    // Words move before the segment goes, or the cascade would delete them.
    expect(fn.indexOf('update public.words set segment_id = p_segment_id')).toBeLessThan(fn.indexOf('delete from public.segments'))
  })

  test('only signed-in users may call the functions', () => {
    for (const signature of [
      'public.split_segment(uuid, integer, uuid, text, text, uuid)',
      'public.rejoin_segments(uuid, integer, uuid, integer, uuid, text)',
    ]) {
      expect(sql).toContain(`revoke all on function ${signature}\n  from public, anon, service_role;`)
      expect(sql).toContain(`grant execute on function ${signature} to authenticated;`)
    }
    expect(sql).not.toMatch(/grant [^;]* to (anon|public)/)
  })

  // Codex: a split keeps the segment's id and speaker, so speaker changes must
  // name the revision too.
  test('every speaker change must name a revision, and a mismatch is refused', () => {
    const fn = replaced('apply_segment_speaker_changes')
    expect(fn).toContain("e ? 'expected_revision'")
    expect(fn).toContain("jsonb_typeof(e -> 'expected_revision') <> 'number'")
    expect(fn).toContain('where sg.revision <> c.expected_revision')
    expect(fn).toContain("raise exception 'segment was split or rejoined since it was read' using errcode = 'sp002'")
    // Checked before the segments are written.
    expect(fn.indexOf('sg.revision <> c.expected_revision')).toBeLessThan(fn.indexOf('set speaker_id = c.speaker_id'))
  })

  test('Remove person builds its changes, and their Undo, with each revision', () => {
    expect(replaced('remove_person_from_transcript')).toContain("'expected_revision', sg.revision")
  })
})

/** The body of a function this migration replaces. */
function replaced(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  return sql.slice(start, sql.indexOf('$$;', start))
}
