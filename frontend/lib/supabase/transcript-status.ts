/**
 * A transcript's status, read with whichever client the caller holds (RLS
 * applies to it). Server pages use it to decide where a request may go.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Transcript } from '@/contracts/db'

/** The transcript's status, or null when the row can't be read. */
export async function fetchTranscriptStatus(
    supabase: SupabaseClient,
    transcriptId: string
): Promise<Transcript['status'] | null> {
    const { data } = await supabase
        .from('transcripts')
        .select('status')
        .eq('id', transcriptId)
        .maybeSingle()
    return (data as Pick<Transcript, 'status'> | null)?.status ?? null
}
