/** @jest-environment node */

import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { InngestTestEngine } from '@inngest/test'

const finalizeSingleMock = jest.fn()
const reconcileMaybeSingleMock = jest.fn()
const reconcileSelectMock = jest.fn()
const uploadMock = jest.fn()
const removeMock = jest.fn()
const computePeaksMock = jest.fn()

jest.mock('@/infra/supabase/storage', () => ({
  getSignedMediaUrl: jest.fn(async () => ({ url: 'https://example.test/media', error: null })),
  WAVEFORM_BUCKET: 'waveforms',
}))

jest.mock('@/lib/audio/ffmpeg', () => ({
  probeMedia: jest.fn(async () => ({ durationSeconds: 2, totalSamples: 100 })),
  spawnPcmStream: jest.fn(async () => {
    const process = new EventEmitter() as EventEmitter & {
      stdout: Readable
      stderr: EventEmitter
      exitCode: number | null
      killed: boolean
      kill: jest.Mock
    }
    process.stdout = Readable.from([])
    process.stderr = new EventEmitter()
    process.exitCode = 0
    process.killed = false
    process.kill = jest.fn()
    return process
  }),
}))

jest.mock('@/lib/audio/compute-peaks', () => {
  const actual = jest.requireActual('@/lib/audio/compute-peaks')
  return { ...actual, computePeaks: (...args: unknown[]) => computePeaksMock(...args) }
})

jest.mock('@/infra/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({ upload: uploadMock, remove: removeMock }),
    },
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => ({ single: finalizeSingleMock }),
          in: jest.fn(async () => ({ error: null })),
        }),
      }),
      select: (...args: unknown[]) => {
        reconcileSelectMock(...args)
        return {
        eq: () => ({ maybeSingle: reconcileMaybeSingleMock }),
        }
      },
    }),
  }),
}))

import { handleWaveformRequested } from '@/lib/inngest/functions/handle-waveform-requested'

const transcriptId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const sourceObjectKey = `${userId}/${transcriptId}/audio.webm`
const waveformObjectKey = `${userId}/${transcriptId}/waveform.json`
const event = {
  name: 'waveform/requested',
  data: { transcriptId, userId, sourceObjectKey },
} as const

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message)
  }
  return String(error)
}

async function execute() {
  const engine = new InngestTestEngine({ function: handleWaveformRequested })
  return engine.execute({
    events: [event],
    steps: [{
      id: 'mark-processing',
      handler: () => ({ shouldGenerate: true, verifiedSourceObjectKey: sourceObjectKey }),
    }],
  })
}

describe('waveform finalization reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    computePeaksMock.mockResolvedValue({ peaks: new Float32Array([0.1, 0.2]), pointsPerSecond: 1 })
    uploadMock.mockResolvedValue({ error: null })
    removeMock.mockResolvedValue({ data: [{ name: waveformObjectKey }], error: null })
    finalizeSingleMock.mockResolvedValue({ data: { id: transcriptId }, error: null })
    reconcileMaybeSingleMock.mockResolvedValue({
      data: {
        waveform_object_key: waveformObjectKey,
        waveform_status: 'ready',
        waveform_points_per_second: 1,
        waveform_version: 1,
      },
      error: null,
    })
  })

  test.each(['PJ002', 'PGRST116'])('compensates and fails non-retriably for %s', async (code) => {
    finalizeSingleMock.mockResolvedValue({
      data: null,
      error: { code, message: 'link rejected' },
    })

    const { error } = await execute()

    expect(getErrorMessage(error)).toContain('link rejected')
    expect((error as { name?: string })?.name).toBe('NonRetriableError')
    expect(removeMock).toHaveBeenCalledWith([waveformObjectKey])
    expect(reconcileMaybeSingleMock).not.toHaveBeenCalled()
  })

  test('treats an ambiguous response as success when reconciliation finds the key', async () => {
    finalizeSingleMock.mockResolvedValue({
      data: null,
      error: { code: 'ETIMEDOUT', message: 'response lost' },
    })

    const { result, error } = await execute()

    expect(error).toBeUndefined()
    expect(result).toMatchObject({ status: 'ready', transcriptId })
    expect(reconcileMaybeSingleMock).toHaveBeenCalled()
    expect(reconcileSelectMock).toHaveBeenCalledWith(
      'waveform_object_key, waveform_status, waveform_points_per_second, waveform_version'
    )
    expect(removeMock).not.toHaveBeenCalled()
  })

  test.each([
    ['status', { waveform_status: 'processing' }],
    ['version', { waveform_version: 2 }],
    ['points per second', { waveform_points_per_second: 2 }],
  ])('does not accept a matching key with different %s', async (_field, override) => {
    finalizeSingleMock.mockResolvedValue({
      data: null,
      error: { code: 'ETIMEDOUT', message: 'response lost' },
    })
    reconcileMaybeSingleMock.mockResolvedValue({
      data: {
        waveform_object_key: waveformObjectKey,
        waveform_status: 'ready',
        waveform_points_per_second: 1,
        waveform_version: 1,
        ...override,
      },
      error: null,
    })

    const { error } = await execute()

    expect(getErrorMessage(error)).toContain('response lost')
    expect(removeMock).toHaveBeenCalledWith([waveformObjectKey])
  })

  test('removes the upload and preserves a retriable error when reconciliation differs', async () => {
    finalizeSingleMock.mockResolvedValue({
      data: null,
      error: { code: 'ETIMEDOUT', message: 'response lost' },
    })
    reconcileMaybeSingleMock.mockResolvedValue({
      data: {
        waveform_object_key: 'different-key',
        waveform_status: 'ready',
        waveform_points_per_second: 1,
        waveform_version: 1,
      },
      error: null,
    })

    const { error } = await execute()

    expect(getErrorMessage(error)).toContain('response lost')
    expect((error as { name?: string })?.name).not.toBe('NonRetriableError')
    expect(removeMock).toHaveBeenCalledWith([waveformObjectKey])
  })

  test('does not touch storage when reconciliation itself fails', async () => {
    finalizeSingleMock.mockResolvedValue({
      data: null,
      error: { code: 'ETIMEDOUT', message: 'response lost' },
    })
    reconcileMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: 'read failed' },
    })

    const { error } = await execute()

    expect(getErrorMessage(error)).toContain('reconciliation failed: read failed')
    expect(removeMock).not.toHaveBeenCalled()
  })
})
