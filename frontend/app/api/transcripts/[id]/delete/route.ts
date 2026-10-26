import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DeleteTranscriptErrorSchema,
  DeleteTranscriptResponseSchema,
  type DeleteTranscriptError,
} from '@/contracts/api'
import { UuidSchema } from '@/contracts/primitives'
import { createClient } from '@/infra/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user.server'
import { createAdminClient } from '@/infra/supabase/admin'
import { getProjectErrorCode } from '@/lib/supabase/project-errors'
import { sweepTranscriptFolders } from '@/lib/transcripts/folder-cleanup'
import { ACCOUNT_CHANGED_MESSAGE, EXPECTED_USER_HEADER } from '@/lib/auth/account-boundary'

// delete_transcript refuses (TR002) while the folder holds a file that was not
// there when it was swept; each attempt sweeps again.
const MAX_ATTEMPTS = 3

const FILES_REMAIN_MESSAGE =
  'Some files could not be removed. Nothing was deleted from your library. Try again.'
const PROJECT_DELETING_MESSAGE = "This transcript's project is being deleted."
const CHANGED_MESSAGE = 'The transcript changed while it was being deleted. Try again.'
const GENERIC_MESSAGE = 'The transcript could not be deleted. Try again.'

function errorResponse(body: DeleteTranscriptError, status: number) {
  return NextResponse.json(DeleteTranscriptErrorSchema.parse(body), { status })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const user = await getCurrentUser(supabase)
  if (!user) {
    return errorResponse({ error: 'Unauthorized' }, 401)
  }

  const expectedUserId = request.headers.get(EXPECTED_USER_HEADER)
  if (expectedUserId !== null && expectedUserId !== user.id) {
    return errorResponse({ error: ACCOUNT_CHANGED_MESSAGE }, 409)
  }

  const parsedId = UuidSchema.safeParse((await params).id)
  if (!parsedId.success) {
    return errorResponse({ error: 'Invalid transcript id' }, 400)
  }
  const transcriptId = parsedId.data
  const userId = user.id

  let verificationSupabase: SupabaseClient
  try {
    verificationSupabase = createAdminClient()
  } catch (error) {
    console.error('[transcripts] Trusted storage verification is unavailable:', error)
    return errorResponse({ error: FILES_REMAIN_MESSAGE }, 502)
  }

  // Resolves to the keys that could not be removed; throws if the folder
  // inventory cannot be read.
  const sweep = async () =>
    (await sweepTranscriptFolders(supabase, verificationSupabase, userId, [transcriptId])).failed

  // Catches files that committed between delete_transcript's check and its
  // commit. Best effort: the row is already gone, so a failure only logs.
  const sweepAfterDelete = async () => {
    try {
      const failed = await sweep()
      if (failed.length > 0) {
        console.error(`[transcripts] Post-delete sweep left files for ${transcriptId}:`, failed)
      }
    } catch (error) {
      console.error(`[transcripts] Post-delete sweep failed for ${transcriptId}:`, error)
    }
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // The row must outlive its files: never delete it while a sweep is unconfirmed.
    let failed: string[]
    try {
      failed = await sweep()
    } catch (error) {
      console.error(`[transcripts] Could not read the folder of ${transcriptId}:`, error)
      return errorResponse({ error: FILES_REMAIN_MESSAGE }, 502)
    }
    if (failed.length > 0) {
      return errorResponse({ error: FILES_REMAIN_MESSAGE }, 502)
    }

    const { error } = await supabase.rpc('delete_transcript', { p_id: transcriptId })
    if (!error) {
      await sweepAfterDelete()
      return NextResponse.json(DeleteTranscriptResponseSchema.parse({ deleted: true }))
    }

    switch (getProjectErrorCode(error)) {
      case 'TR001':
        // Already deleted. A file can land between this attempt's sweep and the
        // check, just as on success, so sweep once more before reporting gone.
        await sweepAfterDelete()
        return errorResponse({ error: 'Transcript not found', gone: true }, 404)
      case 'PJ002':
        return errorResponse({ error: PROJECT_DELETING_MESSAGE }, 409)
      case 'TR002':
        // A file landed after the sweep; only another sweep can change the outcome.
        continue
      default:
        console.error(`[transcripts] Delete failed for ${transcriptId}:`, error)
        return errorResponse({ error: GENERIC_MESSAGE }, 500)
    }
  }

  return errorResponse({ error: CHANGED_MESSAGE }, 409)
}
