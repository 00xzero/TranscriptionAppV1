import { useEffect } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import AccountChangedScreen, { CurrentAccountOnly } from '@/components/AccountChangedScreen'
import { setLeaveGuard } from '@/lib/editor/leaveGuard'
import { copyText } from '@/lib/editor/unsavedToasts'
import { mockSignOut, resetTestAuth, setTestAuth } from '@/__tests__/helpers/auth'

jest.mock('@/lib/auth/AuthProvider', () => require('@/__tests__/helpers/auth').authProviderMock)
jest.mock('@/lib/editor/unsavedToasts', () => ({ copyText: jest.fn(async () => true) }))

let mockRecordingState = 'idle'
let mockDurable = true
let mockMemoryFile: File | null = null
const mockStopAndFinalize = jest.fn(async () => undefined)
jest.mock('@/lib/recording/RecordingSessionContext', () => ({
  useRecordingSession: () => ({ state: mockRecordingState, durable: mockDurable }),
  useRecordingActions: () => ({ stopAndFinalize: mockStopAndFinalize }),
}))
jest.mock('@/lib/recording/session', () => ({
  ...jest.requireActual('@/lib/recording/session'),
  getFinalizedRecordingFile: () => mockMemoryFile,
}))

/** What the account cookie says (account-marker.ts); null removes it. */
function markAccount(value: string | null) {
  document.cookie = value === null ? 'olivetti-account=; max-age=0; path=/' : `olivetti-account=${value}; path=/`
}

const COOKIE_FOR = { switched: 'app-user-b', 'signed-out': 'none', 'sign-in-again': null } as const

/** The page settled on A, then stopped for `accountChange`, with the cookie saying so. */
function freezeAs(accountChange: 'switched' | 'signed-out' | 'sign-in-again' | null) {
  setTestAuth({ userId: 'app-user-a', ready: true, accountChange })
  markAccount(accountChange ? COOKIE_FOR[accountChange] : 'app-user-a')
}

function resetRecording() {
  mockRecordingState = 'idle'
  mockDurable = true
  mockMemoryFile = null
}

