/**
 * Find storage objects that are no longer referenced by transcript rows.
 *
 * Dry runs are safe at any time. Before using --delete, stop the Inngest worker
 * and make sure no uploads are in progress so an object cannot be removed while
 * a writer is still about to link it.
 *
 * Examples:
 *   node scripts/cleanup-orphaned-media.mjs
 *   node scripts/cleanup-orphaned-media.mjs --min-age-hours 48 --verbose
 *   node scripts/cleanup-orphaned-media.mjs --min-age-hours 24 --delete
 */
import { createClient } from '@supabase/supabase-js'
import cleanupCore from './cleanup-orphaned-media-core.js'

const { parseCleanupOptions, runCleanup } = cleanupCore

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

try {
  const options = parseCleanupOptions(process.argv.slice(2))
  const url = new URL(supabaseUrl)
  await runCleanup(supabase, options, console, url.origin)
} catch (error) {
  console.error('Cleanup failed:', error)
  process.exit(1)
}
