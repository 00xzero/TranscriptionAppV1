/**
 * The bodies of the media-prepare workflow's steps (handle-media-prepare.ts).
 *
 * Each one re-reads the job and the transcript row instead of trusting an
 * earlier step's cached answer, so a duplicate or late run converges on the
 * same outcome or stops. A write whose answer is lost is settled by reading
 * the row back: the key it holds is the truth, and a prepared file is only
 * deleted once nothing points at it.
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
    acceptPrepared,
    decidePreparation,
    MAX_OUTPUT_BYTES,
    type PreparationDecision,
    type SourceProbe,
} from '@/core/media/prepare-policy'
import { jobLive, jobQueued, type JobIds } from '@/lib/inngest/job-checks'
import { createAbortableAdminClient } from '@/infra/supabase/admin'
import { getSignedMediaUrl, isMissingStorageObjectError, MEDIA_BUCKET } from '@/infra/supabase/storage'
import { prepareAudioFile, probeSourceMedia, ProcessTimeoutError } from '@/lib/audio/ffmpeg'

// The Inngest route allows 300 s per invocation; one step works to 270 s so
// cleanup and the step's own reply still fit.
export const STEP_BUDGET_MS = 270_000
const CONVERT_MAX_MS = 150_000
// Time kept back after ffmpeg for re-probing and the upload.
const AFTER_CONVERT_RESERVE_MS = 60_000
const SIGNED_URL_TTL_SECONDS = 15 * 60

type Ids = JobIds

export function preparedObjectKey(userId: string, transcriptId: string, jobId: string): string {
    return `${userId}/${transcriptId}/${jobId}.m4a`
}

type SourceRow = { user_id: string; source_object_key: string | null }

async function readSourceRow(admin: SupabaseClient, transcriptId: string): Promise<SourceRow | null> {
    const { data, error } = await admin
        .from('transcripts')
        .select('user_id, source_object_key')
        .eq('id', transcriptId)
        .maybeSingle()
    if (error) throw new Error(`Failed to read transcript ${transcriptId}: ${error.message}`)
    return (data as SourceRow | null) ?? null
}

async function removeMediaObject(admin: SupabaseClient, key: string): Promise<void> {
    const { error } = await admin.storage.from(MEDIA_BUCKET).remove([key])
    if (error && !isMissingStorageObjectError(error)) {
        throw new Error(`Failed to remove ${key}: ${error.message}`)
    }
}

// ---------------------------------------------------------------------------

export type LoadSourceResult =
    | { proceed: true; sourceKey: string }
    | { proceed: false; reason: 'job_not_current' | 'transcript_gone' }

export async function loadSource(
    admin: SupabaseClient,
    ids: Ids & { userId: string }
): Promise<LoadSourceResult> {
    if (!(await jobQueued(admin, ids))) return { proceed: false, reason: 'job_not_current' }
    const row = await readSourceRow(admin, ids.transcriptId)
    if (!row) return { proceed: false, reason: 'transcript_gone' }
    if (row.user_id !== ids.userId) {
        throw new Error(`Transcript ${ids.transcriptId} user_id mismatch with event payload`)
    }
    const prefix = `${row.user_id}/${ids.transcriptId}/`
    if (!row.source_object_key || !row.source_object_key.startsWith(prefix)) {
        throw new Error(`Transcript ${ids.transcriptId} has no media in its folder`)
    }
    return { proceed: true, sourceKey: row.source_object_key }
}

export type DecideResult = { decision: PreparationDecision; probe: SourceProbe | null }

export async function decide(admin: SupabaseClient, sourceKey: string): Promise<DecideResult> {
    const signed = await getSignedMediaUrl(admin, sourceKey, SIGNED_URL_TTL_SECONDS)
    if (signed.error || !signed.url) {
        throw new Error(`Failed to sign media URL: ${signed.error ?? 'unknown'}`)
    }
    let probe: SourceProbe | null = null
    try {
        probe = await probeSourceMedia(signed.url)
    } catch (err) {
        console.warn(`[media-prepare] Could not probe ${sourceKey}; keeping it:`, err instanceof Error ? err.message : err)
    }
    return { decision: decidePreparation(probe), probe }
}

export type ConvertResult =
    | { outcome: 'uploaded' }
    | { outcome: 'not_current' }
    | { outcome: 'rejected'; reason: string; mayHaveUploaded: boolean }

export async function convertAndUpload(
    admin: SupabaseClient,
    input: Ids & {
        sourceKey: string
        preparedKey: string
        probe: SourceProbe
        decision: Exclude<PreparationDecision, { action: 'keep' }>
        now?: () => number
    }
): Promise<ConvertResult> {
    const now = input.now ?? Date.now
    const deadline = now() + STEP_BUDGET_MS
    if (!(await jobQueued(admin, input))) return { outcome: 'not_current' }

    const signed = await getSignedMediaUrl(admin, input.sourceKey, SIGNED_URL_TTL_SECONDS)
    if (signed.error || !signed.url) {
        throw new Error(`Failed to sign media URL: ${signed.error ?? 'unknown'}`)
    }

    const dir = await mkdtemp(join(tmpdir(), 'media-prepare-'))
    const outPath = join(dir, 'prepared.m4a')
    try {
        const convertMs = Math.min(deadline - AFTER_CONVERT_RESERVE_MS - now(), CONVERT_MAX_MS)
        try {
            await prepareAudioFile(
                signed.url,
                outPath,
                input.decision.action === 'copy-audio'
                    ? { kind: 'copy-audio' }
                    : { kind: 'transcode', sampleRate: input.decision.sampleRate },
                { timeoutMs: convertMs, maxBytes: MAX_OUTPUT_BYTES }
            )
        } catch (err) {
            const reason = err instanceof ProcessTimeoutError ? 'convert_timeout' : 'convert_failed'
            console.warn(`[media-prepare] ${reason} for ${input.transcriptId}:`, err instanceof Error ? err.message : err)
            return { outcome: 'rejected', reason, mayHaveUploaded: false }
        }

        const { size } = await stat(outPath)
        let outputDuration: number | null = null
        try {
            outputDuration = (await probeSourceMedia(outPath)).audioDurationSeconds
        } catch (err) {
            console.warn(`[media-prepare] Could not probe the prepared file for ${input.transcriptId}:`, err instanceof Error ? err.message : err)
        }
        const verdict = acceptPrepared(input.probe, { sizeBytes: size, audioDurationSeconds: outputDuration })
        if (!verdict.ok) {
            console.warn(`[media-prepare] Prepared file rejected for ${input.transcriptId}: ${verdict.reason}`)
            return { outcome: 'rejected', reason: verdict.reason, mayHaveUploaded: false }
        }

        const body = await readFile(outPath)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - now()))
        try {
            const uploader = createAbortableAdminClient(controller.signal)
            const { error } = await uploader.storage
                .from(MEDIA_BUCKET)
                .upload(input.preparedKey, body, { contentType: 'audio/mp4', upsert: true })
            if (controller.signal.aborted) {
                return { outcome: 'rejected', reason: 'upload_timeout', mayHaveUploaded: true }
            }
            if (error) throw new Error(`Failed to upload prepared media: ${error.message}`)
        } catch (err) {
            if (controller.signal.aborted) {
                return { outcome: 'rejected', reason: 'upload_timeout', mayHaveUploaded: true }
            }
            throw err
        } finally {
            clearTimeout(timer)
        }
        return { outcome: 'uploaded' }
    } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
}

/**
 * `superseded`: the transcript now holds some other file, so this job has
 * nothing to transcribe and should fail. `gone`: the transcript was deleted,
 * taking its job with it; there is nothing left to fail.
 */
