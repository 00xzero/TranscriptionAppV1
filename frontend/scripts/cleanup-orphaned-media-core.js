const PAGE_SIZE = 1000
const DELETE_BATCH_SIZE = 100
const DEFAULT_MIN_AGE_HOURS = 24

const TARGETS = [
  { bucket: 'media' },
  { bucket: 'waveforms' },
]

function parseCleanupOptions(args) {
  const minAgeIndex = args.indexOf('--min-age-hours')
  let minAgeHours = DEFAULT_MIN_AGE_HOURS
  if (minAgeIndex !== -1) {
    const rawValue = args[minAgeIndex + 1]
    minAgeHours = Number(rawValue)
    if (rawValue === undefined || !Number.isFinite(minAgeHours) || minAgeHours < 0) {
      throw new Error('--min-age-hours must be a non-negative number')
    }
  }

  return {
    shouldDelete: args.includes('--delete'),
    verbose: args.includes('--verbose'),
    metadataOnly: args.includes('--metadata-only'),
    minAgeHours,
  }
}

async function listReferencedKeys(supabase) {
  const keys = {
    media: new Set(),
    waveforms: new Set(),
  }
  let lastId = null

  while (true) {
    let query = supabase
      .from('transcripts')
      .select('id, source_object_key, waveform_object_key')
    if (lastId) query = query.gt('id', lastId)
    const { data, error } = await query
      .order('id', { ascending: true })
      .range(0, PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    for (const row of data) {
      if (row.source_object_key) keys.media.add(row.source_object_key)
      if (row.waveform_object_key) keys.waveforms.add(row.waveform_object_key)
    }

    if (data.length < PAGE_SIZE) break
    lastId = data[data.length - 1].id
  }

  return keys
}

async function listStorageObjects(supabase, bucket, prefix = '') {
  const objects = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })

    if (error) throw error
    if (!data || data.length === 0) break

    for (const entry of data) {
      const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) {
        objects.push(...await listStorageObjects(supabase, bucket, objectPath))
      } else {
        objects.push({
          path: objectPath,
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

async function listStorageObjectsFromMetadata(supabase, bucket) {
  const objects = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .schema('storage')
      .from('objects')
      .select('name, metadata, updated_at')
      .eq('bucket_id', bucket)
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

function findOrphanedObjects(objects, referencedKeys, cutoffMs) {
  return objects.filter((object) => {
    if (referencedKeys.has(object.path)) return false
    const updatedAtMs = Date.parse(object.updatedAt ?? '')
    return Number.isFinite(updatedAtMs) && updatedAtMs <= cutoffMs
  })
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

async function deleteObjects(supabase, bucket, paths, logger) {
  let deleted = 0

  for (let offset = 0; offset < paths.length; offset += DELETE_BATCH_SIZE) {
    const batch = paths.slice(offset, offset + DELETE_BATCH_SIZE)
    const { data, error } = await supabase.storage.from(bucket).remove(batch)
    if (error) throw error
    deleted += data?.length ?? 0
    logger.log(`Deleted ${deleted}/${paths.length} orphaned ${bucket} object(s)...`)
  }

  return deleted
}

async function runCleanup(supabase, options, logger = console, origin = 'configured Supabase') {
  const cutoffMs = Date.now() - options.minAgeHours * 60 * 60 * 1000
  logger.log(`Scanning Supabase project: ${origin}`)
  logger.log(`Mode: ${options.shouldDelete ? 'DELETE' : 'DRY RUN'}`)
  logger.log(`Minimum object age: ${options.minAgeHours} hour(s)`)
  if (options.metadataOnly) logger.log('Storage scan: metadata-only')

  const [referenced, ...storageObjectsByTarget] = await Promise.all([
    listReferencedKeys(supabase),
    ...TARGETS.map((target) =>
      options.metadataOnly
        ? listStorageObjectsFromMetadata(supabase, target.bucket)
        : listStorageObjects(supabase, target.bucket)
    ),
  ])
  const results = []

  for (const [index, target] of TARGETS.entries()) {
    const storageObjects = storageObjectsByTarget[index]
    const orphaned = findOrphanedObjects(
      storageObjects,
      referenced[target.bucket],
      cutoffMs
    )
    const orphanedBytes = orphaned.reduce((total, object) => total + object.size, 0)

    logger.log(`${target.bucket} referenced keys: ${referenced[target.bucket].size}`)
    logger.log(`${target.bucket} storage objects: ${storageObjects.length}`)
    logger.log(`${target.bucket} eligible orphaned objects: ${orphaned.length}`)
    logger.log(`${target.bucket} orphaned bytes: ${orphanedBytes} (${formatBytes(orphanedBytes)})`)

    if (orphaned.length > 0 && (options.verbose || orphaned.length <= 50)) {
      logger.log(`Orphaned ${target.bucket}:`)
      for (const object of orphaned) {
        logger.log(`- ${object.path} (${formatBytes(object.size)})`)
      }
    } else if (orphaned.length > 50) {
      logger.log(`Use --verbose to print all orphaned ${target.bucket} paths.`)
    }

    results.push({ bucket: target.bucket, storageObjects, orphaned })
  }

  if (!options.shouldDelete) {
    logger.log('Dry run only. Re-run with --delete to remove these objects.')
    return results
  }

  if (options.metadataOnly) {
    throw new Error(
      'Refusing to delete in --metadata-only mode. Use this mode to identify orphans only; delete through the Storage API or Supabase dashboard.'
    )
  }

  for (const result of results) {
    await deleteObjects(
      supabase,
      result.bucket,
      result.orphaned.map((object) => object.path),
      logger
    )
  }
  logger.log('Cleanup complete.')
  return results
}

module.exports = {
  DEFAULT_MIN_AGE_HOURS,
  TARGETS,
  deleteObjects,
  findOrphanedObjects,
  formatBytes,
  listReferencedKeys,
  listStorageObjects,
  listStorageObjectsFromMetadata,
  parseCleanupOptions,
  runCleanup,
}
