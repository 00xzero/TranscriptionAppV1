import React from 'react'
import { render, screen } from '@testing-library/react'
import EditorHeader from '@/app/(app)/editor/[id]/components/EditorHeader'
import { TooltipProvider } from '@/components/ui/tooltip'

function renderHeader(props: Partial<React.ComponentProps<typeof EditorHeader>> = {}) {
  return render(
    <TooltipProvider>
      <EditorHeader
        displayTitle="engine-check"
        transcriptCreatedAt="2026-10-19T17:19:00Z"
        transcriptDurationSecs={21}
        status="Ready"
        editingTitle={false}
        titleInput=""
        setTitleInput={() => {}}
        titleInputRef={React.createRef()}
        titleSaveError={null}
        startEditingTitle={() => {}}
        onTitleKeyDown={() => {}}
        onTitleBlur={() => {}}
        onDeleteClick={() => {}}
        onMoveClick={() => {}}
        titleBusy={false}
        {...props}
      />
    </TooltipProvider>
  )
}

describe('EditorHeader', () => {
  test('names the engine after the date and duration', () => {
    renderHeader({ engineLabel: 'Soniox v5' })

    const engine = screen.getByText('Soniox v5')
    const row = engine.parentElement!
    expect(row).toHaveTextContent(/OCT 19, 2026\s*•\s*00:00:21\s*•\s*Soniox v5/)
  })

  test('without a known engine the row is as before', () => {
    renderHeader({ engineLabel: null })

    expect(screen.queryByText('Soniox v5')).not.toBeInTheDocument()
    expect(screen.getByText('OCT 19, 2026').parentElement!.textContent).toMatch(/00:00:21$/)
  })

  test('while not ready, the row shows the status instead', () => {
    renderHeader({ engineLabel: 'Deepgram Nova-3', status: 'Processing…' })

    expect(screen.getByText('Processing…')).toBeInTheDocument()
    expect(screen.queryByText('Deepgram Nova-3')).not.toBeInTheDocument()
  })
})
