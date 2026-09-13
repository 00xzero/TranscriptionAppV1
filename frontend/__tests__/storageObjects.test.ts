/** @jest-environment node */

import {
  isMissingStorageObjectError,
  removeStorageObjectIfPresent,
  removeStorageObjectsBatched,
} from '@/infra/supabase/storage'
import type { SupabaseClient } from '@supabase/supabase-js'

function buildClient(remove: jest.Mock) {
  return {
    storage: { from: jest.fn(() => ({ remove })) },
  } as unknown as SupabaseClient
}

describe('storage object helpers', () => {
  test('recognises the storage missing-object variants', () => {
    expect(isMissingStorageObjectError({ code: 'NoSuchKey' })).toBe(true)
    expect(isMissingStorageObjectError({ message: 'Object not found' })).toBe(true)
    expect(isMissingStorageObjectError({ message: 'permission denied' })).toBe(false)
  })

  test('tolerates an already-missing single object', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const remove = jest.fn().mockResolvedValue({ error: { error: 'NoSuchKey' } })

    await expect(
      removeStorageObjectIfPresent(buildClient(remove), 'media', 'old-key')
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
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
