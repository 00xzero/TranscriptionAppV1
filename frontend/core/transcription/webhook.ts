/**
 * Core: Record a transcription engine's result
 *
 * Business logic for an engine's callback, once its route has checked it:
 * claim the receipt, store the result as the engine sent it, link it to the
 * job and hand it to Inngest. Receives pre-validated params and an admin
 * Supabase client — no NextRequest, no headers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendInngestEvent } from '@/infra/inngest/client'
import { getTranscriptionResultPath } from '@/infra/supabase/storage'
import {
    removeTranscriptionResult,
    uploadTranscriptionResult,
} from '@/infra/supabase/transcription-results.server'
import { forceJobError } from '@/core/transcription/transition'
import type { TranscriptionEngine } from '@/contracts/transcription-options'
import { randomUUID } from 'crypto'

// 5 min lease — matches Vercel Pro/Enterprise max function duration
const RECEIPT_LEASE_MS = 300 * 1000

export type WebhookHandleResult =
    | { outcome: 'processed' }
    | { outcome: 'duplicate' }
    | { outcome: 'retrying'; retryAfter: number }
    | { outcome: 'error'; reason: string }
    // Only with a jobId: the attempt is no longer the one the callback is for
    // (failed, deleted, or another request), so nothing was written.
    | { outcome: 'stale' }

/** Names one job attempt exactly: its job, its transcript, the engine's request. */
type ExactJob = { jobId: string; transcriptId: string; requestId: string }

type ExactJobState = 'proceed' | 'retrying' | 'duplicate' | 'stale'

// Request ids go into a PostgREST filter, so only plain ids are accepted.
const PLAIN_REQUEST_ID = /^[A-Za-z0-9_-]+$/

/**
 * What a callback may do to the exact attempt it names. Every write that
 * follows repeats these checks in its own conditions (`exactJobFilter`), since
 * the job can change in between.
 */
async function readExactJob(
    supabase: SupabaseClient,
    { jobId, transcriptId, requestId }: ExactJob
): Promise<ExactJobState | { error: string }> {
    if (!PLAIN_REQUEST_ID.test(requestId)) return 'stale'
    const { data, error } = await supabase
        .from('jobs')
        .select('transcript_id, status, inngest_event_id')
        .eq('id', jobId)
        .maybeSingle()
    if (error) return { error: error.message }
    if (!data || data.transcript_id !== transcriptId) return 'stale'
    if (data.inngest_event_id && data.inngest_event_id !== requestId) return 'stale'
    switch (data.status) {
        // The start has not saved the request id yet: try again shortly.
        case 'queued': return 'retrying'
        case 'processing': return 'proceed'
        case 'completed': return 'duplicate'
        default: return 'stale'
    }
}

/** The PostgREST `or` filter: the job carries this request id, or none yet. */
function sameRequest(requestId: string): string {
    return `inngest_event_id.is.null,inngest_event_id.eq.${requestId}`
}

// PostgREST (v14) applies an update's `or` filter to the returned columns too,
// so a write filtered on inngest_event_id must return it, or it fails with
// "column jobs.inngest_event_id does not exist".
const EXACT_JOB_RETURNING = 'id, inngest_event_id'

/**
 * Fail the job a webhook names: by request id (the job's inngest_event_id),
 * else the transcript's active job, else the transcript itself.
 * Returns what it marked failed, or 'nothing' when it found nothing or its
 * write did not go through, so a caller can ask the engine to retry.
 *
 * With a jobId, only that exact attempt is failed, and only while it is
 * processing this request: 'stale' when it no longer is.
 */
