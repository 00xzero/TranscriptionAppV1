import EditorScreen from './EditorScreen'

export default function EditorPage({ params }: { params: { id: string } }) {
  return <EditorScreen projectId={params.id} />
}
