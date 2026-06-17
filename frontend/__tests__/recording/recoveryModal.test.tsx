import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('@/lib/recording/session', () => ({
  saveRecovered: jest.fn(),
  discardRecovered: jest.fn(),
  // jest.setup.ts calls this global reset; keep it defined under the mock.
  __resetForTesting: jest.fn(),
}))

import RecoveryModal from '@/components/RecordingSession/RecoveryModal'
import { Toaster, __resetToastsForTesting } from '@/components/ui/toaster'
import { saveRecovered, discardRecovered } from '@/lib/recording/session'
import type { RecoverableInfo } from '@/lib/recording/session'

const mockSave = jest.mocked(saveRecovered)
const mockDiscard = jest.mocked(discardRecovered)

function makeInfo(overrides: Partial<RecoverableInfo> = {}): RecoverableInfo {
  return {
    sessionId: 's1',
    uploadIntentId: 'i1',
    title: 'My recovered title',
    generatedTitle: null,
    keyTerms: [],
    codecMime: 'audio/webm',
    codecExtension: 'webm',
    bytesSoFar: 2_000_000,
    createdAt: 1000,
    remainingCount: 0,
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
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('Edited title'))
  })

  test('discard calls discardRecovered', async () => {
    render(<RecoveryModal info={makeInfo()} />)
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }))
    await waitFor(() => expect(mockDiscard).toHaveBeenCalledTimes(1))
  })

  test('discard failure shows an error and re-enables actions', async () => {
    mockDiscard.mockRejectedValueOnce(new Error('Discard failed'))
    render(<RecoveryModal info={makeInfo()} />)
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Discard failed')
    expect(screen.getByRole('button', { name: /^discard$/i })).toBeEnabled()
  })

  test('offline disables Save but keeps Discard enabled', () => {
    setOnline(false)
    render(<RecoveryModal info={makeInfo()} />)
    expect(screen.getByRole('button', { name: /save & transcribe/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^discard$/i })).toBeEnabled()
    expect(screen.getByText(/offline/i)).toBeInTheDocument()
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