export async function persistWebhookFailure(params: {
    supabase: SupabaseClient
    engine: TranscriptionEngine
    transcriptId?: string | null
    requestId?: string | null
    /** The exact attempt; requires transcriptId and requestId. */
    jobId?: string
    message: string
    /** Defaults to the message. */
    detail?: string
}): Promise<'job' | 'transcript' | 'nothing' | 'stale'> {
    const { supabase } = params

    if (params.jobId) {
        if (!params.transcriptId || !params.requestId) return 'stale'
        return failExactJob(supabase, {
            jobId: params.jobId,
            transcriptId: params.transcriptId,
            requestId: params.requestId,
        }, params.message, params.detail)
    }

    let resolvedTranscriptId = params.transcriptId || null
    let resolvedJobId: string | null = null

    if (!resolvedTranscriptId && params.requestId) {
        const { data: jobByRequest } = await supabase
            .from('jobs')
            .select('id, transcript_id')
            .eq('inngest_event_id', params.requestId)
            .maybeSingle()
        if (jobByRequest) {
            resolvedTranscriptId = jobByRequest.transcript_id
            resolvedJobId = jobByRequest.id
        }
    }

    if (resolvedTranscriptId && !resolvedJobId) {
        const { data: fallbackJob } = await supabase
            .from('jobs')
            .select('id')
            .eq('transcript_id', resolvedTranscriptId)
            .in('status', ['queued', 'processing'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        if (fallbackJob) {
            resolvedJobId = fallbackJob.id
        }
    }

    if (resolvedJobId) {
        const saved = await forceJobError({
            supabase,
            jobId: resolvedJobId,
            extraJobFields: {
                finished_at: new Date().toISOString(),
                error_message: params.message,
                error_type: 'transcription_error',
                error_detail: (params.detail ?? params.message).slice(0, 500),
            },
            context: 'persistWebhookFailure',
        })
        return saved ? 'job' : 'nothing'
    }

    if (resolvedTranscriptId) {
        const { error: insertError } = await supabase
            .from('failed_events')
            .insert({
                event_name: `${params.engine}/webhook_failure`,
                event_data: { transcriptId: resolvedTranscriptId, requestId: params.requestId },
                error_message: params.message,
                transcript_id: resolvedTranscriptId,
            })
        if (insertError) {
            console.error('[webhook] Failed to insert failed_event:', insertError)
        }

        const { error: transcriptError } = await supabase
            .from('transcripts')
            .update({ status: 'error' })
            .eq('id', resolvedTranscriptId)
        if (transcriptError) {
            console.error('[webhook] Failed to update transcript error status:', transcriptError)
            return 'nothing'
        }
        return 'transcript'
    }

    return 'nothing'
}

async function failExactJob(
    supabase: SupabaseClient,
    exact: ExactJob,
    message: string,
    detail?: string
): Promise<'job' | 'nothing' | 'stale'> {
    const state = await readExactJob(supabase, exact)
    if (typeof state === 'object' || state === 'retrying') return 'nothing'
    if (state !== 'proceed') return 'stale'

    const now = new Date().toISOString()
    const { data, error } = await supabase
        .from('jobs')
        .update({
            status: 'error',
            finished_at: now,
            updated_at: now,
            error_message: message,
            error_type: 'transcription_error',
            error_detail: (detail ?? message).slice(0, 500),
        })
        .eq('id', exact.jobId)
        .eq('transcript_id', exact.transcriptId)
        .eq('status', 'processing')
        .or(sameRequest(exact.requestId))
        .select(EXACT_JOB_RETURNING)
    if (error) {
        console.error('[webhook] Failed to fail the exact job:', error)
        return 'nothing'
    }
    return data && data.length > 0 ? 'job' : 'stale'
}

export async function recordEngineResult(opts: {
    supabase: SupabaseClient
    engine: TranscriptionEngine
    requestId: string
    transcriptId: string
    /**
     * The exact attempt the result belongs to. Without it the job is found by
     * request id, else the transcript's latest active job (Deepgram).
     */
    jobId?: string
} & (
    /** The validated result, exactly as the engine sent it. */
    | { rawBody: string; storedObjectKey?: undefined }
    /** A resumed handoff: the result is stored and linked at this key already, so it is not uploaded again. */
    | { rawBody?: undefined; storedObjectKey: string }
)): Promise<WebhookHandleResult & { attemptId?: string }> {
    const { supabase, engine, requestId, transcriptId } = opts
    const exact: ExactJob | null = opts.jobId ? { jobId: opts.jobId, transcriptId, requestId } : null

    if (exact) {
        const state = await readExactJob(supabase, exact)
        if (typeof state === 'object') {
            console.error('[webhook] Failed to read the exact job:', state.error)
            return { outcome: 'retrying', retryAfter: 30 }
        }
        if (state === 'retrying') return { outcome: 'retrying', retryAfter: 30 }
        if (state === 'duplicate') return { outcome: 'duplicate' }
        if (state === 'stale') return { outcome: 'stale' }
    }

    // Claim idempotency receipt
    const myAttemptId = randomUUID()

    const { error: claimError } = await supabase
        .from('webhook_receipts')
        .insert({
            provider: engine,
            request_id: requestId,
            transcript_id: transcriptId,
            attempt_id: myAttemptId,
            claimed_at: new Date().toISOString(),
        })

    let activeAttemptId = myAttemptId

    if (claimError) {
        if (claimError.code === '23505') {
            const { data: existing, error: selectError } = await supabase
                .from('webhook_receipts')
                .select('status, attempt_id, claimed_at')
                .eq('provider', engine)
                .eq('request_id', requestId)
                .single()

            if (selectError || !existing) {
                console.error('[webhook] Failed to read existing receipt:', selectError)
                return { outcome: 'error', reason: 'Receipt state unavailable' }
            }

            if (existing.status === 'completed') {
                console.log(`[webhook] Duplicate (completed) for ${requestId} — no-op`)
                return { outcome: 'duplicate' }
            }

            const isFresh = Date.now() - new Date(existing.claimed_at).getTime() < RECEIPT_LEASE_MS

            if (existing.status === 'processing' && isFresh) {
                console.log(`[webhook] In-flight duplicate for ${requestId} — retrying`)
                return { outcome: 'retrying', retryAfter: 30 }
            }

            // Attempt conditional takeover
            const newAttemptId = randomUUID()
            const { data: takeoverRows, error: takeoverError } = await supabase
                .from('webhook_receipts')
                .update({
                    status: 'processing',
                    attempt_id: newAttemptId,
                    claimed_at: new Date().toISOString(),
                    last_error: null,
                })
                .eq('provider', engine)
                .eq('request_id', requestId)
                .eq('attempt_id', existing.attempt_id)
                .neq('status', 'completed')
                .select('id')

            if (takeoverError) {
                console.error('[webhook] Takeover update failed:', takeoverError)
                return { outcome: 'error', reason: 'Takeover failed' }
            }

            if (!takeoverRows || takeoverRows.length === 0) {
                const { data: reread } = await supabase
                    .from('webhook_receipts')
                    .select('status')
                    .eq('provider', engine)
                    .eq('request_id', requestId)
                    .single()

                if (reread?.status === 'completed') {
                    console.log(`[webhook] Post-takeover read shows completed for ${requestId} — no-op`)
                    return { outcome: 'duplicate' }
                }

                console.log(`[webhook] Lost takeover race for ${requestId} — retrying`)
                return { outcome: 'retrying', retryAfter: 30 }
            }

            activeAttemptId = newAttemptId
            console.log(`[webhook] Takeover successful for ${requestId}`)
        } else {
            console.error('[webhook] Failed to claim receipt (non-conflict):', claimError)
            return { outcome: 'retrying', retryAfter: 30 }
        }
    }

    // Look up the job the response belongs to
    const { data: exactJob, error: exactJobError } = exact
        ? { data: { id: exact.jobId }, error: null }
        : await supabase
            .from('jobs')
            .select('id')
            .eq('transcript_id', transcriptId)
            .eq('inngest_event_id', requestId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

    if (exactJobError) {
        console.error('[webhook] Failed to lookup job by requestId:', exactJobError)
        await markReceiptFailed(supabase, engine, requestId, activeAttemptId, exactJobError.message)
        throw new Error(`Failed to lookup job by requestId: ${exactJobError.message}`)
    }

    let jobIdToUpdate = exactJob?.id

    if (!jobIdToUpdate) {
        const { data: fallbackJob, error: fallbackJobError } = await supabase
            .from('jobs')
            .select('id')
            .eq('transcript_id', transcriptId)
            .in('status', ['queued', 'processing'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (fallbackJobError) {
            console.error('[webhook] Failed to lookup fallback job:', fallbackJobError)
            await markReceiptFailed(supabase, engine, requestId, activeAttemptId, fallbackJobError.message)
            throw new Error(`Failed to lookup fallback job: ${fallbackJobError.message}`)
        }

        jobIdToUpdate = fallbackJob?.id
    }

    // The owner names the folder the response is stored in.
    const { data: transcript, error: transcriptError } = await supabase
        .from('transcripts')
        .select('user_id')
        .eq('id', transcriptId)
        .maybeSingle()

    if (transcriptError) {
        console.error('[webhook] Failed to lookup transcript owner:', transcriptError)
        await markReceiptFailed(supabase, engine, requestId, activeAttemptId, transcriptError.message)
        throw new Error(`Failed to lookup transcript owner: ${transcriptError.message}`)
    }

    if (!jobIdToUpdate || !transcript) {
        console.error('[webhook] No job found to store the response', { transcriptId, requestId })
        await persistWebhookFailure({
            supabase,
            transcriptId,
            requestId,
            engine,
            message: 'Transcription result received but its job was not found.',
        })
        await markReceiptFailed(supabase, engine, requestId, activeAttemptId, 'Job not found')
        throw new Error(`Job not found for ${engine} result`)
    }

    // Store the response, then link it. A redelivery overwrites the same file.
    const resultKey = getTranscriptionResultPath(transcript.user_id, transcriptId, jobIdToUpdate)
    try {
        // A resumed handoff whose file is the job's own stores nothing again.
        if (opts.storedObjectKey !== resultKey) {
            if (opts.rawBody === undefined) {
                throw new Error(`Stored ${engine} result ${opts.storedObjectKey} is not the job's own ${resultKey}`)
            }
            await uploadTranscriptionResult(supabase, resultKey, opts.rawBody)
        }
    } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : String(uploadError)
        console.error(`[webhook] Failed to store ${engine} result:`, message)
        await markReceiptFailed(supabase, engine, requestId, activeAttemptId, message)
        throw uploadError
    }

    let linkQuery = supabase
        .from('jobs')
        .update({
            result_object_key: resultKey,
            inngest_event_id: requestId,
        })
        .eq('id', jobIdToUpdate)
    if (exact) {
        // The exact attempt's checks, again, in the write itself.
        linkQuery = linkQuery
            .eq('transcript_id', transcriptId)
            .eq('status', 'processing')
            .or(sameRequest(requestId))
    }
    const { data: linkedJob, error: updateError } = await linkQuery
        .select(exact ? EXACT_JOB_RETURNING : 'id')
        .maybeSingle()

    if (updateError) {
        // The link may have landed; keep the file and let the retry overwrite it.
        console.error(`[webhook] Failed to link ${engine} result:`, updateError)
        await markReceiptFailed(supabase, engine, requestId, activeAttemptId, updateError.message)
        throw new Error(`Failed to link ${engine} result: ${updateError.message}`)
    }

    if (!linkedJob && exact) {
        // The attempt changed while the file was uploading. The file is kept:
        // this path is the job's own, and another delivery that completed the
        // job may have linked the very same file. Deleting the transcript
        // sweeps it if nothing else does.
        const state = await readExactJob(supabase, exact)
        if (state === 'duplicate') {
            await finalizeReceipt(supabase, engine, requestId, activeAttemptId)
            return { outcome: 'duplicate' }
        }
        if (state === 'stale') {
            await markReceiptFailed(supabase, engine, requestId, activeAttemptId, 'Job changed during upload')
            return { outcome: 'stale' }
        }
        // The job could not be read, or reads as still ours: nothing says to
        // give up. The receipt is released first, so the retry takes it over
        // at once instead of waiting out this attempt's lease.
        const reason = typeof state === 'object' ? `Job unreadable after a refused link: ${state.error}` : 'Link refused; retrying'
        await markReceiptFailed(supabase, engine, requestId, activeAttemptId, reason)
        return { outcome: 'retrying', retryAfter: 30 }
    }

    if (!linkedJob) {
        // The job went with its transcript while the file was uploading.
        await removeTranscriptionResult(supabase, resultKey, 'webhook')
        await markReceiptFailed(supabase, engine, requestId, activeAttemptId, 'Job deleted during upload')
        throw new Error(`Job was deleted while storing the ${engine} result`)
    }

    // Forward to Inngest for durable processing
    try {
        await sendInngestEvent({
            name: 'transcription/webhook',
            data: { requestId, transcriptId },
        })
    } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : String(sendError)
        console.error('[webhook] inngest.send failed after receipt claim:', message)
        await markReceiptFailed(supabase, engine, requestId, activeAttemptId, message)
        throw sendError
    }

    await finalizeReceipt(supabase, engine, requestId, activeAttemptId)

    return { outcome: 'processed', attemptId: activeAttemptId }
}

/** Mark this attempt's receipt completed; `updated` when the attempt still held it. */
async function completeReceipt(
    supabase: SupabaseClient,
    engine: TranscriptionEngine,
    requestId: string,
    attemptId: string
): Promise<{ updated: boolean; error: { message: string } | null }> {
    const { data, error } = await supabase
        .from('webhook_receipts')
        .update({ status: 'completed', processed_at: new Date().toISOString() })
        .eq('provider', engine)
        .eq('request_id', requestId)
        .eq('attempt_id', attemptId)
        .select('status')
    return { updated: !!data && data.length > 0, error }
}

async function finalizeReceipt(
    supabase: SupabaseClient,
    engine: TranscriptionEngine,
    requestId: string,
    attemptId: string
): Promise<void> {
    const { error: finalizeError } = await completeReceipt(supabase, engine, requestId, attemptId)

    if (finalizeError) {
        // Real work is done — leave as processing; lease expiry handles stale recovery
        console.error('[webhook] Finalize failed; receipt left as processing (will expire):', finalizeError)
    }
}

/**
 * Make a handoff durable: the receipt of the attempt that handed the result
 * off ends `completed`. recordEngineResult tolerates a failed finalize (the
 * work is done), so a caller that acts on "handed off" next (deleting the
 * engine's copy) confirms it first. True once the receipt is completed, by
 * this attempt or another; throws when the receipt cannot be read or written,
 * so the caller retries.
 */
export async function confirmReceiptCompleted(
    supabase: SupabaseClient,
    engine: TranscriptionEngine,
    requestId: string,
    attemptId: string
): Promise<boolean> {
    const { updated, error: finalizeError } = await completeReceipt(supabase, engine, requestId, attemptId)
    if (finalizeError) throw new Error(`Failed to complete receipt ${requestId}: ${finalizeError.message}`)
    if (updated) return true

    // Another attempt took the receipt over: it counts only if it finished.
    const { data: receipt, error: readError } = await supabase
        .from('webhook_receipts')
        .select('status')
        .eq('provider', engine)
        .eq('request_id', requestId)
        .maybeSingle()
    if (readError) throw new Error(`Failed to read receipt ${requestId}: ${readError.message}`)
    return receipt?.status === 'completed'
}

async function markReceiptFailed(
    supabase: SupabaseClient,
    engine: TranscriptionEngine,
    requestId: string,
    attemptId: string,
    message: string
): Promise<void> {
    try {
        await supabase
            .from('webhook_receipts')
            .update({
                status: 'failed',
                last_error: message.slice(0, 500),
            })
            .eq('provider', engine)
            .eq('request_id', requestId)
            .eq('attempt_id', attemptId)
    } catch {
        // Don't let receipt cleanup mask the original error
    }
}
