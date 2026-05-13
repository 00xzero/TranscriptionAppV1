import fs from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'infra',
  'supabase',
  'migrations',
  '20260513010000_realtime_publication.sql',
)

const REALTIME_TABLES = ['projects', 'jobs', 'speakers'] as const

describe('supabase_realtime publication migration', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8')

  test('uses ALTER PUBLICATION ADD TABLE via the dynamic %I template', () => {
    expect(sql).toMatch(
      /ALTER PUBLICATION supabase_realtime ADD TABLE public\.%I/,
    )
  })

  test.each(REALTIME_TABLES)(
    '%s is in the realtime-table allowlist the migration iterates over',
    (table) => {
      expect(sql).toMatch(new RegExp(`'${table}'`))
    },
  )

  test('publication add is guarded against duplicates so re-running is safe', () => {
    expect(sql).toMatch(/pg_publication_tables/)
    expect(sql).toMatch(/IF NOT EXISTS/)
  })
})
