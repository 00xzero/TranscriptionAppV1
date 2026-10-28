/**
 * API Route: POST /api/transcripts
 *
 * Create a new transcript and prepare for media upload.
 * Returns transcript ID and storage path for client-side upload.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/infra/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user.server'
import { CreateTranscriptBodySchema } from '@/contracts/api'
import { createTranscript } from '@/core/transcripts/create'
import { ACCOUNT_CHANGED_CODE, ACCOUNT_CHANGED_MESSAGE, EXPECTED_USER_HEADER } from '@/lib/auth/account-boundary'

export async function POST(request: NextRequest) {
    try {
        await using supabase = await createClient({ refreshSession: true })

        const user = await getCurrentUser(supabase)
        if (!user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            )
        }

        // A cookie is shared by tabs; a tab's cached token and displayed user
        // can still be A after another tab signs in as B. Refuse before writing.
        if (request.headers.get(EXPECTED_USER_HEADER) !== user.id) {
            return NextResponse.json(
                { error: ACCOUNT_CHANGED_MESSAGE, code: ACCOUNT_CHANGED_CODE },
                { status: 409 }
            )
        }

        // Parse and validate request body
        const parsed = CreateTranscriptBodySchema.safeParse(await request.json())
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
                { status: 400 }
            )
        }

        const result = await createTranscript(supabase, user.id, parsed.data)

        return NextResponse.json(result)
    } catch (error) {
        console.error('[api/transcripts] Unexpected error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}