export type LinkResult =
    | { outcome: 'linked' }
    | { outcome: 'not_current' }
    | { outcome: 'superseded' }
    | { outcome: 'gone' }

export async function linkPrepared(
    admin: SupabaseClient,
    input: Ids & { sourceKey: string; preparedKey: string }
): Promise<LinkResult> {
    if (!(await jobQueued(admin, input))) {
        const settled = await settleUnlinked(admin, input)
        return settled === 'prepared' ? { outcome: 'linked' } : { outcome: 'not_current' }
    }

    const { data, error } = await admin
        .from('transcripts')
        .update({ source_object_key: input.preparedKey })
        .eq('id', input.transcriptId)
        .eq('source_object_key', input.sourceKey)
        .select('id')
        .maybeSingle()
    if (data && !error) return { outcome: 'linked' }

    // The answer is missing: the row says what happened.
    const row = await readSourceRow(admin, input.transcriptId)
    if (row?.source_object_key === input.preparedKey) return { outcome: 'linked' }
    if (row?.source_object_key === input.sourceKey) {
        throw new Error(`Failed to link prepared media: ${error?.message ?? 'no row updated'}`)
    }
    await removeMediaObject(admin, input.preparedKey)
    return { outcome: row ? 'superseded' : 'gone' }
}

export async function removeOriginal(
    admin: SupabaseClient,
    input: { transcriptId: string; sourceKey: string; preparedKey: string }
): Promise<'removed' | 'skipped'> {
    const row = await readSourceRow(admin, input.transcriptId)
    if (row?.source_object_key !== input.preparedKey) return 'skipped'
    await removeMediaObject(admin, input.sourceKey)
    return 'removed'
}

