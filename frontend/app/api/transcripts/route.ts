/**
 * API Route: POST /api/transcripts
 *
 * Create a new transcript and prepare for media upload.
 * Returns transcript ID and storage path for client-side upload.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/infra/supabase/server'
import { CreateTranscriptBodySchema } from '@/contracts/api'
import { createTranscript } from '@/core/transcripts/create'

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()

        // Get authenticated user
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
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
