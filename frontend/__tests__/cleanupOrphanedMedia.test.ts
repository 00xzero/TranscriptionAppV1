/** @jest-environment node */

export {}

const {
  findOrphanedObjects,
  listReferencedKeys,
  parseCleanupOptions,
  runCleanup,
} = jest.requireActual('../scripts/cleanup-orphaned-media-core.js')

type StorageEntry = {
  id: string | null
  name: string
  updated_at?: string | null
  metadata?: { size?: number }
}

type TranscriptRow = {
  id: string
  source_object_key: string | null
  waveform_object_key: string | null
}

function buildCleanupClient({
  transcriptRows = [],
  transcriptPages,
  storageEntries = {},
}: {
  transcriptRows?: TranscriptRow[]
  transcriptPages?: TranscriptRow[][]
  storageEntries?: Record<string, StorageEntry[]>
} = {}) {
  const pages = transcriptPages ?? [transcriptRows]
  let pageIndex = 0
  const range = jest.fn(async () => ({ data: pages[pageIndex++] ?? [], error: null }))
  const query: { order: jest.Mock; gt: jest.Mock } = {
    order: jest.fn(() => ({ range })),
    gt: jest.fn(),
  }
  query.gt.mockImplementation(() => query)
  const select = jest.fn(() => query)
  const from = jest.fn((table: string) => {
    if (table !== 'transcripts') throw new Error(`Unexpected table: ${table}`)
    return { select }
  })
  const removeByBucket: Record<string, jest.Mock> = {
    media: jest.fn(async (paths: string[]) => ({
      data: paths.map((name) => ({ name })),
      error: null,
    })),
    waveforms: jest.fn(async (paths: string[]) => ({
      data: paths.map((name) => ({ name })),
      error: null,
    })),
  }
  const listByBucket: Record<string, jest.Mock> = {
    media: jest.fn(async () => ({ data: storageEntries.media ?? [], error: null })),
    waveforms: jest.fn(async () => ({ data: storageEntries.waveforms ?? [], error: null })),
  }
  const storageFrom = jest.fn((bucket: string) => ({
    list: listByBucket[bucket],
    remove: removeByBucket[bucket],
  }))

  return {
    client: { from, storage: { from: storageFrom } },
    from,
    transcriptQuery: { range, order: query.order, gt: query.gt },
    removeByBucket,
  }
}

function entry(name: string, updatedAt: string | null, size = 10): StorageEntry {
  return { id: `id-${name}`, name, updated_at: updatedAt, metadata: { size } }
}

describe('cleanup orphaned media', () => {
  const now = Date.parse('2026-09-14T12:00:00Z')

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('defaults to a 24-hour dry run and validates the age flag', () => {
    expect(parseCleanupOptions([])).toEqual({
      shouldDelete: false,
      verbose: false,
      metadataOnly: false,
      minAgeHours: 24,
    })
    expect(parseCleanupOptions(['--delete', '--min-age-hours', '0'])).toMatchObject({
      shouldDelete: true,
      minAgeHours: 0,
    })
    expect(() => parseCleanupOptions(['--min-age-hours', '-1'])).toThrow('non-negative')
    expect(() => parseCleanupOptions(['--min-age-hours'])).toThrow('non-negative')
  })

  test('only considers unreferenced objects with a known age at or beyond the cutoff', () => {
    const cutoff = Date.parse('2026-09-13T12:00:00Z')
    const objects = [
      { path: 'referenced', updatedAt: '2026-09-01T00:00:00Z' },
      { path: 'old', updatedAt: '2026-09-13T12:00:00Z' },
      { path: 'young', updatedAt: '2026-09-14T11:00:00Z' },
      { path: 'unknown', updatedAt: null },
    ]

    expect(findOrphanedObjects(objects, new Set(['referenced']), cutoff)).toEqual([
      { path: 'old', updatedAt: '2026-09-13T12:00:00Z' },
    ])
  })

  test('scans transcript references and both buckets without deleting by default', async () => {
    const h = buildCleanupClient({
      transcriptRows: [{
        id: 'transcript-1',
        source_object_key: 'media-ref',
        waveform_object_key: 'wave-ref',
      }],
      storageEntries: {
        media: [
          entry('media-ref', '2026-09-01T00:00:00Z'),
          entry('media-old', '2026-09-01T00:00:00Z'),
          entry('media-young', '2026-09-14T11:00:00Z'),
        ],
        waveforms: [
          entry('wave-ref', '2026-09-01T00:00:00Z'),
          entry('wave-old', '2026-09-01T00:00:00Z'),
        ],
      },
    })
    const logger = { log: jest.fn() }

    const result = await runCleanup(h.client, parseCleanupOptions([]), logger, 'local')

    expect(h.from).toHaveBeenCalledWith('transcripts')
    expect(result.map((item: { bucket: string; orphaned: Array<{ path: string }> }) => ({
      bucket: item.bucket,
      paths: item.orphaned.map((object) => object.path),
    }))).toEqual([
      { bucket: 'media', paths: ['media-old'] },
      { bucket: 'waveforms', paths: ['wave-old'] },
    ])
    expect(h.removeByBucket.media).not.toHaveBeenCalled()
    expect(h.removeByBucket.waveforms).not.toHaveBeenCalled()
  })

  test('uses ordered keyset pagination so transcript references are not skipped', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `id-${String(index).padStart(4, '0')}`,
      source_object_key: index === 0 ? 'first-page-media' : null,
      waveform_object_key: null,
    }))
    const secondPage = [{
      id: 'id-1000',
      source_object_key: null,
      waveform_object_key: 'second-page-waveform',
    }]
    const h = buildCleanupClient({ transcriptPages: [firstPage, secondPage] })

    const referenced = await listReferencedKeys(h.client)

    expect(referenced.media).toEqual(new Set(['first-page-media']))
    expect(referenced.waveforms).toEqual(new Set(['second-page-waveform']))
    expect(h.transcriptQuery.order).toHaveBeenCalledTimes(2)
    expect(h.transcriptQuery.order).toHaveBeenCalledWith('id', { ascending: true })
    expect(h.transcriptQuery.gt).toHaveBeenCalledWith('id', 'id-0999')
    expect(h.transcriptQuery.range).toHaveBeenCalledTimes(2)
    expect(h.transcriptQuery.range).toHaveBeenCalledWith(0, 999)
  })

  test('deletes eligible objects from each bucket only in destructive mode', async () => {
    const h = buildCleanupClient({
      storageEntries: {
        media: [entry('media-old', '2026-09-01T00:00:00Z')],
        waveforms: [entry('wave-old', '2026-09-01T00:00:00Z')],
      },
    })

    await runCleanup(
      h.client,
      parseCleanupOptions(['--delete', '--min-age-hours', '0']),
      { log: jest.fn() },
      'local'
    )

    expect(h.removeByBucket.media).toHaveBeenCalledWith(['media-old'])
    expect(h.removeByBucket.waveforms).toHaveBeenCalledWith(['wave-old'])
  })
})
