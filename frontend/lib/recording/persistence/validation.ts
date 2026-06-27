/**
 * Structural recovery validation.
 *
 * The chunk stream — not the advisory session counters — is authoritative for
 * recoverability. A stream is valid only if it includes the required init chunk
 * (`seq = 0`) and is contiguous `0..N` with no gaps or duplicates.
 */

import { EMPTY_FLOOR_BYTES } from '../sizeBudget'

export type ChunkStreamInvalidReason =
  | 'no_chunks'
  | 'missing_init_chunk'
  | 'gap_in_stream'
  | 'duplicate_seq'

export interface ChunkStreamValidation {
  valid: boolean
  reason?: ChunkStreamInvalidReason
}

export function validateChunkStream(seqs: number[]): ChunkStreamValidation {
  if (seqs.length === 0) return { valid: false, reason: 'no_chunks' }

  const sorted = [...seqs].sort((a, b) => a - b)

  // `seq = 0` is the required container/init chunk (EBML/Tracks for WebM, ftyp/moov
  // for fragmented MP4). Without it, later chunks are unrecoverable.
  if (sorted[0] !== 0) return { valid: false, reason: 'missing_init_chunk' }

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) return { valid: false, reason: 'duplicate_seq' }
    if (sorted[i] !== sorted[i - 1] + 1) return { valid: false, reason: 'gap_in_stream' }
  }

  return { valid: true }
}

/**
 * Recovery empty floor is bytes-only (distinct from the live-recording
 * `meetsEmptyFloor(activeMs, bytes)` which also requires a minimum duration).
 */
export function meetsRecoveryFloor(bytes: number): boolean {
  return bytes >= EMPTY_FLOOR_BYTES
}
