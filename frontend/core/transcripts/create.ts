/**
 * Core: Create Transcript
 *
 * Business logic for creating a new transcript.
 * Receives an authenticated Supabase client and validated input — no NextRequest.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CreateTranscriptBody, CreateTranscriptWarning } from '@/contracts/api'
import { getMediaPath } from '@/infra/supabase/storage'
import { isProjectGoneError } from '@/lib/supabase/project-errors'

export interface TranscriptCreated {
    id: string
    status: string
    title: string
    created_at: string
    updated_at: string
}

export interface CreateTranscriptResult {
    transcript: TranscriptCreated & { key_terms: string[] }
    storagePath: string
    /** True when an existing transcript was returned via upload-intent dedup. */
    deduped: boolean
    /** Already-linked media key when the canonical transcript has one (else null). */
    sourceObjectKey: string | null
    /** Canonical transcript status, surfaced for idempotent client resume. */
    status: string
    warning?: CreateTranscriptWarning
}

/** Transcript row shape selected for building the canonical result. */
interface TranscriptRow {
    id: string
    status: string
    title: string
    project_id: string | null
    source_object_key: string | null
    created_at: string
    updated_at: string
}

const TRANSCRIPT_RESULT_COLUMNS =
    'id, status, title, project_id, source_object_key, created_at, updated_at'

export async function createTranscript(
    supabase: SupabaseClient,
    userId: string,
    input: CreateTranscriptBody
): Promise<CreateTranscriptResult> {
    const { title, filename, key_terms, upload_intent_id, project_id } = input

    const buildResult = (
        transcript: TranscriptRow,
        deduped: boolean
    ): CreateTranscriptResult => {
        const warning: CreateTranscriptWarning | undefined =
            project_id && transcript.project_id === null ? 'project_missing' : undefined

        return {
            transcript: {
                id: transcript.id,
                status: transcript.status,
                title: transcript.title,
                created_at: transcript.created_at,
                updated_at: transcript.updated_at,
                key_terms: key_terms || [],
            },
            // storagePath is a pure function of userId + transcriptId + sanitized
            // filename (getMediaPath), so it is reproducible on a dedup hit (the
            // original path is not persisted separately).
            storagePath: getMediaPath(userId, transcript.id, filename),
            deduped,
            sourceObjectKey: transcript.source_object_key ?? null,
            status: transcript.status,
            warning,
        }
    }

    const findExistingTranscript = async (): Promise<TranscriptRow | null> => {
        if (!upload_intent_id) return null

        const { data } = await supabase
            .from('transcripts')
            .select(TRANSCRIPT_RESULT_COLUMNS)
            .eq('user_id', userId)
            .eq('upload_intent_id', upload_intent_id)
            .maybeSingle<TranscriptRow>()

        return data
    }

    const insertTranscript = async (projectId: string | null | undefined) => {
        const { data, error } = await supabase
            .from('transcripts')
            .insert({
                user_id: userId,
                title: title || filename,
                status: 'created',
                ...(upload_intent_id ? { upload_intent_id } : {}),
                ...(projectId !== undefined ? { project_id: projectId } : {}),
            })
            .select(TRANSCRIPT_RESULT_COLUMNS)
            .single<TranscriptRow>()

        if (error?.code === '23505') {
            const raced = await findExistingTranscript()
            if (raced) return { transcript: raced, error: null, deduped: true }
        }

        return { transcript: data, error, deduped: false }
    }

    // Idempotency pre-check: a prior create with the same (user_id, upload_intent_id)
    // returns the canonical transcript so a recovery retry never duplicates.
    if (upload_intent_id) {
        const existing = await findExistingTranscript()
        if (existing) {
            return buildResult(existing, true)
        }
    }

    let insertResult = await insertTranscript(project_id)

    if (project_id && insertResult.error && isProjectGoneError(insertResult.error)) {
        insertResult = await insertTranscript(null)
    }

    const { transcript, error: transcriptError, deduped } = insertResult
    if (transcriptError || !transcript) {
        throw new Error(transcriptError?.message ?? 'Failed to create transcript')
    }

    // Insert key terms into watchlist if provided (non-fatal). Skipped on dedup
    // hits above so terms aren't duplicated (watchlist has no unique constraint).
    if (!deduped && key_terms && key_terms.length > 0) {
        const watchlistItems = key_terms.map(term => ({
            transcript_id: transcript.id,
            term: term,
            canonical: term.toLowerCase(),
        }))

        const { error: watchlistError } = await supabase
            .from('watchlist')
            .insert(watchlistItems)

        if (watchlistError) {
            console.error('[createTranscript] Watchlist insert error:', watchlistError)
        }
    }

    return buildResult(transcript, deduped)
}
