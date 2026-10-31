/**
 * Run against the local Supabase database:
 * SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *   npx tsx scripts/smoke-test-projects-concurrency.ts
 */
import assert from 'node:assert/strict'
import { Client, type QueryResult } from 'pg'

const connectionString =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const parsedUrl = new URL(connectionString)

if (!['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname)) {
  throw new Error('Concurrency smoke test refuses to run against a non-local database')
}

const USER_ID = '11000000-0000-0000-0000-000000000001'
const WORKOS_USER_ID = 'user_11000000000000000000000000000001'
const ROOT_ID = '21000000-0000-0000-0000-000000000001'
const LEAF_ID = '21000000-0000-0000-0000-000000000002'
const CHILD_ID = '21000000-0000-0000-0000-000000000003'
const TRANSCRIPT_A = '31000000-0000-0000-0000-000000000001'
const TRANSCRIPT_B = '31000000-0000-0000-0000-000000000002'
const BLOCK_TIMEOUT_MS = 200

type Role = 'authenticated' | 'service_role'

type Inventory = {
  project_ids: string[]
  transcript_ids: string[]
  media_keys: string[]
  waveform_keys: string[]
}

function client() {
  return new Client({ connectionString })
}

async function beginAs(connection: Client, role: Role) {
  await connection.query('BEGIN')
  await connection.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: WORKOS_USER_ID, role }),
  ])
  await connection.query(`SET LOCAL ROLE ${role}`)
}

async function expectBlocked<T>(promise: Promise<T>, label: string) {
  const marker = Symbol('blocked')
  const result = await Promise.race([
    promise.then(
      () => 'resolved' as const,
      () => 'rejected' as const
    ),
    new Promise<typeof marker>((resolve) => {
      setTimeout(() => resolve(marker), BLOCK_TIMEOUT_MS)
    }),
  ])
  assert.equal(result, marker, `${label} did not block`)
}

async function resetFixture(admin: Client) {
  await admin.query('BEGIN')
  try {
    // Fixture files only; the Storage API sets this flag for its own deletes.
    await admin.query("SET LOCAL storage.allow_delete_query = 'true'")
    await admin.query(
      `DELETE FROM storage.objects
       WHERE bucket_id IN ('media', 'waveforms') AND starts_with(name, $1 || '/')`,
      [USER_ID]
    )
    await admin.query('DELETE FROM public.transcripts WHERE user_id = $1', [USER_ID])
    await admin.query('DELETE FROM public.projects WHERE user_id = $1', [USER_ID])
    await admin.query('DELETE FROM public.app_users WHERE id = $1', [USER_ID])
    await admin.query('COMMIT')
  } catch (error) {
    await admin.query('ROLLBACK')
    throw error
  }
}

async function seedFixture(admin: Client) {
  await resetFixture(admin)
  await admin.query(
    `INSERT INTO public.app_users (id, workos_user_id)
     VALUES ($1, $2)`,
    [USER_ID, WORKOS_USER_ID]
  )
  await admin.query(
    `INSERT INTO public.projects (id, user_id, parent_id, name) VALUES
       ($1, $3, null, 'Root'),
       ($2, $3, $1, 'Leaf')`,
    [ROOT_ID, LEAF_ID, USER_ID]
  )
  await admin.query(
    `INSERT INTO public.transcripts (id, user_id, project_id, title, status) VALUES
       ($1, $3, null, 'Transcript A', 'created'),
       ($2, $3, $4, 'Transcript B', 'created')`,
    [TRANSCRIPT_A, TRANSCRIPT_B, USER_ID, LEAF_ID]
  )
}

function folderKey(transcriptId: string, name: string) {
  return `${USER_ID}/${transcriptId}/${name}`
}

const INSERT_OBJECT = 'INSERT INTO storage.objects (bucket_id, name) VALUES ($1, $2)'

async function inventory(connection: Client): Promise<QueryResult<Inventory>> {
  return connection.query<Inventory>('SELECT * FROM public.begin_project_delete($1)', [ROOT_ID])
}

/** Seeds the fixture and runs a scenario on a fresh writer/deleter connection pair. */
async function withConnections(
  admin: Client,
  scenario: (writer: Client, deleter: Client) => Promise<void>
) {
  await seedFixture(admin)
  const writer = client()
  const deleter = client()
  await Promise.all([writer.connect(), deleter.connect()])
  try {
    await scenario(writer, deleter)
  } finally {
    await Promise.all([writer.end(), deleter.end()])
  }
}

