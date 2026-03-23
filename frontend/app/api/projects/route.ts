/**
 * API Route: POST /api/projects
 * 
 * Create a new project and prepare for media upload.
 * Returns project ID and storage path for client-side upload.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { CreateProjectBodySchema } from '@/lib/schemas/api'

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
        const parsed = CreateProjectBodySchema.safeParse(await request.json())
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0].message },
                { status: 400 }
            )
        }
        const { title, filename, key_terms } = parsed.data

        // Create project
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .insert({
                user_id: user.id,
                title: title || filename,
                status: 'created',
                // source_object_key will be set after upload completes
            })
            .select('id, status, title, created_at, updated_at')
            .single()

        if (projectError) {
            console.error('[api/projects] Create error:', projectError)
            return NextResponse.json(
                { error: 'Failed to create project' },
                { status: 500 }
            )
        }

        // Insert key terms into watchlist if provided
        if (key_terms && key_terms.length > 0) {
            const watchlistItems = key_terms.map(term => ({
                project_id: project.id,
                term: term,
                canonical: term.toLowerCase(),
            }))

            const { error: watchlistError } = await supabase
                .from('watchlist')
                .insert(watchlistItems)

            if (watchlistError) {
                console.error('[api/projects] Watchlist insert error:', watchlistError)
                // Non-fatal: project is created, just log the error
            }
        }

        // Build storage path
        // Sanitize filename for storage path
        const sanitizedFilename = filename
            .replace(/[/\\]/g, '_')
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .slice(0, 200) || 'media'

        const storagePath = `${user.id}/${project.id}/${sanitizedFilename}`

        return NextResponse.json({
            project: {
                id: project.id,
                status: project.status,
                title: project.title,
                created_at: project.created_at,
                updated_at: project.updated_at,
                key_terms: key_terms || [],
            },
            storagePath,
        })
    } catch (error) {
        console.error('[api/projects] Unexpected error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}