/**
 * Settle a prepared file the workflow could not finish with: the row's key
 * decides which file the transcript goes on with. A prepared file nothing
 * points at is removed. `superseded` and `gone` mean the same as in
 * LinkResult. If the row can't be read, nothing is touched and this throws,
 * so the step retries.
 */
export async function settleUnlinked(
    admin: SupabaseClient,
    input: { transcriptId: string; sourceKey: string; preparedKey: string }
): Promise<'prepared' | 'original' | 'superseded' | 'gone'> {
    const row = await readSourceRow(admin, input.transcriptId)
    if (row?.source_object_key === input.preparedKey) return 'prepared'
    try {
        await removeMediaObject(admin, input.preparedKey)
    } catch (err) {
        console.error(`[media-prepare] Could not remove unlinked ${input.preparedKey}:`, err instanceof Error ? err.message : err)
    }
    if (!row) return 'gone'
    return row.source_object_key === input.sourceKey ? 'original' : 'superseded'
}

export type WaveformClaim = { dispatch: true; sourceObjectKey: string } | { dispatch: false }

/**
 * Claim the waveform for the transcript's final file. A row already `pending`
 * is treated as this workflow's own earlier claim whose answer was lost: only
 * this workflow claims waveforms, and the waveform job checks the key itself.
 */
export async function claimWaveform(admin: SupabaseClient, ids: Ids): Promise<WaveformClaim> {
    if (!(await jobLive(admin, ids))) return { dispatch: false }

    const read = async () => {
        const { data, error } = await admin
            .from('transcripts')
            .select('source_object_key, waveform_status')
            .eq('id', ids.transcriptId)
            .maybeSingle()
        if (error) throw new Error(`Failed to read waveform status: ${error.message}`)
        return data as { source_object_key: string | null; waveform_status: string } | null
    }

    const row = await read()
    if (!row?.source_object_key) return { dispatch: false }
    if (row.waveform_status === 'pending') return { dispatch: true, sourceObjectKey: row.source_object_key }
    if (row.waveform_status !== 'skipped') return { dispatch: false }

    const { data, error } = await admin
        .from('transcripts')
        .update({ waveform_status: 'pending' })
        .eq('id', ids.transcriptId)
        .eq('waveform_status', 'skipped')
        .select('source_object_key')
        .maybeSingle()
    if (data && !error) return { dispatch: true, sourceObjectKey: row.source_object_key }

    const after = await read()
    if (after?.waveform_status === 'pending' && after.source_object_key) {
        return { dispatch: true, sourceObjectKey: after.source_object_key }
    }
    return { dispatch: false }
}

export async function releaseWaveformClaim(admin: SupabaseClient, transcriptId: string): Promise<void> {
    const { error } = await admin
        .from('transcripts')
        .update({ waveform_status: 'skipped' })
        .eq('id', transcriptId)
        .eq('waveform_status', 'pending')
    if (error) throw new Error(`Failed to release waveform claim: ${error.message}`)
}
