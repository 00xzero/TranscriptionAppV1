/**
 * The transcript row's media key, as the background steps read it: media
 * preparation before it may replace the file, and the engine call after.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Transcript } from '@/contracts/db'

export type SourceRow = Pick<Transcript, 'user_id' | 'source_object_key' | 'waveform_status'>

export async function readSourceRow(admin: SupabaseClient, transcriptId: string): Promise<SourceRow | null> {
    const { data, error } = await admin
        .from('transcripts')
        .select('user_id, source_object_key, waveform_status')
        .eq('id', transcriptId)
        .maybeSingle()
    if (error) throw new Error(`Failed to read transcript ${transcriptId}: ${error.message}`)
    return (data as SourceRow | null) ?? null
}

/**
 * The row's media key, when the row belongs to the user the event names and
 * the key is inside the transcript's own folder; otherwise null, and nothing
 * may be sent to the engine.
 */
export function ownedSourceKey(row: SourceRow, ids: { transcriptId: string; userId: string }): string | null {
    const prefix = `${row.user_id}/${ids.transcriptId}/`
    if (row.user_id !== ids.userId || !row.source_object_key?.startsWith(prefix)) return null
    return row.source_object_key
}
