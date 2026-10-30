import {
  DeleteTranscriptErrorSchema,
  DeleteTranscriptResponseSchema,
  type DeleteTranscriptError,
} from '@/contracts/api'
import { accountBoundFetch } from '@/lib/auth/account-bound-fetch'

export class DeleteTranscriptRequestError extends Error {
  readonly status: number

  constructor(status: number, details: DeleteTranscriptError | null, cause?: unknown) {
    super(
      details?.error ?? `The transcript delete request returned an invalid response (${status}).`,
      cause === undefined ? undefined : { cause }
    )
    this.name = 'DeleteTranscriptRequestError'
    this.status = status
  }
}

/**
 * Delete a transcript and every file in its folder. Resolves once the row is
 * gone, including when an earlier request already deleted it.
 */
export async function deleteTranscriptRequest(id: string, expectedUserId: string): Promise<void> {
  const response = await accountBoundFetch(`/api/transcripts/${id}/delete`, {
    method: 'POST',
  }, expectedUserId)
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    throw new DeleteTranscriptRequestError(response.status, null, error)
  }

  if (response.ok) {
    const parsed = DeleteTranscriptResponseSchema.safeParse(body)
    if (!parsed.success) {
      throw new DeleteTranscriptRequestError(response.status, null, parsed.error)
    }
    return
  }

  const parsed = DeleteTranscriptErrorSchema.safeParse(body)
  if (!parsed.success) {
    throw new DeleteTranscriptRequestError(response.status, null, parsed.error)
  }
  if (parsed.data.gone) return
  throw new DeleteTranscriptRequestError(response.status, parsed.data)
}