/**
 * Leaves `sql` uncommitted on the writer, asserts begin_project_delete waits for
 * it, commits the writer, and returns the deleter's inventory from its still-open
 * transaction.
 */
async function markBehindWrite(
  writer: Client,
  deleter: Client,
  role: Role,
  writes: Array<[sql: string, params: unknown[]]>,
  label: string
): Promise<Inventory> {
  await beginAs(writer, role)
  for (const [sql, params] of writes) await writer.query(sql, params)
  await beginAs(deleter, 'authenticated')
  const pending = inventory(deleter)
  await expectBlocked(pending, label)
  await writer.query('COMMIT')
  const { rows } = await pending
  return rows[0]
}

async function scenarioMoveBeforeMark(admin: Client) {
  await withConnections(admin, async (writer, deleter) => {
    const result = await markBehindWrite(
      writer,
      deleter,
      'authenticated',
      [['UPDATE public.transcripts SET project_id = $1 WHERE id = $2', [ROOT_ID, TRANSCRIPT_A]]],
      'begin_project_delete behind an in-flight move'
    )
    assert(result.transcript_ids.includes(TRANSCRIPT_A))
    await deleter.query('COMMIT')
  })
}

async function scenarioMoveAfterMark(admin: Client) {
  await withConnections(admin, async (writer, deleter) => {
    await beginAs(deleter, 'authenticated')
    await inventory(deleter)
    await beginAs(writer, 'authenticated')
    const pending = writer.query(
      'UPDATE public.transcripts SET project_id = $1 WHERE id = $2',
      [ROOT_ID, TRANSCRIPT_A]
    )
    await expectBlocked(pending, 'move behind an uncommitted deletion mark')
    await deleter.query('COMMIT')
    await assert.rejects(pending, (error: NodeJS.ErrnoException) => error.code === 'PJ002')
    await writer.query('ROLLBACK')
  })
}

async function scenarioKeyLinkBeforeMark(admin: Client) {
  await withConnections(admin, async (writer, deleter) => {
    const key = folderKey(TRANSCRIPT_B, 'new-media.mp3')
    const result = await markBehindWrite(
      writer,
      deleter,
      'service_role',
      [
        [INSERT_OBJECT, ['media', key]],
        ['UPDATE public.transcripts SET source_object_key = $1 WHERE id = $2', [key, TRANSCRIPT_B]],
      ],
      'begin_project_delete behind an in-flight key link'
    )
    // The inventory comes from the folder, so it sees the committed upload.
    assert(result.media_keys.includes(key))
    await deleter.query('COMMIT')
  })
}

async function scenarioChildBeforeMark(admin: Client) {
  await withConnections(admin, async (writer, deleter) => {
    const result = await markBehindWrite(
      writer,
      deleter,
      'authenticated',
      [[
        'INSERT INTO public.projects (id, user_id, parent_id, name) VALUES ($1, $2, $3, $4)',
        [CHILD_ID, USER_ID, LEAF_ID, 'Late child'],
      ]],
      'begin_project_delete behind an in-flight child insert'
    )
    assert(result.project_ids.includes(CHILD_ID))
    const child = await deleter.query<{ deleting_at: Date | null }>(
      'SELECT deleting_at FROM public.projects WHERE id = $1',
      [CHILD_ID]
    )
    assert(child.rows[0].deleting_at)
    await deleter.query('COMMIT')
  })
}

async function scenarioDeleteBeforeAndAfterMark(admin: Client) {
  await withConnections(admin, async (writer, deleter) => {
    await admin.query('UPDATE public.transcripts SET project_id = $1 WHERE id = $2', [
      ROOT_ID,
      TRANSCRIPT_A,
    ])
    const result = await markBehindWrite(
      writer,
      deleter,
      'authenticated',
      [['SELECT public.delete_transcript($1)', [TRANSCRIPT_B]]],
      'begin_project_delete behind an in-flight transcript delete'
    )
    assert(!result.transcript_ids.includes(TRANSCRIPT_B))
    await deleter.query('COMMIT')

    await beginAs(writer, 'authenticated')
    await assert.rejects(
      writer.query('SELECT public.delete_transcript($1)', [TRANSCRIPT_A]),
      (error: NodeJS.ErrnoException) => error.code === 'PJ002'
    )
    await writer.query('ROLLBACK')
  })
}

