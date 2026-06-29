import EditorScreen from './EditorScreen'

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <EditorScreen key={id} transcriptId={id} />
}
