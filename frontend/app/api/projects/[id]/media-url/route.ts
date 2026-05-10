/**
 * API Route: GET /api/projects/[id]/media-url
 * 
 * Generate a signed download URL for project media.
 * Used by the editor for audio/video playback.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/infra/supabase/server'
import { getSignedMediaUrl, localizeSignedUrl } from '@/infra/supabase/storage'

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: projectId } = await params
        const supabase = await createClient()

        // Get authenticated user
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            )
        }

        // Fetch project (RLS ensures user can only access their own)
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('id, source_object_key')
            .eq('id', projectId)
            .single()

        if (projectError || !project) {
            return NextResponse.json(
                { error: 'Project not found' },
                { status: 404 }
            )
        }

        if (!project.source_object_key) {
            return NextResponse.json(
                { error: 'No media file associated with this project' },
                { status: 404 }
            )
        }

        const signed = await getSignedMediaUrl(supabase, project.source_object_key, 3600)
        if (signed.error || !signed.url) {
            return NextResponse.json(
                { error: 'Failed to generate media URL' },
                { status: 500 }
            )
        }

        return NextResponse.json({ url: localizeSignedUrl(signed.url) })
    } catch (error) {
        console.error('[api/media-url] Unexpected error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}
