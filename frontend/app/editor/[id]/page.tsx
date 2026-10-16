import { redirect } from 'next/navigation'
import { createClient } from '@/infra/supabase/server'
import { fetchTranscriptStatus } from '@/lib/supabase/transcript-status'
import EditorScreen from './EditorScreen'

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // The editor opens only finished transcripts, as the library and project
  // rows link: until then media preparation may replace the file it would play.
  // A row that can't be read is left to the editor's own error.
  const status = await fetchTranscriptStatus(await createClient(), id)
  if (status !== null && status !== 'completed') {
    redirect('/transcripts')
  }

  return <EditorScreen key={id} transcriptId={id} />
}
