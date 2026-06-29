/**
 * Core: Create Transcript
 *
 * Business logic for creating a new transcript.
 * Receives an authenticated Supabase client and validated input — no NextRequest.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CreateTranscriptBody } from '@/contracts/api'
import { getMediaPath } from '@/infra/supabase/storage'

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
}

/** Transcript row shape selected for building the canonical result. */
interface TranscriptRow {
    id: string
    status: string
    title: string
    source_object_key: string | null
    created_at: string
    updated_at: string
}

const TRANSCRIPT_RESULT_COLUMNS =
    'id, status, title, source_object_key, created_at, updated_at'

export async function createTranscript(
    supabase: SupabaseClient,
    userId: string,
    input: CreateTranscriptBody
): Promise<CreateTranscriptResult> {
    const { title, filename, key_terms, upload_intent_id } = input

    const buildResult = (
        transcript: TranscriptRow,
        deduped: boolean
    ): CreateTranscriptResult => ({
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
    })

    // Idempotency pre-check: a prior create with the same (user_id, upload_intent_id)
    // returns the canonical transcript so a recovery retry never duplicates.
    if (upload_intent_id) {
        const { data: existing } = await supabase
            .from('transcripts')
            .select(TRANSCRIPT_RESULT_COLUMNS)
            .eq('user_id', userId)
            .eq('upload_intent_id', upload_intent_id)
            .maybeSingle<TranscriptRow>()

        if (existing) {
            return buildResult(existing, true)
        }
    }

    // Insert transcript row
    const { data: transcript, error: transcriptError } = await supabase
        .from('transcripts')
        .insert({
            user_id: userId,
            title: title || filename,
            status: 'created',
            ...(upload_intent_id ? { upload_intent_id } : {}),
        })
        .select(TRANSCRIPT_RESULT_COLUMNS)
        .single<TranscriptRow>()

    if (transcriptError || !transcript) {
        // 23505 race: a concurrent create with the same intent id won the unique
        // index. Re-read the canonical row whenever an intent id is in play
        // (message text is brittle, so don't gate on the index name).
        if (upload_intent_id && transcriptError?.code === '23505') {
            const { data: raced } = await supabase
                .from('transcripts')
                .select(TRANSCRIPT_RESULT_COLUMNS)
                .eq('user_id', userId)
                .eq('upload_intent_id', upload_intent_id)
                .maybeSingle<TranscriptRow>()

            if (raced) {
                return buildResult(raced, true)
            }
            // No canonical row found — the 23505 was an unrelated constraint, so
            // surface the original error rather than masking it as a dedup hit.
        }

        throw new Error(transcriptError?.message ?? 'Failed to create transcript')
    }

    // Insert key terms into watchlist if provided (non-fatal). Skipped on dedup
    // hits above so terms aren't duplicated (watchlist has no unique constraint).
    if (key_terms && key_terms.length > 0) {
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

    return buildResult(transcript, false)
}
