/**
 * The bodies of the media-prepare workflow's steps (handle-media-prepare.ts).
 *
 * Each one re-reads the job and the transcript row instead of trusting an
 * earlier step's cached answer, so a duplicate or late run converges on the
 * same outcome or stops. A write whose answer is lost is settled by reading
 * the row back: the key it holds is the truth, and a prepared file is only
 * deleted once nothing points at it.
 */

import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
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
import { jobLive, jobQueued, queuedJobAgeMs, TRANSCRIPTION_TIMEOUT_MS, type JobIds } from '@/lib/inngest/job-checks'
import { createAbortableAdminClient } from '@/infra/supabase/admin'
import { getMediaPath, getSignedMediaUrl, isMissingStorageObjectError, MEDIA_BUCKET } from '@/infra/supabase/storage'
import { ownedSourceKey, readSourceRow } from '@/lib/media/source-row'
import { prepareAudioFile, probeSourceMedia, ProcessTimeoutError, scanAudioDuration } from '@/lib/audio/ffmpeg'

// The Inngest route allows 300 s per invocation; one step works to 270 s so
// cleanup and the step's own reply still fit.
export const STEP_BUDGET_MS = 270_000
const CONVERT_MAX_MS = 150_000
// Time kept back after ffmpeg for re-probing and the upload.
const AFTER_CONVERT_RESERVE_MS = 60_000
const SIGNED_URL_TTL_SECONDS = 15 * 60
// Preparation runs in a small pool, so a burst of uploads waits in line. A job
// that has already waited this long goes on with its upload as it is, so the
// line delays a transcript by minutes and never runs it into the timeout
// reaper (TRANSCRIPTION_TIMEOUT_MS from creation): at most a quarter of it,
// leaving the rest for one conversion, the upload and Deepgram's own line.
export const PREPARE_START_LIMIT_MS = Math.min(10 * 60_000, Math.floor(TRANSCRIPTION_TIMEOUT_MS / 4))

export function preparedObjectKey(userId: string, transcriptId: string, jobId: string): string {
    return getMediaPath(userId, transcriptId, `${jobId}.m4a`)
}

async function removeMediaObject(admin: SupabaseClient, key: string): Promise<void> {
    const { error } = await admin.storage.from(MEDIA_BUCKET).remove([key])
    if (error && !isMissingStorageObjectError(error)) {
        throw new Error(`Failed to remove ${key}: ${error.message}`)
    }
}

// ---------------------------------------------------------------------------

/**
 * Why the upload is kept without looking at it: `waveform_busy`, a waveform
 * job may be reading the file, so it must not be replaced; `waited_too_long`,
 * the job spent PREPARE_START_LIMIT_MS in line already.
 */
export type SkipReason = 'waveform_busy' | 'waited_too_long'

/**
 * `invalid_source`: the row belongs to another user than the event names, or
 * holds no media inside its own folder. Nothing may be sent to Deepgram, so
 * the caller fails the job.
 */
export type LoadSourceResult =
    | { proceed: true; sourceKey: string; skip: SkipReason | null }
    | { proceed: false; reason: 'job_not_current' | 'transcript_gone' | 'invalid_source' }

