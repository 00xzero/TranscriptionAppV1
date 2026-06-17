/**
 * Core: Create Project
 *
 * Business logic for creating a new project.
 * Receives an authenticated Supabase client and validated input — no NextRequest.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CreateProjectBody } from '@/contracts/api'
import { getMediaPath } from '@/infra/supabase/storage'

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
    /** True when an existing project was returned via upload-intent dedup. */
    deduped: boolean
    /** Already-linked media key when the canonical project has one (else null). */
    sourceObjectKey: string | null
    /** Canonical project status, surfaced for idempotent client resume. */
    status: string
}

/** Project row shape selected for building the canonical result. */
interface ProjectRow {
    id: string
    status: string
    title: string
    source_object_key: string | null
    created_at: string
    updated_at: string
}

const PROJECT_RESULT_COLUMNS =
    'id, status, title, source_object_key, created_at, updated_at'

export async function createProject(
    supabase: SupabaseClient,
    userId: string,
    input: CreateProjectBody
): Promise<CreateProjectResult> {
    const { title, filename, key_terms, upload_intent_id } = input

    const buildResult = (
        project: ProjectRow,
        deduped: boolean
    ): CreateProjectResult => ({
        project: {
            id: project.id,
            status: project.status,
            title: project.title,
            created_at: project.created_at,
            updated_at: project.updated_at,
            key_terms: key_terms || [],
        },
        // storagePath is a pure function of userId + projectId + sanitized
        // filename (getMediaPath), so it is reproducible on a dedup hit (the
        // original path is not persisted separately).
        storagePath: getMediaPath(userId, project.id, filename),
        deduped,
        sourceObjectKey: project.source_object_key ?? null,
        status: project.status,
    })

    // Idempotency pre-check: a prior create with the same (user_id, upload_intent_id)
    // returns the canonical project so a recovery retry never duplicates.
    if (upload_intent_id) {
        const { data: existing } = await supabase
            .from('projects')
            .select(PROJECT_RESULT_COLUMNS)
            .eq('user_id', userId)
            .eq('upload_intent_id', upload_intent_id)
            .maybeSingle<ProjectRow>()

        if (existing) {
            return buildResult(existing, true)
        }
    }

    // Insert project row
    const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({
            user_id: userId,
            title: title || filename,
            status: 'created',
            ...(upload_intent_id ? { upload_intent_id } : {}),
        })
        .select(PROJECT_RESULT_COLUMNS)
        .single<ProjectRow>()

    if (projectError || !project) {
        // 23505 race: a concurrent create with the same intent id won the unique
        // index. Re-read the canonical row whenever an intent id is in play
        // (message text is brittle, so don't gate on the index name).
        if (upload_intent_id && projectError?.code === '23505') {
            const { data: raced } = await supabase
                .from('projects')
                .select(PROJECT_RESULT_COLUMNS)
                .eq('user_id', userId)
                .eq('upload_intent_id', upload_intent_id)
                .maybeSingle<ProjectRow>()

            if (raced) {
                return buildResult(raced, true)
            }
            // No canonical row found — the 23505 was an unrelated constraint, so
            // surface the original error rather than masking it as a dedup hit.
        }

        throw new Error(projectError?.message ?? 'Failed to create project')
    }

    // Insert key terms into watchlist if provided (non-fatal). Skipped on dedup
    // hits above so terms aren't duplicated (watchlist has no unique constraint).
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

    return buildResult(project, false)
}
