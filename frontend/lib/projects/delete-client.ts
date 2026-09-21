import {
  DeleteProjectErrorSchema,
  DeleteProjectResponseSchema,
  type DeleteProjectError,
  type DeleteProjectResponse,
} from '@/contracts/api'

export class DeleteProjectRequestError extends Error {
  readonly status: number
  readonly stage: DeleteProjectError['stage'] | null
  readonly gone: boolean
  readonly removedMedia?: number
  readonly removedWaveforms?: number
  readonly remainingTranscripts?: number

  constructor(status: number, details: DeleteProjectError | null, cause?: unknown) {
    super(
      details?.error ?? `The project delete request returned an invalid response (${status}).`,
      cause === undefined ? undefined : { cause }
    )
    this.name = 'DeleteProjectRequestError'
    this.status = status
    this.stage = details?.stage ?? null
    this.gone = Boolean(details && 'gone' in details && details.gone === true)
    this.removedMedia = details?.stage === 'storage' ? details.removed_media : undefined
    this.removedWaveforms = details?.stage === 'storage' ? details.removed_waveforms : undefined
    this.remainingTranscripts =
      details?.stage === 'storage' || details?.stage === 'finish'
        ? details.remaining_transcripts
        : undefined
  }
}

export async function deleteProjectRequest(id: string): Promise<DeleteProjectResponse> {
  const response = await fetch(`/api/projects/${id}/delete`, { method: 'POST' })
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    throw new DeleteProjectRequestError(response.status, null, error)
  }

  if (response.ok) {
    const parsed = DeleteProjectResponseSchema.safeParse(body)
    if (!parsed.success) {
      throw new DeleteProjectRequestError(response.status, null, parsed.error)
    }
    return parsed.data
  }

  const parsed = DeleteProjectErrorSchema.safeParse(body)
  if (!parsed.success) {
    throw new DeleteProjectRequestError(response.status, null, parsed.error)
  }
  throw new DeleteProjectRequestError(response.status, parsed.data)
}
