import React, { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DeleteTranscriptDialog } from '@/components/DeleteTranscriptDialog'
import { DiscardRecordingDialog } from '@/components/DiscardRecordingDialog'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function Harness({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(true)
  return <ConfirmDialog open={open} onOpenChange={setOpen} heading="Confirm" description="Proceed?" onConfirm={onConfirm} confirmLabel="Save" pendingLabel="Saving…" />
}

describe('ConfirmDialog', () => {
  test('awaits confirmation, disables both actions, and closes on resolve', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    render(<Harness onConfirm={() => pending.promise} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    pending.resolve()

    await waitFor(() => expect(screen.queryByText('Proceed?')).not.toBeInTheDocument())
  })

  test('keeps the dialog open and displays a rejected confirmation inline', async () => {
    const user = userEvent.setup()
    render(<Harness onConfirm={() => Promise.reject(new Error('Save failed.'))} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed.')
    expect(screen.getByText('Proceed?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  test.each<[string, React.ReactElement, string, string]>([
    ['delete transcript', <DeleteTranscriptDialog key="delete" open title="Alpha" onOpenChange={jest.fn()} onConfirm={() => Promise.reject(new Error('Delete failed.'))} />, 'Delete', 'Delete failed.'],
    ['discard recording', <DiscardRecordingDialog key="discard" open onOpenChange={jest.fn()} onConfirm={() => Promise.reject(new Error('Discard failed.'))} />, 'Discard', 'Discard failed.'],
  ])('keeps the %s wrapper open on failure', async (_name, dialog, action, message) => {
    const user = userEvent.setup()
    render(dialog)
    await user.click(screen.getByRole('button', { name: action }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
