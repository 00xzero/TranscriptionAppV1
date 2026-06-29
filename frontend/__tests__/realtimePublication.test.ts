import fs from 'node:fs'
import path from 'node:path'

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'infra',
  'supabase',
  'migrations',
)

const PUBLICATION_MIGRATION = path.join(
  MIGRATIONS_DIR,
  '20260513010000_realtime_publication.sql',
)

// The projects -> transcripts rename re-asserts the renamed table into the
// realtime publication (membership follows the rename automatically, but the
// migration makes it explicit and greppable).
const RENAME_MIGRATION = path.join(
  MIGRATIONS_DIR,
  '20260627000000_rename_projects_to_transcripts.sql',
)

describe('supabase_realtime publication migration', () => {
  const sql = fs.readFileSync(PUBLICATION_MIGRATION, 'utf8')
  const renameSql = fs.readFileSync(RENAME_MIGRATION, 'utf8')

  test('uses ALTER PUBLICATION ADD TABLE via the dynamic %I template', () => {
    expect(sql).toMatch(
      /ALTER PUBLICATION supabase_realtime ADD TABLE public\.%I/,
    )
  })

  test.each(['jobs', 'speakers'])(
    '%s is in the realtime-table allowlist the original migration iterates over',
    (table) => {
      expect(sql).toMatch(new RegExp(`'${table}'`))
    },
  )

  test('publication add is guarded against duplicates so re-running is safe', () => {
    expect(sql).toMatch(/pg_publication_tables/)
    expect(sql).toMatch(/IF NOT EXISTS/)
  })

  test('the rename migration re-asserts transcripts into the publication', () => {
    expect(renameSql).toMatch(/'transcripts'/)
    expect(renameSql).toMatch(
      /ALTER PUBLICATION supabase_realtime ADD TABLE public\.%I/,
    )
    expect(renameSql).toMatch(/pg_publication_tables/)
    expect(renameSql).toMatch(/IF NOT EXISTS/)
  })
})
