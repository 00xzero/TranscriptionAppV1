import type { SupabaseClient } from '@supabase/supabase-js'
import { TranscriptStatusSchema } from '@/contracts/db'
import { EditorTranscriptSchema } from '@/contracts/editor'

/** Seed editor metadata in the same account-bound read as the route guard. */
export async function fetchEditorPageMetadata(supabase: SupabaseClient, transcriptId: string) {
  const { data } = await supabase
    .from('transcripts')
    .select('status, title, project_id, created_at, engine, engine_model, duration_seconds, waveform_status')
    .eq('id', transcriptId)
    .maybeSingle()
  return {
    status: TranscriptStatusSchema.safeParse(data?.status).data ?? null,
    metadata: EditorTranscriptSchema.safeParse(data).data ?? null,
  }
}
