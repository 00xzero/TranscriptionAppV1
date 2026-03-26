/**
 * Core: Create Project
 *
 * Business logic for creating a new project.
 * Receives an authenticated Supabase client and validated input — no NextRequest.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CreateProjectBody } from '@/contracts/api'

export interface ProjectCreated {
    id: string
    status: string
    title: string
    created_at: string
    updated_at: string
}

export interface CreateProjectResult {
    project: ProjectCreated & { key_terms: string[] }
    storagePath: string
}

export async function createProject(
    supabase: SupabaseClient,
    userId: string,
    input: CreateProjectBody
): Promise<CreateProjectResult> {
    const { title, filename, key_terms } = input

    // Insert project row
    const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({
            user_id: userId,
            title: title || filename,
            status: 'created',
        })
        .select('id, status, title, created_at, updated_at')
        .single()

    if (projectError || !project) {
        throw new Error(projectError?.message ?? 'Failed to create project')
    }

    // Insert key terms into watchlist if provided (non-fatal)
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
            console.error('[createProject] Watchlist insert error:', watchlistError)
        }
    }

    // Build storage path with sanitized filename
    const sanitizedFilename = filename
        .replace(/[/\\]/g, '_')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 200) || 'media'

    const storagePath = `${userId}/${project.id}/${sanitizedFilename}`

    return {
        project: {
            id: project.id,
            status: project.status,
            title: project.title,
            created_at: project.created_at,
            updated_at: project.updated_at,
            key_terms: key_terms || [],
        },
        storagePath,
    }
}
