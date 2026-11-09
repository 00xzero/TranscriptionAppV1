import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

jest.mock('@/lib/recording/session', () => ({
  saveRecovered: jest.fn(),
  discardRecovered: jest.fn(),
  exportRecovered: jest.fn(),
  // jest.setup.ts calls this global reset; keep it defined under the mock.
  __resetForTesting: jest.fn(),
}))

import RecoveryModal from '@/components/RecordingSession/RecoveryModal'
import { Toaster, __resetToastsForTesting } from '@/components/ui/toaster'
import { saveRecovered, discardRecovered, exportRecovered } from '@/lib/recording/session'
import type { RecoverableInfo } from '@/lib/recording/session'
import { DEFAULT_TRANSCRIPTION_OPTIONS } from '@/contracts/transcription-options'

const mockSave = jest.mocked(saveRecovered)
const mockDiscard = jest.mocked(discardRecovered)
const mockExport = jest.mocked(exportRecovered)

function makeInfo(overrides: Partial<RecoverableInfo> = {}): RecoverableInfo {
  return {
    sessionId: 's1',
    uploadIntentId: 'i1',
    projectId: null,
    title: 'My recovered title',
    generatedTitle: null,
    keyTerms: [],
    transcriptionOptions: DEFAULT_TRANSCRIPTION_OPTIONS,
    codecMime: 'audio/webm',
    codecExtension: 'webm',
    bytesSoFar: 2_000_000,
    createdAt: 1000,
    remainingCount: 0,
    mayBeTruncated: false,
    ...overrides,
  }
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value })
}

describe('RecoveryModal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    __resetToastsForTesting()
    setOnline(true)
    mockSave.mockResolvedValue({ ok: true })
    mockDiscard.mockResolvedValue(undefined)
  })

  test('renders seeded title and both actions', () => {
    render(<RecoveryModal info={makeInfo()} />)
    expect(screen.getByDisplayValue('My recovered title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save & transcribe/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^discard$/i })).toBeEnabled()
  })

  test('edited title flows into saveRecovered', async () => {
    render(<RecoveryModal info={makeInfo()} />)
    const input = screen.getByLabelText(/recovered recording title/i)
    fireEvent.change(input, { target: { value: 'Edited title' } })
    fireEvent.click(screen.getByRole('button', { name: /save & transcribe/i }))
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('Edited title', 's1'))
  })

  test('requires confirmation before discarding the exact row', async () => {
    render(<RecoveryModal info={makeInfo()} />)
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }))
    expect(mockDiscard).not.toHaveBeenCalled()
    const confirmation = screen.getByRole('alertdialog', { name: 'Discard this recording?' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith('s1'))
  })

  test('discard failure shows an error and re-enables actions', async () => {
    mockDiscard.mockRejectedValueOnce(new Error('Discard failed'))
    render(<RecoveryModal info={makeInfo()} />)
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }))
    const confirmation = screen.getByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Discard' }))
    expect(await within(confirmation).findByRole('alert')).toHaveTextContent('Discard failed')
    expect(within(confirmation).getByRole('button', { name: 'Discard' })).toBeEnabled()
  })

  test('offline disables Save and still allows a local download or discard', async () => {
    setOnline(false)
    render(<RecoveryModal info={makeInfo()} />)
    expect(screen.getByRole('button', { name: /save & transcribe/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^discard$/i })).toBeEnabled()
    expect(screen.getByText(/offline/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Download recording' }))
    await waitFor(() => expect(mockExport).toHaveBeenCalledWith('s1'))
  })

  test('shows "1 of N" when more orphans remain', () => {
    render(<RecoveryModal info={makeInfo({ remainingCount: 2 })} />)
    expect(screen.getByText(/1 of 3/)).toBeInTheDocument()
  })

  test('a chained save (another orphan queued) confirms with a toast', async () => {
    mockSave.mockResolvedValueOnce({ ok: true, chainedToNext: true })
    render(
      <>
        <RecoveryModal info={makeInfo({ title: 'First clip', remainingCount: 1 })} />
        <Toaster />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: /save & transcribe/i }))
    expect(await screen.findByText(/Recording saved/)).toBeInTheDocument()
    expect(screen.getByText(/First clip/)).toBeInTheDocument()
  })

  test('a warned chained save shows the exact Unfiled warning', async () => {
    mockSave.mockResolvedValueOnce({
      ok: true,
      chainedToNext: true,
      warning: 'project_missing',
    })
    render(
      <>
        <RecoveryModal info={makeInfo({ title: 'First clip', remainingCount: 1 })} />
        <Toaster />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: /save & transcribe/i }))
    expect(
      await screen.findByText('Saved to Unfiled: the project is no longer available')
    ).toBeInTheDocument()
    expect(screen.getByText(/“First clip” is uploading and will start transcribing/)).toBeInTheDocument()
    expect(screen.queryByText('Recording saved')).not.toBeInTheDocument()
  })

  test('shows the truncation caution only when mayBeTruncated', () => {
    const { rerender } = render(<RecoveryModal info={makeInfo()} />)
    expect(screen.queryByText(/may be missing the end/i)).not.toBeInTheDocument()

    rerender(<RecoveryModal info={makeInfo({ mayBeTruncated: true })} />)
    expect(screen.getByText(/may be missing the end/i)).toBeInTheDocument()
  })

  test('a final save does not toast (the route redirect acknowledges it)', async () => {
    mockSave.mockResolvedValueOnce({ ok: true, chainedToNext: false })
    render(
      <>
        <RecoveryModal info={makeInfo({ title: 'Only clip' })} />
        <Toaster />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: /save & transcribe/i }))
    await waitFor(() => expect(mockSave).toHaveBeenCalled())
    expect(screen.queryByText(/Recording saved/)).not.toBeInTheDocument()
  })
})
