import { createClient } from '@supabase/supabase-js'

const BUCKET = 'media'
const PAGE_SIZE = 1000
const DELETE_BATCH_SIZE = 100

const shouldDelete = process.argv.includes('--delete')
const verbose = process.argv.includes('--verbose')
const metadataOnly = process.argv.includes('--metadata-only')

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function listAllProjectMediaKeys() {
  const keys = new Set()
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('projects')
      .select('source_object_key')
      .not('source_object_key', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    for (const row of data) {
      if (row.source_object_key) keys.add(row.source_object_key)
    }

    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return keys
}

async function listStorageObjects(prefix = '') {
  const objects = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })

    if (error) throw error
    if (!data || data.length === 0) break

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name

      if (entry.id === null) {
        objects.push(...await listStorageObjects(path))
      } else {
        objects.push({
          path,
          size: Number(entry.metadata?.size ?? 0),
          updatedAt: entry.updated_at,
        })
      }
    }

    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return objects
}

async function listStorageObjectsFromMetadata() {
  const objects = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .schema('storage')
      .from('objects')
      .select('name, metadata, updated_at')
      .eq('bucket_id', BUCKET)
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    for (const entry of data) {
      if (!entry.name) continue
      objects.push({
        path: entry.name,
        size: Number(entry.metadata?.size ?? 0),
        updatedAt: entry.updated_at,
      })
    }

    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return objects
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

async function deleteObjects(paths) {
  let deleted = 0

  for (let i = 0; i < paths.length; i += DELETE_BATCH_SIZE) {
    const batch = paths.slice(i, i + DELETE_BATCH_SIZE)
    const { error } = await supabase.storage.from(BUCKET).remove(batch)
    if (error) throw error
    deleted += batch.length
    console.log(`Deleted ${deleted}/${paths.length} orphaned object(s)...`)
  }
}

async function main() {
  const url = new URL(supabaseUrl)
  console.log(`Scanning Supabase project: ${url.origin}`)
  console.log(`Mode: ${shouldDelete ? 'DELETE' : 'DRY RUN'}`)
  if (metadataOnly) {
    console.log('Storage scan: metadata-only')
  }

  const [projectKeys, storageObjects] = await Promise.all([
    listAllProjectMediaKeys(),
    metadataOnly ? listStorageObjectsFromMetadata() : listStorageObjects(),
  ])

  const orphaned = storageObjects.filter((object) => !projectKeys.has(object.path))
  const orphanedBytes = orphaned.reduce((total, object) => total + object.size, 0)

  console.log(`Project media keys: ${projectKeys.size}`)
  console.log(`Storage objects: ${storageObjects.length}`)
  console.log(`Orphaned objects: ${orphaned.length}`)
  console.log(`Orphaned bytes: ${orphanedBytes} (${formatBytes(orphanedBytes)})`)

  if (orphaned.length > 0 && (verbose || orphaned.length <= 50)) {
    console.log('\nOrphaned media:')
    for (const object of orphaned) {
      console.log(`- ${object.path} (${formatBytes(object.size)})`)
    }
  } else if (orphaned.length > 50) {
    console.log('\nUse --verbose to print all orphaned media paths.')
  }

  if (!shouldDelete) {
    console.log('\nDry run only. Re-run with --delete to remove these objects.')
    return
  }

  if (metadataOnly) {
    throw new Error(
      'Refusing to delete in --metadata-only mode. Use this mode to identify orphans only; delete through the Storage API or Supabase dashboard.'
    )
  }

  await deleteObjects(orphaned.map((object) => object.path))
  console.log('Cleanup complete.')
}

main().catch((error) => {
  console.error('Cleanup failed:', error)
  process.exit(1)
})
