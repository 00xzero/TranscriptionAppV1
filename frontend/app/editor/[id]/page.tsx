import EditorScreen from './EditorScreen'

export default function EditorPage({ params }: { params: { id: string } }) {
  return <EditorScreen key={params.id} projectId={params.id} />
}
