/**
 * Backfill waveform peaks for existing projects.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/backfill-waveforms.ts
 *   npx tsx --env-file=.env.local scripts/backfill-waveforms.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-waveforms.ts --limit=20
 *
 * Behavior:
 *   - Selects projects where waveform_status='skipped' AND source_object_key IS NOT NULL
 *   - Flips each row's waveform_status to 'pending' and dispatches waveform/requested
 *   - The durable Inngest function does the actual work and is idempotent
 *   - Throttled to ~5 dispatches/sec to avoid saturating the queue
 *   - Resumable: re-running picks up via the same filter (rows that succeeded
 *     are now 'ready'; any that errored are 'error' and won't be re-tried by
 *     this script — re-dispatch them manually if needed)
 */

import { createClient } from '@supabase/supabase-js'
import { inngest } from '@/infra/inngest/client'

const DEFAULT_LIMIT = 1000
const DISPATCHES_PER_SECOND = 5
const PAGE_SIZE = 100

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))
const limit = limitArg ? parseInt(limitArg.slice('--limit='.length), 10) : DEFAULT_LIMIT

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function selectBatch(offset: number, batchSize: number) {
    const { data, error } = await supabase
        .from('projects')
        .select('id, user_id, source_object_key')
        .eq('waveform_status', 'skipped')
        .not('source_object_key', 'is', null)
        .order('created_at', { ascending: true })
        .range(offset, offset + batchSize - 1)
    if (error) throw error
    return data ?? []
}

async function dispatchOne(row: { id: string; user_id: string; source_object_key: string | null }) {
    if (!row.source_object_key) return { skipped: true as const }
    if (dryRun) {
        return { dispatched: false as const, dryRun: true as const }
    }
    // Conditional update: only flip if still 'skipped' (avoids racing the live dispatch path)
    const { data: updated, error: updateError } = await supabase
        .from('projects')
        .update({ waveform_status: 'pending' })
        .eq('id', row.id)
        .eq('waveform_status', 'skipped')
        .select('id')
        .maybeSingle()

    if (updateError) {
        return { dispatched: false as const, error: updateError.message }
    }
    if (!updated) {
        // Status changed under us; skip — the live path or a previous backfill run owns it
        return { dispatched: false as const, raced: true as const }
    }

    await inngest.send({
        name: 'waveform/requested',
        data: {
            projectId: row.id,
            userId: row.user_id,
            sourceObjectKey: row.source_object_key,
        },
    })
    return { dispatched: true as const }
}

async function main() {
    console.log(`[backfill-waveforms] mode=${dryRun ? 'DRY RUN' : 'LIVE'} limit=${limit} rate=${DISPATCHES_PER_SECOND}/s`)

    let processed = 0
    let dispatched = 0
    let raced = 0
    let errored = 0
    let offset = 0
    const intervalMs = Math.ceil(1000 / DISPATCHES_PER_SECOND)

    while (processed < limit) {
        const remaining = limit - processed
        const batchSize = Math.min(PAGE_SIZE, remaining)
        const rows = await selectBatch(offset, batchSize)
        if (rows.length === 0) break

        for (const row of rows) {
            if (processed >= limit) break
            processed++
            try {
                const result = await dispatchOne(row)
                if ('dispatched' in result && result.dispatched) {
                    dispatched++
                    console.log(`[backfill-waveforms] dispatched ${row.id}`)
                } else if ('raced' in result) {
                    raced++
                } else if ('error' in result) {
                    errored++
                    console.error(`[backfill-waveforms] error for ${row.id}: ${result.error}`)
                } else if ('dryRun' in result) {
                    console.log(`[backfill-waveforms] would dispatch ${row.id} (user=${row.user_id})`)
                }
            } catch (err) {
                errored++
                console.error(`[backfill-waveforms] threw for ${row.id}:`, err)
            }
            // Throttle even on dry-run to keep the report readable
            await sleep(intervalMs)
        }

        // Because the filter selects waveform_status='skipped', dispatched rows
        // drop out of the result set on the next page — keep offset at 0 and
        // we'll always read the head of the remaining queue.
        offset = 0
    }

    console.log(
        `[backfill-waveforms] done. processed=${processed} dispatched=${dispatched} raced=${raced} errored=${errored}`
    )
}

main().catch((err) => {
    console.error('[backfill-waveforms] fatal:', err)
    process.exit(1)
})
