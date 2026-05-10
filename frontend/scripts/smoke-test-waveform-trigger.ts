/**
 * Smoke test for the protect_project_waveform_columns trigger.
 *
 * Run with:
 *   npx tsx --env-file=../infra/.env.docker scripts/smoke-test-waveform-trigger.ts
 *
 * Verifies:
 *   1. Authenticated client cannot update waveform columns (trigger raises 42501)
 *   2. Service-role client CAN update waveform columns
 *
 * Requires the test login from CLAUDE.md to exist in the local Supabase auth.
 */

import { createClient } from '@supabase/supabase-js'

const TEST_EMAIL = 'ui5nvlw97q@mkzaso.com'
const TEST_PASSWORD = '4qdGNrheWHR25Js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
})

async function ensureTestProject(userId: string): Promise<string> {
    // Find or create a project owned by the test user we can poke at.
    const { data: existing } = await adminClient
        .from('projects')
        .select('id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle()
    if (existing) return existing.id

    const { data: created, error } = await adminClient
        .from('projects')
        .insert({ user_id: userId, title: 'smoke-test-waveform-trigger' })
        .select('id')
        .single()
    if (error || !created) throw new Error(`Could not create test project: ${error?.message}`)
    return created.id
}

async function main() {
    let pass = true

    // Sign in as the test user → JWT-bound authenticated client
    const userClient = createClient(supabaseUrl!, anonKey!, {
        auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: signIn, error: signInErr } = await userClient.auth.signInWithPassword({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
    })
    if (signInErr || !signIn.user) {
        console.error('Failed to sign in as test user:', signInErr?.message)
        process.exit(1)
    }
    const userId = signIn.user.id
    console.log(`[smoke] Signed in as ${TEST_EMAIL} (${userId})`)

    const projectId = await ensureTestProject(userId)
    console.log(`[smoke] Using project ${projectId}`)

    // --- Test 1: authenticated client should be REJECTED ---
    const { error: userUpdateErr } = await userClient
        .from('projects')
        .update({ waveform_status: 'ready' })
        .eq('id', projectId)
    if (userUpdateErr) {
        console.log(`[smoke] ✓ authenticated client rejected: ${userUpdateErr.code} ${userUpdateErr.message}`)
    } else {
        // PostgREST may return 200 with empty body if RLS+trigger silently filters; verify the row didn't actually change
        const { data: row } = await adminClient
            .from('projects')
            .select('waveform_status')
            .eq('id', projectId)
            .single()
        if (row?.waveform_status === 'ready') {
            console.error('[smoke] ✗ authenticated client SUCCEEDED in updating waveform_status — trigger is not protecting!')
            pass = false
        } else {
            console.log(`[smoke] ✓ authenticated client update did not take effect (row still ${row?.waveform_status})`)
        }
    }

    // --- Test 2: admin client should SUCCEED ---
    const { error: adminUpdateErr } = await adminClient
        .from('projects')
        .update({ waveform_status: 'pending' })
        .eq('id', projectId)
    if (adminUpdateErr) {
        console.error(`[smoke] ✗ admin client REJECTED: ${adminUpdateErr.message}`)
        pass = false
    } else {
        const { data: row } = await adminClient
            .from('projects')
            .select('waveform_status')
            .eq('id', projectId)
            .single()
        if (row?.waveform_status === 'pending') {
            console.log(`[smoke] ✓ admin client successfully set waveform_status='pending'`)
        } else {
            console.error(`[smoke] ✗ admin update completed but row reads ${row?.waveform_status}`)
            pass = false
        }
    }

    // Reset to skipped so re-running the smoke is clean
    const { data: resetRow, error: resetErr } = await adminClient
        .from('projects')
        .update({ waveform_status: 'skipped' })
        .eq('id', projectId)
        .select('waveform_status')
        .single()
    if (resetErr) {
        throw new Error(`Could not reset waveform_status to skipped: ${resetErr.message}`)
    }
    if (resetRow?.waveform_status !== 'skipped') {
        throw new Error(`Reset completed but row reads ${resetRow?.waveform_status}`)
    }

    if (!pass) {
        console.error('[smoke] FAIL')
        process.exit(1)
    }
    console.log('[smoke] PASS')
}

main().catch((err) => {
    console.error('[smoke] threw:', err)
    process.exit(1)
})