describe('AccountChangedScreen', () => {
  let removeGuard: (() => void) | null = null

  beforeEach(() => {
    jest.clearAllMocks()
    resetTestAuth()
    resetRecording()
  })
  afterEach(() => {
    removeGuard?.()
    removeGuard = null
  })

  test('shows nothing while the page still belongs to the session', () => {
    freezeAs(null)
    render(<AccountChangedScreen />)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  test('a switch covers the page and asks for a reload', () => {
    freezeAs('switched')
    render(<AccountChangedScreen />)

    expect(screen.getByRole('alertdialog')).toHaveTextContent("You've signed in to another account")
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy unsaved text' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop recording' })).not.toBeInTheDocument()
  })

  test('signed out in another tab offers Sign in', () => {
    freezeAs('signed-out')
    render(<AccountChangedScreen />)

    expect(screen.getByRole('alertdialog')).toHaveTextContent("You've signed out in another tab")
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  test('a session from before the account cookie signs out first, then signs in', () => {
    freezeAs('sign-in-again')
    render(<AccountChangedScreen />)

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  test('follows another tab signing in after the page stopped: it offers Reload, never a sign-out', () => {
    jest.useFakeTimers()
    try {
      freezeAs('signed-out')
      render(<AccountChangedScreen />)
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()

      // B signs in elsewhere.
      markAccount('app-user-b')
      act(() => jest.advanceTimersByTime(1000))

      expect(screen.getByRole('alertdialog')).toHaveTextContent("You've signed in to another account")
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  test('a stale Sign in clicked after B signed in reads the cookie first and does not sign B out', () => {
    // jsdom can't reload; the point is what does not happen.
    const navigation = jest.spyOn(console, 'error').mockImplementation(() => {})
    freezeAs('sign-in-again')
    render(<AccountChangedScreen />)

    // B signs in between the last check and the click.
    markAccount('app-user-b')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(mockSignOut).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    navigation.mockRestore()
  })

  test('keeps warning before leaving while it holds the editor’s unsaved text', () => {
    removeGuard = setLeaveGuard({ pending: () => true, leave: jest.fn(), unsavedTexts: () => ['Draft text'] })
    freezeAs('switched')
    render(<AccountChangedScreen />)
    // The editor itself is gone by now.
    removeGuard()
    removeGuard = null

    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)

    expect(leaving.defaultPrevented).toBe(true)
  })

  test('does not warn before leaving with nothing unsaved', () => {
    freezeAs('switched')
    render(<AccountChangedScreen />)

    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)

    expect(leaving.defaultPrevented).toBe(false)
  })

  test('a device that can’t keep recordings offers the stopped recording as a file', () => {
    mockRecordingState = 'error'
    mockDurable = false
    mockMemoryFile = new File(['audio'], 'recording.webm', { type: 'audio/webm' })
    const createObjectURL = jest.fn(() => 'blob:recording')
    Object.assign(URL, { createObjectURL, revokeObjectURL: jest.fn() })
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    freezeAs('switched')
    render(<AccountChangedScreen />)

    expect(screen.getByRole('alertdialog')).toHaveTextContent('couldn’t keep your recording on this device')
    fireEvent.click(screen.getByRole('button', { name: 'Download recording' }))

    expect(createObjectURL).toHaveBeenCalledWith(mockMemoryFile)
    expect(click).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Downloaded' })).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    click.mockRestore()
  })

  test('a live recording on such a device says to stop it, then download it', () => {
    mockRecordingState = 'recording'
    mockDurable = false
    freezeAs('switched')
    render(<AccountChangedScreen />)

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Stop it, then download it')
    expect(screen.getByRole('button', { name: 'Stop recording' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download recording' })).not.toBeInTheDocument()
  })

  test('a device that keeps recordings offers no download', () => {
    mockRecordingState = 'error'
    mockMemoryFile = new File(['audio'], 'recording.webm')
    freezeAs('switched')
    render(<AccountChangedScreen />)

    expect(screen.queryByRole('button', { name: 'Download recording' })).not.toBeInTheDocument()
  })

  test('stays up after Escape and after every button', async () => {
    mockRecordingState = 'recording'
    removeGuard = setLeaveGuard({ pending: () => true, leave: jest.fn(), unsavedTexts: () => ['Draft text'] })
    freezeAs('signed-out')
    render(<AccountChangedScreen />)

    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy unsaved text' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    })

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  test('copies the editor’s unsaved text', async () => {
    removeGuard = setLeaveGuard({ pending: () => true, leave: jest.fn(), unsavedTexts: () => ['First draft', 'Second draft'] })
    freezeAs('switched')
    render(<AccountChangedScreen />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy unsaved text' }))
    })

    expect(copyText).toHaveBeenCalledWith(['First draft', 'Second draft'])
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  test.each(['recording', 'paused'])('a %s recording can be stopped and kept on the device', async (state) => {
    mockRecordingState = state
    freezeAs('switched')
    render(<AccountChangedScreen />)

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Stop it to keep it on this device')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    })

    expect(mockStopAndFinalize).toHaveBeenCalledTimes(1)
  })

})

describe('CurrentAccountOnly', () => {
  /** An editor with unsaved text: installs its leave guard while mounted. */
  function EditorWithDraft() {
    useEffect(() => setLeaveGuard({ pending: () => true, leave: jest.fn(), unsavedTexts: () => ['Typed before the switch'] }), [])
    return <p>Old account’s transcript</p>
  }

  function App() {
    return (
      <>
        <CurrentAccountOnly>
          <EditorWithDraft />
        </CurrentAccountOnly>
        <AccountChangedScreen />
      </>
    )
  }

  beforeEach(() => {
    jest.clearAllMocks()
    resetTestAuth()
    resetRecording()
  })

  test('removes the app once the account changes, keeping the editor’s unsaved text to copy', () => {
    freezeAs(null)
    const { rerender } = render(<App />)
    expect(screen.getByText('Old account’s transcript')).toBeInTheDocument()

    freezeAs('switched')
    rerender(<App />)

    // The old account's content is gone from the page, not only covered.
    expect(screen.queryByText('Old account’s transcript')).not.toBeInTheDocument()
    // The draft was read before the editor unmounted.
    expect(screen.getByRole('button', { name: 'Copy unsaved text' })).toBeInTheDocument()
  })
})
