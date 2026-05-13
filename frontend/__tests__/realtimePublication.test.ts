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

  test.each(REALTIME_TABLES)(
    '%s is added to the supabase_realtime publication',
    (table) => {
      expect(sql).toMatch(
        new RegExp(`ALTER PUBLICATION supabase_realtime ADD TABLE public\\.%I`),
      )
      expect(sql).toMatch(new RegExp(`'${table}'`))
    },
  )

  test.each(REALTIME_TABLES)(
    '%s has REPLICA IDENTITY FULL set so DELETE events carry the filter columns',
    (table) => {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE public\\.${table} REPLICA IDENTITY FULL`),
      )
    },
  )

  test('publication add is guarded against duplicates so re-running is safe', () => {
    expect(sql).toMatch(/pg_publication_tables/)
    expect(sql).toMatch(/IF NOT EXISTS/)
  })
})
