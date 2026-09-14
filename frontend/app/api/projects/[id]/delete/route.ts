import { NextResponse } from 'next/server'
import {
  DeleteProjectErrorSchema,
  DeleteProjectResponseSchema,
  type DeleteProjectError,
} from '@/contracts/api'
import { UuidSchema } from '@/contracts/primitives'
import { createClient } from '@/infra/supabase/server'
import {
  MEDIA_BUCKET,
  removeStorageObjectsBatched,
  WAVEFORM_BUCKET,
} from '@/infra/supabase/storage'
import { getProjectErrorCode } from '@/lib/supabase/project-errors'

const DELETE_BATCH_SIZE = 100

export const maxDuration = 300

type BeginDeleteRow = {
  project_ids: string[] | null
  transcript_ids: string[] | null
  media_keys: Array<string | null> | null
  waveform_keys: Array<string | null> | null
}

type FinishDeleteRow = {
  deleted_projects: number
  deleted_transcripts: number
}

function errorResponse(
  body: DeleteProjectError,
  status: number
) {
  return NextResponse.json(DeleteProjectErrorSchema.parse(body), { status })
}

function nonNullKeys(keys: Array<string | null> | null | undefined): string[] {
  return (keys ?? []).filter((key): key is string => typeof key === 'string' && key.length > 0)
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) {
    return errorResponse({ error: 'Unauthorized', stage: 'begin' }, 401)
  }

  const parsedId = UuidSchema.safeParse((await params).id)
  if (!parsedId.success) {
    return errorResponse({ error: 'Invalid project id', stage: 'begin' }, 400)
  }

  const { data: beginData, error: beginError } = await supabase.rpc(
    'begin_project_delete',
    { p_id: parsedId.data }
  )
  if (beginError) {
    if (getProjectErrorCode(beginError) === 'PJ001') {
      return errorResponse(
        { error: 'Project not found', stage: 'begin', gone: true },
        404
      )
    }
    return errorResponse(
      { error: 'The project could not be prepared for deletion.', stage: 'begin' },
      500
    )
  }

  const inventory = (beginData as BeginDeleteRow[] | null)?.[0]
  if (!inventory) {
    return errorResponse(
      { error: 'The project deletion inventory was missing.', stage: 'begin' },
      500
    )
  }

  const transcriptIds = inventory.transcript_ids ?? []
  const mediaKeys = nonNullKeys(inventory.media_keys)
  const waveformKeys = nonNullKeys(inventory.waveform_keys)
  const [mediaResult, waveformResult] = await Promise.all([
    removeStorageObjectsBatched(supabase, MEDIA_BUCKET, mediaKeys, DELETE_BATCH_SIZE),
    removeStorageObjectsBatched(supabase, WAVEFORM_BUCKET, waveformKeys, DELETE_BATCH_SIZE),
  ])

  if (mediaResult.failed.length > 0 || waveformResult.failed.length > 0) {
    return errorResponse(
      {
        error:
          'Some files could not be removed. The project is still marked for deletion; nothing was deleted from your library. Try again to finish.',
        stage: 'storage',
        removed_media: mediaResult.removed,
        removed_waveforms: waveformResult.removed,
        remaining_transcripts: transcriptIds.length,
      },
      502
    )
  }

  const { data: finishData, error: finishError } = await supabase.rpc(
    'finish_project_delete',
    {
      p_id: parsedId.data,
      p_transcript_ids: inventory.transcript_ids ?? [],
      p_media_keys: inventory.media_keys ?? [],
      p_waveform_keys: inventory.waveform_keys ?? [],
    }
  )
  if (finishError) {
    const finishErrorCode = getProjectErrorCode(finishError)
    if (finishErrorCode === 'PJ001') {
      return errorResponse(
        {
          error: 'Project not found',
          stage: 'finish',
          gone: true,
          remaining_transcripts: 0,
        },
        404
      )
    }
    if (finishErrorCode === 'PJ004') {
      return errorResponse(
        {
          error: 'The project changed while it was being deleted. Try again to finish.',
          stage: 'finish',
          remaining_transcripts: transcriptIds.length,
        },
        409
      )
    }
    return errorResponse(
      {
        error: 'Files were removed but the records could not be deleted. Try again to finish.',
        stage: 'finish',
        remaining_transcripts: transcriptIds.length,
      },
      500
    )
  }

  const deleted = (finishData as FinishDeleteRow[] | null)?.[0]
  if (!deleted) {
    return errorResponse(
      {
        error: 'Files were removed but the deletion result was missing. Try again to finish.',
        stage: 'finish',
        remaining_transcripts: transcriptIds.length,
      },
      500
    )
  }

  return NextResponse.json(DeleteProjectResponseSchema.parse(deleted))
}
