/**
 * API Route: GET /api/projects/[id]/waveform-url
 *
 * Returns a short-lived signed URL for the precomputed waveform peaks file.
 * Defense-in-depth:
 *   1. Project ownership verified via the user-authenticated client + RLS
 *   2. Stored waveform_object_key is path-shape-validated — we never blindly
 *      sign whatever string is in the column
 *
 * Returns 404 (not 403) on any failure to avoid leaking row existence.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/infra/supabase/server'

function makeNotFound() {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: projectId } = await params
        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('id, user_id, waveform_object_key, waveform_status')
            .eq('id', projectId)
            .single()
        if (projectError || !project) return makeNotFound()

        if (project.waveform_status !== 'ready') return makeNotFound()
        if (!project.waveform_object_key) return makeNotFound()

        // Path-shape validation: must match {userId}/{projectId}/waveform.json,
        // and userId must match the row's user_id (not the requester directly,
        // because admin/share scenarios may diverge later, but the row must own it).
        const expectedPath = `${project.user_id}/${project.id}/waveform.json`
        if (project.waveform_object_key !== expectedPath) {
            console.warn(
                `[waveform-url] Path mismatch for project ${projectId}: stored=${project.waveform_object_key}, expected=${expectedPath}`
            )
            return makeNotFound()
        }

        const { data, error: signedUrlError } = await supabase.storage
            .from('waveforms')
            .createSignedUrl(project.waveform_object_key, 600) // 10 min — UI fetches once
        if (signedUrlError || !data) {
            console.error('[waveform-url] Signed URL error:', signedUrlError)
            return NextResponse.json({ error: 'Failed to generate URL' }, { status: 500 })
        }

        let signedUrl = data.signedUrl
        if (signedUrl.includes('host.docker.internal')) {
            signedUrl = signedUrl.replace('host.docker.internal', 'localhost')
        }

        return NextResponse.json({ url: signedUrl })
    } catch (error) {
        console.error('[waveform-url] Unexpected error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
