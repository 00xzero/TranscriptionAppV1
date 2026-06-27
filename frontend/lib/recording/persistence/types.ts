/**
 * Durable recording persistence — schema and adapter contract.
 *
 * Phase 1 mirrors live recording data (raw chunks + session metadata) to local
 * storage so a later phase can offer best-effort crash recovery. `userId` and
 * `uploadIntentId` are reserved here but left `null` until Phase 2.
 */

import { z } from 'zod'

export const PersistedSessionPhaseSchema = z.enum(['capturing', 'uploading'])

export const PersistedSessionSchema = z.object({
  sessionId: z.string(),
  // Reserved for Phase 2 (recovery scoping + upload idempotency). Null in Phase 1.
  userId: z.string().nullable(),
  uploadIntentId: z.string().nullable(),
  title: z.string().nullable(),
  generatedTitle: z.string().nullable(),
  keyTerms: z.array(z.string()),
  codecMime: z.string().nullable(),
  codecExtension: z.enum(['webm', 'mp4']).nullable(),
  deviceId: z.string().nullable(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  lastResumeAt: z.number().nullable(),
  pausedAccumulatedMs: z.number(),
  // Advisory counters — the chunk stream is authoritative for recoverability.
  bytesSoFar: z.number(),
  lastChunkSeq: z.number().nullable(),
  lastChunkReceivedAt: z.number().nullable(),
  phase: PersistedSessionPhaseSchema,
  // Live/UI signal only; recovery validity is decided structurally, not from this.
  armed: z.boolean(),
  failureReason: z.string().nullable(),
})

export type PersistedSession = z.infer<typeof PersistedSessionSchema>
export type PersistedSessionPhase = z.infer<typeof PersistedSessionPhaseSchema>

/**
 * `sessionId` and `createdAt` are immutable after the initial write, so the patch
 * type omits them — timing/counter/phase updates can never rewrite identity.
 */
export type PersistedSessionPatch = Partial<
  Omit<PersistedSession, 'sessionId' | 'createdAt'>
>

/**
 * Thin storage seam injected into the recording session. Production uses the
 * IndexedDB adapter; tests use the in-memory fake or `fake-indexeddb`.
 *
 * Implementations must never throw synchronously and should reject (not throw)
 * on failure so the write-behind queue can downgrade without affecting recording.
 */
export interface SessionPersistence {
  /**
   * Up-front durability capability. `false` means this adapter never persists
   * anything (no IndexedDB / SSR), so a session backed by it is unarmed for its
   * whole life. This must be detected here rather than inferred from a write
   * failure: the no-op adapter resolves every write successfully, so the failure
   * path would never fire and the unarmed warning would never show.
   */
  readonly durable: boolean
  putSession(record: PersistedSession): Promise<void>
  patchSession(sessionId: string, patch: PersistedSessionPatch): Promise<void>
  getSession(sessionId: string): Promise<PersistedSession | null>
  listSessions(): Promise<PersistedSession[]>
  /** Deletes the session row and every chunk belonging to it. */
  deleteSession(sessionId: string): Promise<void>
  putChunk(sessionId: string, seq: number, blob: Blob): Promise<void>
  listChunkSeqs(sessionId: string): Promise<number[]>
  /**
   * Metadata-only chunk summary: how many chunks exist and their total byte
   * size, without materializing any Blob body into memory. Used by the recovery
   * probe on the startup hot path so it never holds tens/hundreds of MB of audio
   * just to count chunks and sum bytes.
   */
  chunkStats(sessionId: string): Promise<{ count: number; totalBytes: number }>
  /** Returns the session's chunks ordered by ascending seq. */
  readChunks(sessionId: string): Promise<Blob[]>
}