/**
 * An upload and its link are in flight: delete_transcript waits on the row
 * lock, then sees the committed file and refuses.
 */
async function scenarioTranscriptDeleteBehindLink(admin: Client) {
  await withConnections(admin, async (writer, deleter) => {
    const key = folderKey(TRANSCRIPT_A, 'audio.webm')
    await beginAs(writer, 'service_role')
    await writer.query(INSERT_OBJECT, ['media', key])
    await writer.query('UPDATE public.transcripts SET source_object_key = $1 WHERE id = $2', [
      key,
      TRANSCRIPT_A,
    ])
    await beginAs(deleter, 'authenticated')
    const pending = deleter.query('SELECT public.delete_transcript($1)', [TRANSCRIPT_A])
    await expectBlocked(pending, 'delete_transcript behind an in-flight link')
    await writer.query('COMMIT')
    await assert.rejects(pending, (error: NodeJS.ErrnoException) => error.code === 'TR002')
    await deleter.query('ROLLBACK')
  })
}

/**
 * A server write on a branch transcript is in flight after the mark: finish
 * waits on the transcript lock it takes before checking folders, then sees the
 * committed waveform and refuses.
 */
async function scenarioFinishBehindWaveformWrite(admin: Client) {
  await withConnections(admin, async (writer, deleter) => {
    await beginAs(deleter, 'authenticated')
    const { rows } = await inventory(deleter)
    await deleter.query('COMMIT')

    await beginAs(writer, 'service_role')
    await writer.query(INSERT_OBJECT, ['waveforms', folderKey(TRANSCRIPT_B, 'waveform.json')])
    await writer.query("UPDATE public.transcripts SET waveform_status = 'processing' WHERE id = $1", [
      TRANSCRIPT_B,
    ])
    await beginAs(deleter, 'authenticated')
    const pending = deleter.query('SELECT * FROM public.finish_project_delete($1, $2)', [
      ROOT_ID,
      rows[0].transcript_ids,
    ])
    await expectBlocked(pending, 'finish_project_delete behind an in-flight waveform write')
    await writer.query('COMMIT')
    await assert.rejects(pending, (error: NodeJS.ErrnoException) => error.code === 'PJ005')
    await deleter.query('ROLLBACK')
  })
}

/**
 * The documented limit: an upload that holds no row lock and commits after
 * delete_transcript has checked the folder is not seen by the delete. The
 * inventory still finds it afterwards, which is what the route's post-delete
 * sweep relies on.
 */
async function scenarioUploadAfterFolderCheck(admin: Client) {
  await withConnections(admin, async (writer, deleter) => {
    const key = folderKey(TRANSCRIPT_A, 'late.webm')
    await beginAs(writer, 'service_role')
    await writer.query(INSERT_OBJECT, ['media', key])

    await beginAs(deleter, 'authenticated')
    await deleter.query('SELECT public.delete_transcript($1)', [TRANSCRIPT_A])
    await deleter.query('COMMIT')
    await writer.query('COMMIT')

    await beginAs(deleter, 'authenticated')
    const { rows } = await deleter.query<{ media_keys: string[] }>(
      'SELECT media_keys FROM public.transcript_delete_inventory($1)',
      [[TRANSCRIPT_A]]
    )
    assert.deepEqual(rows[0].media_keys, [key])
    await deleter.query('ROLLBACK')
  })
}

async function main() {
  const admin = client()
  await admin.connect()
  try {
    await scenarioMoveBeforeMark(admin)
    await scenarioMoveAfterMark(admin)
    await scenarioKeyLinkBeforeMark(admin)
    await scenarioChildBeforeMark(admin)
    await scenarioDeleteBeforeAndAfterMark(admin)
    await scenarioTranscriptDeleteBehindLink(admin)
    await scenarioFinishBehindWaveformWrite(admin)
    await scenarioUploadAfterFolderCheck(admin)
    console.log('projects concurrency smoke test passed')
  } finally {
    await resetFixture(admin)
    await admin.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
