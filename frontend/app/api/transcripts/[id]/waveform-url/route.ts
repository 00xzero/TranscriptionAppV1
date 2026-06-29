/**
 * GET /api/transcripts/[id]/waveform-url — short-lived signed URL for the
 * precomputed waveform peaks artifact.
 *
 * Returns 404 (not 403) on lookup failures to avoid leaking row existence.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/infra/supabase/server'
import { getSignedMediaUrl, localizeSignedUrl } from '@/infra/supabase/storage'
import { WAVEFORM_BUCKET, buildWaveformObjectKey } from '@/lib/audio/compute-peaks'

function makeNotFound() {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: transcriptId } = await params
        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: transcript, error: transcriptError } = await supabase
            .from('transcripts')
            .select('id, user_id, waveform_object_key, waveform_status')
            .eq('id', transcriptId)
            .single()
        if (transcriptError || !transcript) return makeNotFound()

        if (transcript.waveform_status !== 'ready') return makeNotFound()
        if (!transcript.waveform_object_key) return makeNotFound()

        // Path-shape validation: never sign whatever string is in the column.
        const expectedPath = buildWaveformObjectKey(transcript.user_id, transcript.id)
        if (transcript.waveform_object_key !== expectedPath) {
            console.warn(
                `[waveform-url] Path mismatch for transcript ${transcriptId}: stored=${transcript.waveform_object_key}, expected=${expectedPath}`
            )
            return makeNotFound()
        }

        const signed = await getSignedMediaUrl(
            supabase,
            transcript.waveform_object_key,
            600,
            WAVEFORM_BUCKET
        )
        if (signed.error || !signed.url) {
            return NextResponse.json({ error: 'Failed to generate URL' }, { status: 500 })
        }

        return NextResponse.json({ url: localizeSignedUrl(signed.url) })
    } catch (error) {
        console.error('[waveform-url] Unexpected error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
