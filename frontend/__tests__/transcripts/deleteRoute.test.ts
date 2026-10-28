/** @jest-environment node */

const getCurrentUserMock = jest.fn()
const rpcMock = jest.fn()
const storageFromMock = jest.fn()
const trustedStorageFromMock = jest.fn()

jest.mock('@/lib/auth/current-user.server', () => ({
  getCurrentUser: () => getCurrentUserMock(),
}))

jest.mock('@/infra/supabase/server', () => ({
  createClient: async () => ({
    [Symbol.asyncDispose]: async () => {},
    rpc: rpcMock,
    storage: { from: storageFromMock },
  }),
}))

jest.mock('@/infra/supabase/admin', () => ({
  createAdminClient: () => ({ storage: { from: trustedStorageFromMock } }),
}))

import { POST } from '@/app/api/transcripts/[id]/delete/route'

const TRANSCRIPT_ID = '33333333-3333-4333-8333-333333333333'
const MEDIA_KEY = `user-1/${TRANSCRIPT_ID}/audio.webm`
const WAVEFORM_KEY = `user-1/${TRANSCRIPT_ID}/waveform.json`

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null }

function request(id = TRANSCRIPT_ID) {
  return POST(new Request(`http://localhost/api/transcripts/${id}/delete`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  })
}

function inventory(media: string[] = [MEDIA_KEY], waveforms: string[] = [WAVEFORM_KEY]): RpcResult {
  return { data: [{ media_keys: media, waveform_keys: waveforms }], error: null }
}

describe('transcript delete route', () => {
  let callOrder: string[]
  let inventoryResults: RpcResult[]
  let deleteResults: RpcResult[]

  beforeEach(() => {
    jest.clearAllMocks()
    callOrder = []
    inventoryResults = []
    deleteResults = []
    getCurrentUserMock.mockResolvedValue({ id: 'user-1', email: '' })
    rpcMock.mockImplementation(async (name: string) => {
      callOrder.push(name)
      if (name === 'transcript_delete_inventory') {
        return inventoryResults.shift() ?? inventory([], [])
      }
      if (name === 'delete_transcript') {
        return deleteResults.shift() ?? { data: null, error: null }
      }
      throw new Error(`unexpected rpc ${name}`)
    })
    storageFromMock.mockImplementation((bucket: string) => ({
      remove: jest.fn(async (keys: string[]) => {
        callOrder.push(`storage:${bucket}`)
        return { data: keys.map((name) => ({ name })), error: null }
      }),
      info: jest.fn(),
    }))
    trustedStorageFromMock.mockImplementation(() => ({
      info: jest.fn(async () => ({ data: null, error: { code: 'NoSuchKey' } })),
    }))
  })

  test('requires authentication before touching anything', async () => {
    getCurrentUserMock.mockResolvedValue(null)

    const response = await request()

    expect(response.status).toBe(401)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  test('rejects an invalid transcript id', async () => {
    const response = await request('not-a-uuid')

    expect(response.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  test('sweeps the folder, deletes the row, then sweeps once more', async () => {
    inventoryResults = [inventory()]

    const response = await request()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: true })
    expect(callOrder[0]).toBe('transcript_delete_inventory')
    expect(callOrder.slice(1, 3)).toEqual(
      expect.arrayContaining(['storage:media', 'storage:waveforms'])
    )
    expect(callOrder[3]).toBe('delete_transcript')
    expect(callOrder[4]).toBe('transcript_delete_inventory')
    expect(rpcMock).toHaveBeenCalledWith('delete_transcript', { p_id: TRANSCRIPT_ID })
  })

  test('never deletes the row while a file could not be removed', async () => {
    inventoryResults = [inventory()]
    storageFromMock.mockImplementation((bucket: string) => ({
      remove: jest.fn(async (keys: string[]) =>
        bucket === 'waveforms'
          ? { data: null, error: { message: 'storage unavailable' } }
          : { data: keys.map((name) => ({ name })), error: null }
      ),
      info: jest.fn(),
    }))

    const response = await request()

    expect(response.status).toBe(502)
    expect(rpcMock).not.toHaveBeenCalledWith('delete_transcript', expect.anything())
  })

  test('never deletes the row when the folder inventory cannot be read', async () => {
    inventoryResults = [{ data: null, error: { message: 'inventory unavailable' } }]

    const response = await request()

    expect(response.status).toBe(502)
    expect(rpcMock).not.toHaveBeenCalledWith('delete_transcript', expect.anything())
  })

  test('sweeps again when a file appeared before the delete (TR002)', async () => {
    const lateKey = `user-1/${TRANSCRIPT_ID}/late.webm`
    inventoryResults = [inventory(), inventory([lateKey], [])]
    deleteResults = [{ data: null, error: { code: 'TR002' } }]

    const response = await request()

    expect(response.status).toBe(200)
    expect(rpcMock.mock.calls.filter(([name]) => name === 'delete_transcript')).toHaveLength(2)
  })

  test('gives up with a retryable conflict after three refused attempts', async () => {
    deleteResults = Array.from({ length: 3 }, () => ({ data: null, error: { code: 'TR002' } }))

    const response = await request()

    expect(response.status).toBe(409)
    expect(rpcMock.mock.calls.filter(([name]) => name === 'delete_transcript')).toHaveLength(3)
  })

  test('reports an already-deleted transcript as gone after sweeping its folder', async () => {
    inventoryResults = [inventory()]
    deleteResults = [{ data: null, error: { code: 'TR001' } }]

    const response = await request()

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ gone: true })
    expect(callOrder).toEqual(expect.arrayContaining(['storage:media', 'storage:waveforms']))
  })

  test('sweeps again before reporting gone, catching a file that landed after the first sweep', async () => {
    const lateKey = `user-1/${TRANSCRIPT_ID}/late.webm`
    inventoryResults = [inventory([], []), inventory([lateKey], [])]
    deleteResults = [{ data: null, error: { code: 'TR001' } }]
    const mediaRemoves: string[][] = []
    storageFromMock.mockImplementation((bucket: string) => ({
      remove: jest.fn(async (keys: string[]) => {
        if (bucket === 'media') mediaRemoves.push(keys)
        return { data: keys.map((name) => ({ name })), error: null }
      }),
      info: jest.fn(),
    }))

    const response = await request()

    expect(response.status).toBe(404)
    expect(callOrder).toEqual([
      'transcript_delete_inventory',
      'delete_transcript',
      'transcript_delete_inventory',
    ])
    expect(mediaRemoves).toContainEqual([lateKey])
  })

  test('refuses while the transcript project is being deleted (PJ002)', async () => {
    deleteResults = [{ data: null, error: { code: 'PJ002' } }]

    const response = await request()

    expect(response.status).toBe(409)
    expect(await response.json()).not.toHaveProperty('gone')
  })

  test('maps an unexpected database error to 500', async () => {
    deleteResults = [{ data: null, error: { code: 'XX000' } }]

    const response = await request()

    expect(response.status).toBe(500)
  })

  test('a failed post-delete sweep is logged and still reports success', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    inventoryResults = [inventory(), { data: null, error: { message: 'inventory unavailable' } }]

    const response = await request()

    expect(response.status).toBe(200)
    expect(consoleError).toHaveBeenCalledWith(
      `[transcripts] Post-delete sweep failed for ${TRANSCRIPT_ID}:`,
      expect.objectContaining({ message: 'inventory unavailable' })
    )
    consoleError.mockRestore()
  })
})