export async function loadSource(
    admin: SupabaseClient,
    ids: JobIds & { userId: string }
): Promise<LoadSourceResult> {
    const [waitedMs, row] = await Promise.all([queuedJobAgeMs(admin, ids), readSourceRow(admin, ids.transcriptId)])
    if (waitedMs === null) return { proceed: false, reason: 'job_not_current' }
    if (!row) return { proceed: false, reason: 'transcript_gone' }
    const sourceKey = ownedSourceKey(row, ids)
    if (!sourceKey) return { proceed: false, reason: 'invalid_source' }
    const waveformBusy = row.waveform_status === 'pending' || row.waveform_status === 'processing'
    return {
        proceed: true,
        sourceKey,
        skip: waveformBusy ? 'waveform_busy' : waitedMs > PREPARE_START_LIMIT_MS ? 'waited_too_long' : null,
    }
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

/**
 * `rejected`: the transcript goes on with its original. An earlier attempt of
 * this step may still have uploaded the prepared file, so the caller always
 * settles a rejection against the row (settleUnlinked).
 */
export type ConvertResult =
    | { outcome: 'uploaded' }
    | { outcome: 'not_current' }
    | { outcome: 'rejected'; reason: string }

export async function convertAndUpload(
    admin: SupabaseClient,
    input: JobIds & {
        sourceKey: string
        preparedKey: string
        probe: SourceProbe
        decision: Exclude<PreparationDecision, { action: 'keep' }>
        now?: () => number
    }
): Promise<ConvertResult> {
    const now = input.now ?? Date.now
    const deadline = now() + STEP_BUDGET_MS
    const waitedMs = await queuedJobAgeMs(admin, input)
    if (waitedMs === null) return { outcome: 'not_current' }
    if (waitedMs > PREPARE_START_LIMIT_MS) return { outcome: 'rejected', reason: 'waited_too_long' }

    const signed = await getSignedMediaUrl(admin, input.sourceKey, SIGNED_URL_TTL_SECONDS)
    if (signed.error || !signed.url) {
        throw new Error(`Failed to sign media URL: ${signed.error ?? 'unknown'}`)
    }

    const dir = await mkdtemp(join(tmpdir(), 'media-prepare-'))
    const outPath = join(dir, 'prepared.m4a')
    const scanController = new AbortController()
    try {
        const convertMs = Math.min(deadline - AFTER_CONVERT_RESERVE_MS - now(), CONVERT_MAX_MS)
        // Without a header duration (MediaRecorder WebM), the source's sound is
        // measured from its packets while it converts: a count of its own, so
        // a conversion that stopped early is still caught.
        const sourceSeconds: Promise<number | null> = input.probe.audioDurationSeconds !== null
            ? Promise.resolve(input.probe.audioDurationSeconds)
            : scanAudioDuration(signed.url, { timeoutMs: convertMs, signal: scanController.signal }).catch((err) => {
                if (!scanController.signal.aborted) {
                    console.warn(`[media-prepare] Could not measure ${input.transcriptId}'s sound:`, err instanceof Error ? err.message : err)
                }
                return null
            })
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
            return { outcome: 'rejected', reason }
        }

        const { size } = await stat(outPath)
        let outputDuration: number | null = null
        try {
            outputDuration = (await probeSourceMedia(outPath)).audioDurationSeconds
        } catch (err) {
            console.warn(`[media-prepare] Could not probe the prepared file for ${input.transcriptId}:`, err instanceof Error ? err.message : err)
        }
        const verdict = acceptPrepared(
            { ...input.probe, audioDurationSeconds: await sourceSeconds },
            { sizeBytes: size, audioDurationSeconds: outputDuration }
        )
        if (!verdict.ok) {
            console.warn(`[media-prepare] Prepared file rejected for ${input.transcriptId}: ${verdict.reason}`)
            return { outcome: 'rejected', reason: verdict.reason }
        }

        const body = createReadStream(outPath)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - now()))
        try {
            const uploader = createAbortableAdminClient(controller.signal)
            const { error } = await uploader.storage
                .from(MEDIA_BUCKET)
                .upload(input.preparedKey, body, { contentType: 'audio/mp4', upsert: true })
            if (controller.signal.aborted) {
                return { outcome: 'rejected', reason: 'upload_timeout' }
            }
            if (error) throw new Error(`Failed to upload prepared media: ${error.message}`)
        } catch (err) {
            if (controller.signal.aborted) {
                return { outcome: 'rejected', reason: 'upload_timeout' }
            }
            throw err
        } finally {
            clearTimeout(timer)
            body.destroy()
        }
        return { outcome: 'uploaded' }
    } finally {
        scanController.abort()
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
    input: JobIds & { sourceKey: string; preparedKey: string }
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
 * is dispatched again: it is this workflow's own earlier claim whose answer
 * was lost, or the backfill's, and both send under the same event id
 * (`waveform:{transcriptId}:{key}`), so Inngest runs the waveform once. The
 * waveform job checks the key itself.
 */
export async function claimWaveform(admin: SupabaseClient, ids: JobIds): Promise<WaveformClaim> {
    const [live, row] = await Promise.all([jobLive(admin, ids), readSourceRow(admin, ids.transcriptId)])
    if (!live || !row?.source_object_key) return { dispatch: false }
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

    const after = await readSourceRow(admin, ids.transcriptId)
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
