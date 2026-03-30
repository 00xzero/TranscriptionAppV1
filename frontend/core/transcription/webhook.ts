/**
 * Core: Handle Deepgram Webhook
 *
 * Business logic for processing a Deepgram webhook callback.
 * Receives pre-validated params and an admin Supabase client — no NextRequest, no headers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DeepgramWebhookPayload } from '@/contracts/webhook'
import { sendInngestEvent } from '@/infra/inngest/client'
import { forceJobError } from '@/core/transcription/transition'
import { randomUUID } from 'crypto'

// 5 min lease — matches Vercel Pro/Enterprise max function duration
const RECEIPT_LEASE_MS = 300 * 1000

export type WebhookHandleResult =
    | { outcome: 'processed' }
    | { outcome: 'duplicate' }
    | { outcome: 'retrying'; retryAfter: number }
    | { outcome: 'error'; reason: string }

export async function persistWebhookFailure(params: {
    supabase: SupabaseClient
    projectId?: string | null
    requestId?: string | null
    message: string
}): Promise<void> {
    const { supabase } = params
    let resolvedProjectId = params.projectId || null
    let resolvedJobId: string | null = null

    if (!resolvedProjectId && params.requestId) {
        const { data: jobByRequest } = await supabase
            .from('jobs')
            .select('id, project_id')
            .eq('inngest_event_id', params.requestId)
            .maybeSingle()
        if (jobByRequest) {
            resolvedProjectId = jobByRequest.project_id
            resolvedJobId = jobByRequest.id
        }
    }

    if (resolvedProjectId && !resolvedJobId) {
        const { data: fallbackJob } = await supabase
            .from('jobs')
            .select('id')
            .eq('project_id', resolvedProjectId)
            .in('status', ['queued', 'processing'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        if (fallbackJob) {
            resolvedJobId = fallbackJob.id
        }
    }

    const payload = {
        error: params.message,
        error_type: 'transcription_error',
        raw_error: params.message.slice(0, 500),
    }

    if (resolvedJobId) {
        await forceJobError({
            supabase,
            jobId: resolvedJobId,
            extraJobFields: {
                finished_at: new Date().toISOString(),
                payload,
            },
            context: 'persistWebhookFailure',
        })
    } else if (resolvedProjectId) {
        const { error: insertError } = await supabase
            .from('failed_events')
            .insert({
                event_name: 'deepgram/webhook_failure',
                event_data: { projectId: resolvedProjectId, requestId: params.requestId },
                error_message: params.message,
                project_id: resolvedProjectId,
            })
        if (insertError) {
            console.error('[webhook] Failed to insert failed_event:', insertError)
        }

        const { error: projectError } = await supabase
            .from('projects')
            .update({ status: 'error' })
            .eq('id', resolvedProjectId)
        if (projectError) {
            console.error('[webhook] Failed to update project error status:', projectError)
        }
    }
}

export async function handleDeepgramWebhook(opts: {
    supabase: SupabaseClient
    requestId: string
    projectId: string
    payload: DeepgramWebhookPayload
}): Promise<WebhookHandleResult & { attemptId?: string }> {
    const { supabase, requestId, projectId, payload } = opts

    // Claim idempotency receipt
    const myAttemptId = randomUUID()

    const { error: claimError } = await supabase
        .from('webhook_receipts')
        .insert({
            provider: 'deepgram',
            request_id: requestId,
            project_id: projectId,
            attempt_id: myAttemptId,
            claimed_at: new Date().toISOString(),
        })

    let activeAttemptId = myAttemptId

    if (claimError) {
        if (claimError.code === '23505') {
            const { data: existing, error: selectError } = await supabase
                .from('webhook_receipts')
                .select('status, attempt_id, claimed_at')
                .eq('provider', 'deepgram')
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
                .eq('provider', 'deepgram')
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
                    .eq('provider', 'deepgram')
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

    // Look up job to attach payload
    const { data: exactJob, error: exactJobError } = await supabase
        .from('jobs')
        .select('id')
        .eq('project_id', projectId)
        .eq('inngest_event_id', requestId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (exactJobError) {
        console.error('[webhook] Failed to lookup job by requestId:', exactJobError)
        await markReceiptFailed(supabase, requestId, activeAttemptId, exactJobError.message)
        throw new Error(`Failed to lookup job by requestId: ${exactJobError.message}`)
    }

    let jobIdToUpdate = exactJob?.id

    if (!jobIdToUpdate) {
        const { data: fallbackJob, error: fallbackJobError } = await supabase
            .from('jobs')
            .select('id')
            .eq('project_id', projectId)
            .in('status', ['queued', 'processing'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (fallbackJobError) {
            console.error('[webhook] Failed to lookup fallback job:', fallbackJobError)
            await markReceiptFailed(supabase, requestId, activeAttemptId, fallbackJobError.message)
            throw new Error(`Failed to lookup fallback job: ${fallbackJobError.message}`)
        }

        jobIdToUpdate = fallbackJob?.id
    }

    if (!jobIdToUpdate) {
        console.error('[webhook] No job found to persist payload', { projectId, requestId })
        await persistWebhookFailure({
            supabase,
            projectId,
            requestId,
            message: 'Deepgram webhook received but job was not found.',
        })
        await markReceiptFailed(supabase, requestId, activeAttemptId, 'Job not found')
        throw new Error('Job not found for Deepgram webhook')
    }

    // Persist payload to job row
    const { error: updateError } = await supabase
        .from('jobs')
        .update({
            payload: { deepgram: payload },
            inngest_event_id: requestId,
        })
        .eq('id', jobIdToUpdate)

    if (updateError) {
        console.error('[webhook] Failed to persist webhook payload:', updateError)
        await markReceiptFailed(supabase, requestId, activeAttemptId, updateError.message)
        throw new Error(`Failed to persist webhook payload: ${updateError.message}`)
    }

    // Forward to Inngest for durable processing
    try {
        await sendInngestEvent({
            name: 'transcription/webhook',
            data: { requestId, projectId },
        })
    } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : String(sendError)
        console.error('[webhook] inngest.send failed after receipt claim:', message)
        await markReceiptFailed(supabase, requestId, activeAttemptId, message)
        throw sendError
    }

    // Finalize receipt
    const { error: finalizeError } = await supabase
        .from('webhook_receipts')
        .update({ status: 'completed', processed_at: new Date().toISOString() })
        .eq('provider', 'deepgram')
        .eq('request_id', requestId)
        .eq('attempt_id', activeAttemptId)

    if (finalizeError) {
        // Real work is done — leave as processing; lease expiry handles stale recovery
        console.error('[webhook] Finalize failed; receipt left as processing (will expire):', finalizeError)
    }

    return { outcome: 'processed', attemptId: activeAttemptId }
}

async function markReceiptFailed(
    supabase: SupabaseClient,
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
            .eq('provider', 'deepgram')
            .eq('request_id', requestId)
            .eq('attempt_id', attemptId)
    } catch {
        // Don't let receipt cleanup mask the original error
    }
}
