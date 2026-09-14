/** @jest-environment node */

import {
  isMissingStorageObjectError,
  removeStorageObjectIfPresent,
  removeStorageObjectsBatched,
} from '@/infra/supabase/storage'
import type { SupabaseClient } from '@supabase/supabase-js'

function buildClient(remove: jest.Mock, info = jest.fn()) {
  return {
    storage: { from: jest.fn(() => ({ info, remove })) },
  } as unknown as SupabaseClient
}

describe('storage object helpers', () => {
  test('recognises the storage missing-object variants', () => {
    expect(isMissingStorageObjectError({ code: 'NoSuchKey' })).toBe(true)
    expect(isMissingStorageObjectError({ error: 'NoSuchKey' })).toBe(true)
    expect(isMissingStorageObjectError({ message: 'Object not found' })).toBe(false)
    expect(isMissingStorageObjectError({ message: 'permission denied' })).toBe(false)
  })

  test('tolerates an already-missing single object', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const info = jest.fn().mockResolvedValue({
      data: null,
      error: { code: 'NoSuchKey', message: 'Object not found' },
    })
    const remove = jest.fn()

    await expect(
      removeStorageObjectIfPresent(buildClient(remove, info), 'media', 'user-1/old-key', 'user-1')
    ).resolves.toBeUndefined()
    expect(remove).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('does not trust a missing response outside the owners storage prefix', async () => {
    const missing = { code: 'NoSuchKey', message: 'Object not found' }
    const info = jest.fn().mockResolvedValue({ data: null, error: missing })

    await expect(
      removeStorageObjectIfPresent(
        buildClient(jest.fn(), info),
        'media',
        'another-user/old-key',
        'user-1'
      )
    ).rejects.toEqual(missing)
  })

  test('rejects an empty delete response while the object still exists', async () => {
    const info = jest.fn().mockResolvedValue({ data: { name: 'user-1/key' }, error: null })
    const remove = jest.fn().mockResolvedValue({ data: [], error: null })

    await expect(
      removeStorageObjectIfPresent(buildClient(remove, info), 'media', 'user-1/key', 'user-1')
    ).rejects.toThrow('Storage did not remove object')
    expect(info).toHaveBeenCalledTimes(2)
  })

  test('accepts an ambiguous delete when the object disappeared concurrently', async () => {
    const info = jest
      .fn()
      .mockResolvedValueOnce({ data: { name: 'user-1/key' }, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'NoSuchKey', message: 'Object not found' },
      })
    const remove = jest.fn().mockResolvedValue({ data: [], error: null })

    await expect(
      removeStorageObjectIfPresent(buildClient(remove, info), 'media', 'user-1/key', 'user-1')
    ).resolves.toBeUndefined()
  })

  test('removes unique keys in bounded batches', async () => {
    const remove = jest.fn().mockImplementation(async (keys: string[]) => ({
      data: keys.map((name) => ({ name })),
      error: null,
    }))

    await expect(
      removeStorageObjectsBatched(
        buildClient(remove),
        'media',
        ['a', 'b', 'b', 'c', 'd', 'e'],
        2
      )
    ).resolves.toEqual({ removed: 5, failed: [] })
    expect(remove.mock.calls.map(([keys]) => keys)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ])
  })

  test('reports every key from failed batches and continues', async () => {
    const remove = jest
      .fn()
      .mockResolvedValueOnce({ error: { message: 'bucket unavailable' } })
      .mockResolvedValueOnce({ data: [{ name: 'c' }], error: null })

    await expect(
      removeStorageObjectsBatched(buildClient(remove), 'waveforms', ['a', 'b', 'c'], 2)
    ).resolves.toEqual({ removed: 1, failed: ['a', 'b'] })
  })

  test('counts only objects the storage API reports as removed', async () => {
    const remove = jest.fn().mockResolvedValue({ data: [{ name: 'a' }], error: null })

    await expect(
      removeStorageObjectsBatched(buildClient(remove), 'media', ['a', 'already-missing'])
    ).resolves.toEqual({ removed: 1, failed: [] })
  })

  test('rejects an invalid batch size', async () => {
    await expect(
      removeStorageObjectsBatched(buildClient(jest.fn()), 'media', ['a'], 0)
    ).rejects.toThrow('batchSize must be a positive integer')
  })
})
