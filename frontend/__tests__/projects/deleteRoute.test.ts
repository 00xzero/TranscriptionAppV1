/** @jest-environment node */

const getUserMock = jest.fn()
const rpcMock = jest.fn()
const storageFromMock = jest.fn()
const createAdminClientMock = jest.fn()
const trustedStorageFromMock = jest.fn()

jest.mock('@/infra/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    rpc: rpcMock,
    storage: { from: storageFromMock },
  }),
}))

jest.mock('@/infra/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

import { POST } from '@/app/api/projects/[id]/delete/route'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

function request(id = PROJECT_ID) {
  return POST(new Request(`http://localhost/api/projects/${id}/delete`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  })
}

function inventory(overrides: Record<string, unknown> = {}) {
  return {
    project_ids: [PROJECT_ID],
    transcript_ids: ['22222222-2222-4222-8222-222222222222'],
    media_keys: ['user-1/t-1/audio.webm'],
    waveform_keys: ['user-1/t-1/waveform.json'],
    ...overrides,
  }
}

describe('project delete route', () => {
  let callOrder: string[]

  beforeEach(() => {
    jest.clearAllMocks()
    callOrder = []
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    rpcMock.mockImplementation(async (name: string) => {
      callOrder.push(name)
      if (name === 'begin_project_delete') return { data: [inventory()], error: null }
      return {
        data: [{ deleted_projects: 1, deleted_transcripts: 1 }],
        error: null,
      }
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
    createAdminClientMock.mockReturnValue({
      storage: { from: trustedStorageFromMock },
    })
  })

  test('requires authentication before beginning', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const response = await request()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized', stage: 'begin' })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  test('rejects an invalid project id', async () => {
    const response = await request('not-a-uuid')

    expect(response.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  test('runs begin, storage, and finish in order and returns verified counts', async () => {
    const response = await request()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted_projects: 1, deleted_transcripts: 1 })
    expect(callOrder[0]).toBe('begin_project_delete')
    expect(callOrder.slice(1, 3)).toEqual(
      expect.arrayContaining(['storage:media', 'storage:waveforms'])
    )
    expect(callOrder[3]).toBe('finish_project_delete')
  })

  test('maps PJ001 to gone without touching storage or finish', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: 'PJ001' } })

    const response = await request()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'Project not found',
      stage: 'begin',
      gone: true,
    })
    expect(storageFromMock).not.toHaveBeenCalled()
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  test('maps an unexpected begin failure to 500 without touching storage or finish', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: 'XX000' } })

    const response = await request()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'The project could not be prepared for deletion.',
      stage: 'begin',
    })
    expect(storageFromMock).not.toHaveBeenCalled()
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  test('fails safely when trusted storage verification is unavailable', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    createAdminClientMock.mockImplementationOnce(() => {
      throw new Error('Missing service role configuration')
    })

    const response = await request()

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({
      stage: 'storage',
      removed_media: 0,
      removed_waveforms: 0,
      remaining_transcripts: 1,
    })
    expect(storageFromMock).not.toHaveBeenCalled()
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      '[projects] Trusted storage verification is unavailable:',
      expect.any(Error)
    )
    consoleError.mockRestore()
  })

  test('reports accurate partial storage counts and never finishes', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [inventory({
        transcript_ids: ['t-1', 't-2', 't-3'],
        media_keys: ['user-1/media-1', 'user-1/media-2'],
        waveform_keys: ['user-1/wave-1'],
      })],
      error: null,
    })
    storageFromMock.mockImplementation((bucket: string) => ({
      remove: jest.fn(async (keys: string[]) => {
        if (bucket === 'media') {
          return { data: [keys[0]].map((name) => ({ name })), error: null }
        }
        return { data: null, error: { message: 'bucket unavailable' } }
      }),
    }))

    const response = await request()

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({
      stage: 'storage',
      removed_media: 1,
      removed_waveforms: 0,
      remaining_transcripts: 3,
    })
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  test('does not finish when trusted verification finds an object hidden from the user client', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [inventory({ media_keys: ['user-1/hidden'], waveform_keys: [] })],
      error: null,
    })
    const authenticatedInfo = jest.fn().mockResolvedValue({
      data: null,
      error: { code: 'NoSuchKey' },
    })
    storageFromMock.mockImplementation(() => ({
      remove: jest.fn(async () => ({ data: [], error: null })),
      info: authenticatedInfo,
    }))
    const trustedInfo = jest.fn().mockResolvedValue({
      data: { name: 'user-1/hidden' },
      error: null,
    })
    trustedStorageFromMock.mockImplementation(() => ({ info: trustedInfo }))

    const response = await request()

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({
      stage: 'storage',
      removed_media: 0,
      remaining_transcripts: 1,
    })
    expect(authenticatedInfo).not.toHaveBeenCalled()
    expect(trustedInfo).toHaveBeenCalledWith('user-1/hidden')
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  test('tolerates missing objects, filters null keys, and batches at 100', async () => {
    const mediaKeys = [
      null,
      ...Array.from({ length: 205 }, (_, index) => `user-1/media-${index}`),
    ]
    rpcMock.mockResolvedValueOnce({
      data: [inventory({ media_keys: mediaKeys, waveform_keys: [] })],
      error: null,
    })
    const removeMock = jest.fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'NoSuchKey' } })
      .mockImplementation(async (keys: string[]) => ({
        data: keys.map((name) => ({ name })),
        error: null,
      }))
    storageFromMock.mockImplementation((bucket: string) => ({
      remove: bucket === 'media' ? removeMock : jest.fn(async () => ({ data: [], error: null })),
      info: jest.fn(async () => ({ data: null, error: { code: 'NoSuchKey' } })),
    }))

    const response = await request()

    expect(response.status).toBe(200)
    expect(removeMock.mock.calls.map(([keys]) => keys.length)).toEqual([100, 100, 5])
    expect(removeMock.mock.calls.flatMap(([keys]) => keys)).not.toContain(null)
    expect(rpcMock).toHaveBeenLastCalledWith('finish_project_delete', {
      p_id: PROJECT_ID,
      p_transcript_ids: ['22222222-2222-4222-8222-222222222222'],
      p_media_keys: mediaKeys,
      p_waveform_keys: [],
    })
  })

  test('maps PJ004 to a retryable finish conflict', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [inventory()], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'PJ004' } })

    const response = await request()

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ stage: 'finish', remaining_transcripts: 1 })
  })

  test('maps PJ001 from a concurrent finish to gone', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [inventory()], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'PJ001' } })

    const response = await request()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'Project not found',
      stage: 'finish',
      gone: true,
      remaining_transcripts: 0,
    })
  })

  test('never returns a success shape when finish fails', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [inventory()], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'XX000' } })

    const response = await request()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toMatchObject({ stage: 'finish', remaining_transcripts: 1 })
    expect(body).not.toHaveProperty('deleted_projects')
  })
})
