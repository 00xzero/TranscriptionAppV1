/**
 * Move the Deepgram responses still held in jobs.payload into the
 * transcription-results bucket. One-time, run between
 * 20261016000000_job_results_storage.sql and 20261016010000_drop_job_payload.sql
 * (the second refuses until this has finished).
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/move-job-payloads-to-storage.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/move-job-payloads-to-storage.ts
 *   npx tsx --env-file=.env.local scripts/move-job-payloads-to-storage.ts --limit=20
 *
 * Behavior:
 *   - Selects jobs where payload->deepgram is set and result_object_key is null,
 *     paging by id so rows that stop matching cannot make it skip others
 *   - Stores payload->deepgram only (the response, not the error fields beside
 *     it), gzipped, at {user_id}/{transcript_id}/{job_id}.json.gz
 *   - Downloads it again and compares before linking it to the job
 *   - Removes the file again if the job was deleted while it was uploading
 *   - Resumable: re-running picks up whatever is left
 *
 * Stop Inngest and wait for active jobs to finish before running it on a
 * database the app is using.
 */

import { createClient } from '@supabase/supabase-js'
import { getTranscriptionResultPath } from '@/infra/supabase/storage'
import {
    downloadTranscriptionResult,
    removeTranscriptionResult,
    uploadTranscriptionResult,
} from '@/infra/supabase/transcription-results.server'

const PAGE_SIZE = 50

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))
const limit = limitArg ? parseInt(limitArg.slice('--limit='.length), 10) : Infinity

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
})

type PendingJob = {
    id: string
    transcript_id: string
    transcripts: { user_id: string } | null
}

async function selectPage(afterId: string | null): Promise<PendingJob[]> {
    let query = supabase
        .from('jobs')
        .select('id, transcript_id, transcripts!inner(user_id)')
        .not('payload->deepgram', 'is', null)
        .is('result_object_key', null)
    if (afterId) query = query.gt('id', afterId)
    const { data, error } = await query.order('id', { ascending: true }).limit(PAGE_SIZE)
    if (error) throw error
    return (data ?? []) as unknown as PendingJob[]
}

type Outcome = { moved: true; bytes: number } | { moved: false; reason: string }

async function moveOne(job: PendingJob): Promise<Outcome> {
    const userId = job.transcripts?.user_id
    if (!userId) return { moved: false, reason: 'transcript owner not found' }

    // One row at a time: a response can be several MB.
    const { data, error } = await supabase
        .from('jobs')
        .select('deepgram:payload->deepgram')
        .eq('id', job.id)
        .maybeSingle()
    if (error) throw error
    const response = (data as { deepgram: unknown } | null)?.deepgram
    if (response == null) return { moved: false, reason: 'job or response gone' }

    const rawJson = JSON.stringify(response)
    const path = getTranscriptionResultPath(userId, job.transcript_id, job.id)
    if (dryRun) return { moved: true, bytes: Buffer.byteLength(rawJson) }

    const { bytes } = await uploadTranscriptionResult(supabase, path, rawJson)

    const stored = await downloadTranscriptionResult(supabase, path)
    if (JSON.stringify(JSON.parse(stored)) !== rawJson) {
        throw new Error(`Stored response for job ${job.id} does not match the original`)
    }

    const { data: linked, error: linkError } = await supabase
        .from('jobs')
        .update({ result_object_key: path })
        .eq('id', job.id)
        .select('id')
        .maybeSingle()
    if (linkError) throw linkError
    if (!linked) {
        await removeTranscriptionResult(supabase, path, 'move-job-payloads')
        return { moved: false, reason: 'job deleted during upload' }
    }

    return { moved: true, bytes }
}

async function main() {
    console.log(`[move-job-payloads] ${dryRun ? 'DRY RUN' : 'MOVING'} against ${new URL(supabaseUrl!).origin}`)

    let afterId: string | null = null
    let seen = 0
    let moved = 0
    let bytes = 0
    const skipped: string[] = []

    while (seen < limit) {
        const page = await selectPage(afterId)
        if (page.length === 0) break

        for (const job of page) {
            if (seen >= limit) break
            seen += 1
            const outcome = await moveOne(job)
            if (outcome.moved) {
                moved += 1
                bytes += outcome.bytes
                console.log(`  ${dryRun ? 'would move' : 'moved'} ${job.id} (${outcome.bytes} bytes)`)
            } else {
                skipped.push(`${job.id}: ${outcome.reason}`)
                console.warn(`  skipped ${job.id}: ${outcome.reason}`)
            }
        }
        afterId = page[page.length - 1].id
    }

    console.log(`[move-job-payloads] ${dryRun ? 'Would move' : 'Moved'} ${moved}/${seen} job(s), ${bytes} bytes${dryRun ? ' uncompressed' : ' stored'}`)
    if (skipped.length > 0) {
        console.log(`[move-job-payloads] Skipped ${skipped.length}:`)
        for (const line of skipped) console.log(`  - ${line}`)
    }
}

main().catch((error) => {
    console.error('[move-job-payloads] Failed:', error)
    process.exit(1)
})
