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
        buildClient(jest.fn()),
        'media',
        ['user-1/a', 'user-1/b', 'user-1/b', 'user-1/c', 'user-1/d', 'user-1/e'],
        'user-1',
        2
      )
    ).resolves.toEqual({ removed: 5, failed: [] })
    expect(remove.mock.calls.map(([keys]) => keys)).toEqual([
      ['user-1/a', 'user-1/b'],
      ['user-1/c', 'user-1/d'],
      ['user-1/e'],
    ])
  })

  test('reports every key from failed batches and continues', async () => {
    const remove = jest
      .fn()
      .mockResolvedValueOnce({ error: { message: 'bucket unavailable' } })
      .mockResolvedValueOnce({ data: [{ name: 'user-1/c' }], error: null })

    await expect(
      removeStorageObjectsBatched(
        buildClient(remove),
        buildClient(jest.fn()),
        'waveforms',
        ['user-1/a', 'user-1/b', 'user-1/c'],
        'user-1',
        2
      )
    ).resolves.toEqual({ removed: 1, failed: ['user-1/a', 'user-1/b'] })
  })

  test('verifies omitted objects after a partial success without inflating removed count', async () => {
    const remove = jest.fn().mockResolvedValue({
      data: [{ name: 'user-1/a' }],
      error: null,
    })
    const info = jest.fn().mockResolvedValue({
      data: null,
      error: { code: 'NoSuchKey', message: 'Object not found' },
    })

    await expect(
      removeStorageObjectsBatched(
        buildClient(remove),
        buildClient(jest.fn(), info),
        'media',
        ['user-1/a', 'user-1/already-missing'],
        'user-1'
      )
    ).resolves.toEqual({ removed: 1, failed: [] })
    expect(info).toHaveBeenCalledWith('user-1/already-missing')
  })

  test('reports an omitted object that still exists', async () => {
    const remove = jest.fn().mockResolvedValue({ data: [], error: null })
    const info = jest.fn().mockResolvedValue({
      data: { name: 'user-1/still-there' },
      error: null,
    })

    await expect(
      removeStorageObjectsBatched(
        buildClient(remove),
        buildClient(jest.fn(), info),
        'media',
        ['user-1/still-there'],
        'user-1'
      )
    ).resolves.toEqual({ removed: 0, failed: ['user-1/still-there'] })
  })

  test('does not trust an authenticated missing response when trusted verification finds the object', async () => {
    const remove = jest.fn().mockResolvedValue({ data: [], error: null })
    const authenticatedInfo = jest.fn().mockResolvedValue({
      data: null,
      error: { code: 'NoSuchKey', message: 'Object not found' },
    })
    const trustedInfo = jest.fn().mockResolvedValue({
      data: { name: 'user-1/rls-hidden' },
      error: null,
    })

    await expect(
      removeStorageObjectsBatched(
        buildClient(remove, authenticatedInfo),
        buildClient(jest.fn(), trustedInfo),
        'media',
        ['user-1/rls-hidden'],
        'user-1'
      )
    ).resolves.toEqual({ removed: 0, failed: ['user-1/rls-hidden'] })
    expect(authenticatedInfo).not.toHaveBeenCalled()
    expect(trustedInfo).toHaveBeenCalledWith('user-1/rls-hidden')
  })

  test('verifies every key after an ambiguous missing-object batch response', async () => {
    const remove = jest.fn().mockResolvedValue({
      data: null,
      error: { code: 'NoSuchKey', message: 'Object not found' },
    })
    const info = jest.fn().mockResolvedValue({
      data: null,
      error: { code: 'NoSuchKey', message: 'Object not found' },
    })

    await expect(
      removeStorageObjectsBatched(
        buildClient(remove),
        buildClient(jest.fn(), info),
        'media',
        ['user-1/a', 'user-1/b'],
        'user-1'
      )
    ).resolves.toEqual({ removed: 0, failed: [] })
    expect(info).toHaveBeenCalledTimes(2)
  })

  test('never trusts verified absence outside the authenticated owner prefix', async () => {
    const remove = jest.fn().mockResolvedValue({ data: [], error: null })
    const info = jest.fn()

    await expect(
      removeStorageObjectsBatched(
        buildClient(remove),
        buildClient(jest.fn(), info),
        'media',
        ['another-user/key'],
        'user-1'
      )
    ).resolves.toEqual({ removed: 0, failed: ['another-user/key'] })
    expect(remove).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  test('treats verification errors as unresolved', async () => {
    const remove = jest.fn().mockResolvedValue({ data: [], error: null })
    const info = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'storage unavailable' },
    })

    await expect(
      removeStorageObjectsBatched(
        buildClient(remove),
        buildClient(jest.fn(), info),
        'media',
        ['user-1/key'],
        'user-1'
      )
    ).resolves.toEqual({ removed: 0, failed: ['user-1/key'] })
  })

  test('ignores unexpected and duplicate response names', async () => {
    const remove = jest.fn().mockResolvedValue({
      data: [
        { name: 'user-1/a' },
        { name: 'user-1/a' },
        { name: 'another-user/unexpected' },
      ],
      error: null,
    })
    const info = jest.fn().mockResolvedValue({
      data: null,
      error: { code: 'NoSuchKey' },
    })

    await expect(
      removeStorageObjectsBatched(
        buildClient(remove),
        buildClient(jest.fn(), info),
        'media',
        ['user-1/a', 'user-1/b'],
        'user-1'
      )
    ).resolves.toEqual({ removed: 1, failed: [] })
    expect(info).toHaveBeenCalledTimes(1)
  })

  test('limits omitted-object verification to eight concurrent requests', async () => {
    let active = 0
    let maximumActive = 0
    const remove = jest.fn().mockResolvedValue({ data: [], error: null })
    const info = jest.fn().mockImplementation(async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await Promise.resolve()
      active -= 1
      return { data: null, error: { code: 'NoSuchKey' } }
    })
    const keys = Array.from({ length: 20 }, (_, index) => `user-1/key-${index}`)

    await expect(
      removeStorageObjectsBatched(
        buildClient(remove),
        buildClient(jest.fn(), info),
        'media',
        keys,
        'user-1'
      )
    ).resolves.toEqual({ removed: 0, failed: [] })
    expect(maximumActive).toBeLessThanOrEqual(8)
    expect(info).toHaveBeenCalledTimes(20)
  })

  test('rejects an invalid batch size', async () => {
    await expect(
      removeStorageObjectsBatched(
        buildClient(jest.fn()),
        buildClient(jest.fn()),
        'media',
        ['user-1/a'],
        'user-1',
        0
      )
    ).rejects.toThrow('batchSize must be a positive integer')
  })
})
