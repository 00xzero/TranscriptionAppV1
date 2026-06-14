import {
  validateChunkStream,
  meetsRecoveryFloor,
} from '@/lib/recording/persistence/validation'
import { EMPTY_FLOOR_BYTES } from '@/lib/recording/sizeBudget'

describe('validateChunkStream', () => {
  test('rejects an empty stream', () => {
    expect(validateChunkStream([])).toEqual({
      valid: false,
      reason: 'no_chunks',
    })
  })

  test('rejects a stream missing the seq=0 init chunk', () => {
    expect(validateChunkStream([1, 2, 3])).toEqual({
      valid: false,
      reason: 'missing_init_chunk',
    })
  })

  test('accepts a single init chunk', () => {
    expect(validateChunkStream([0])).toEqual({ valid: true })
  })

  test('accepts a contiguous 0..N stream', () => {
    expect(validateChunkStream([0, 1, 2, 3, 4])).toEqual({ valid: true })
  })

  test('accepts an out-of-order but complete stream', () => {
    expect(validateChunkStream([2, 0, 4, 1, 3])).toEqual({ valid: true })
  })

  test('rejects a gap in the stream', () => {
    expect(validateChunkStream([0, 1, 3])).toEqual({
      valid: false,
      reason: 'gap_in_stream',
    })
  })

  test('rejects a duplicate seq', () => {
    expect(validateChunkStream([0, 1, 1, 2])).toEqual({
      valid: false,
      reason: 'duplicate_seq',
    })
  })
})

describe('meetsRecoveryFloor', () => {
  test('rejects below the bytes floor', () => {
    expect(meetsRecoveryFloor(EMPTY_FLOOR_BYTES - 1)).toBe(false)
  })

  test('accepts at or above the bytes floor', () => {
    expect(meetsRecoveryFloor(EMPTY_FLOOR_BYTES)).toBe(true)
    expect(meetsRecoveryFloor(EMPTY_FLOOR_BYTES + 10_000)).toBe(true)
  })
})
