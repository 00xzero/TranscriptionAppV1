import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import CaptureModal from '../components/CaptureModal'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RemotePresenceProvider } from '@/lib/recording/RemotePresenceContext'
import {
  __resetForTesting,
  __setSnapshotForTesting,
  getSnapshot,
  startMock,
} from '@/lib/recording/session'
import { setIdentity } from '@/lib/recording/sessionIdentity'
import { setTestAuth } from '@/__tests__/helpers/auth'
import { makeProject, projectProviderData } from '@/__tests__/projects/fixtures'
import { DEFAULT_TRANSCRIPTION_OPTIONS, type TranscriptionOptions } from '@/contracts/transcription-options'

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported = jest.fn(() => true)
  state: 'inactive' | 'recording' | 'paused' = 'inactive'

  constructor(
    readonly stream: MediaStream,
    readonly options?: MediaRecorderOptions
  ) {
    super()
  }

  start = jest.fn(() => {
    this.state = 'recording'
  })

  pause = jest.fn(() => {
    this.state = 'paused'
  })

  resume = jest.fn(() => {
    this.state = 'recording'
  })

  stop = jest.fn(() => {
    this.state = 'inactive'
    this.dispatchEvent(new Event('stop'))
  })

  requestData = jest.fn()
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/transcripts',
}))

const mockCloseCaptureModal = jest.fn()
const mockModalState = {
  isCaptureModalOpen: true,
  captureModalIntent: null as null | {
    initialTab?: 'upload' | 'record'
    message?: string
    projectId?: string | null
  },
}
const mockCaptureFormState = {
  isUploading: false,
  // The user's pick. Undefined falls back to the intent, as the real form does.
  projectId: undefined as string | null | undefined,
  transcriptionOptions: DEFAULT_TRANSCRIPTION_OPTIONS as TranscriptionOptions,
}
const mockSetProjectId = jest.fn()
const mockSetTranscriptionOptions = jest.fn()
const mockUseProjectsData = jest.fn()
const captureProjects = [
  makeProject({ id: 'project-1', name: 'Clients' }),
  makeProject({ id: 'project-2', name: 'Acme', parent_id: 'project-1' }),
]
const originalUserAgent = navigator.userAgent
const originalVendor = navigator.vendor
const originalNavigatorMediaDevices = navigator.mediaDevices

jest.mock('../lib/ModalContext', () => ({
  useModal: () => ({
    isCaptureModalOpen: mockModalState.isCaptureModalOpen,
    captureModalIntent: mockModalState.captureModalIntent,
    closeCaptureModal: mockCloseCaptureModal,
  }),
}))

jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useProjectsData: () => mockUseProjectsData(),
}))

jest.mock('../components/CaptureModal/useCaptureForm', () => ({
  useCaptureForm: () => ({
    selectedFile: null,
    handleFileSelect: jest.fn(),
    clearFile: jest.fn(),
    projectId:
      mockCaptureFormState.projectId !== undefined
        ? mockCaptureFormState.projectId
        : (mockModalState.captureModalIntent?.projectId ?? null),
    setProjectId: mockSetProjectId,
    title: '',
    setTitle: jest.fn(),
    titleError: null,
    blockOverLongTitle: jest.fn(() => false),
    keyTerms: [],
    keyTermInput: '',
    setKeyTermInput: jest.fn(),
    keyTermsError: null,
    handleKeyTermKeyDown: jest.fn(),
    handleAddTermClick: jest.fn(),
    removeTerm: jest.fn(),
    transcriptionOptions: mockCaptureFormState.transcriptionOptions,
    setTranscriptionOptions: mockSetTranscriptionOptions,
    isUploading: mockCaptureFormState.isUploading,
    handleSubmit: jest.fn(),
    canSubmit: false,
    displayError: null,
    maxFileSizeLabel: '100 MB',
    buttonText: 'Begin Transcription',
  }),
}))

jest.mock('@/lib/auth/AuthProvider', () => require('@/__tests__/helpers/auth').authProviderMock)

function renderModal() {
  return render(
    <TooltipProvider delayDuration={0}>
      <CaptureModal />
    </TooltipProvider>
  )
}

function setMediaRecorder(value: unknown): void {
  Object.defineProperty(window, 'MediaRecorder', {
    configurable: true,
    writable: true,
    value,
  })
  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    writable: true,
    value,
  })
}

function enableFakeRecorder(): void {
  setMediaRecorder(FakeMediaRecorder)
}

function resetModalTestState(): void {
  jest.clearAllMocks()
  jest.useRealTimers()
  __resetForTesting()
  setIdentity({ userId: 'user-1', ready: true })
  setTestAuth({ userId: 'user-1', ready: true })
  mockModalState.isCaptureModalOpen = true
  mockModalState.captureModalIntent = null
  mockCaptureFormState.isUploading = false
  mockCaptureFormState.projectId = undefined
  mockCaptureFormState.transcriptionOptions = DEFAULT_TRANSCRIPTION_OPTIONS
  try { window.localStorage.clear() } catch {}
  mockUseProjectsData.mockReturnValue(projectProviderData(captureProjects))
  setMediaRecorder(undefined)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: originalNavigatorMediaDevices,
  })
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: originalUserAgent,
  })
  Object.defineProperty(navigator, 'vendor', {
    configurable: true,
    value: originalVendor,
  })
}

function makeMockStream(options: {
  deviceId?: string | null
  stop?: jest.Mock
} = {}): MediaStream {
  const stop = options.stop ?? jest.fn()
  const track = {
    stop,
    getSettings: () => ({ deviceId: options.deviceId ?? null }),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }

  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream
}

function setSafariNavigator(): void {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  })
  Object.defineProperty(navigator, 'vendor', {
    configurable: true,
    value: 'Apple Computer, Inc.',
  })
}

describe('CaptureModal', () => {
  beforeEach(() => {
    resetModalTestState()
  })

  test('renders as an accessible dialog and closes when idle', async () => {
    const user = userEventLib.setup()
    renderModal()

    expect(screen.getByRole('dialog', { name: /Capture/i })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(mockCloseCaptureModal).toHaveBeenCalledTimes(1)

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).not.toBeNull()

    await user.click(overlay as Element)
    expect(mockCloseCaptureModal).toHaveBeenCalledTimes(2)
  })

  test('the shared close button closes when idle, and names itself in a tooltip', async () => {
    const user = userEventLib.setup()
    renderModal()

    const close = screen.getByRole('button', { name: 'Close' })
    await user.hover(close)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Close')
    await user.click(close)
    expect(mockCloseCaptureModal).toHaveBeenCalledTimes(1)
  })

  test('blocks dismissal while uploading', async () => {
    const user = userEventLib.setup()
    mockCaptureFormState.isUploading = true

    renderModal()

    fireEvent.keyDown(document, { key: 'Escape' })

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).not.toBeNull()

    await user.click(overlay as Element)
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()

    expect(mockCloseCaptureModal).not.toHaveBeenCalled()
  })

  test('restores focus to the opener after closing', () => {
    jest.useFakeTimers()
    mockModalState.isCaptureModalOpen = false

    function Harness() {
      return (
        <TooltipProvider delayDuration={0}>
          <button type="button">Open capture</button>
          <CaptureModal />
        </TooltipProvider>
      )
    }

    const { rerender } = render(<Harness />)

    const openButton = screen.getByRole('button', { name: /open capture/i })
    openButton.focus()
    expect(openButton).toHaveFocus()

    mockModalState.isCaptureModalOpen = true
    mockModalState.captureModalIntent = null
    rerender(<Harness />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(mockCloseCaptureModal).toHaveBeenCalledTimes(1)

    mockModalState.isCaptureModalOpen = false
    rerender(<Harness />)

    act(() => {
      jest.runOnlyPendingTimers()
    })

    expect(openButton).toHaveFocus()
    jest.useRealTimers()
  })
})

describe('CaptureModal tabs', () => {
  beforeEach(() => {
    resetModalTestState()
  })

  test('renders both tab triggers with correct accessible names', () => {
    renderModal()

    expect(screen.getByRole('tab', { name: /upload audio/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /record audio/i })).toBeInTheDocument()
  })

  test('honors a record-tab open intent and shows its message', () => {
    mockModalState.captureModalIntent = {
      initialTab: 'record',
      message: 'Recording session not found. Please start a new recording.',
    }

    renderModal()

    expect(screen.getByRole('tab', { name: /record audio/i })).toHaveAttribute(
      'data-state',
      'active'
    )
    expect(
      screen.getByText(/recording session not found/i)
    ).toBeInTheDocument()
  })

  test('Record tab disables the Start Recording CTA when the browser cannot record', async () => {
    const user = userEventLib.setup()
    renderModal()

    await user.click(screen.getByRole('tab', { name: /record audio/i }))

    // jsdom has no MediaRecorder, so the codec probe fails and the CTA is
    // disabled with the unsupported-codec message.
    const startButton = screen.getByRole('button', { name: /start recording/i })
    expect(startButton).toBeDisabled()
    expect(startButton).toHaveAttribute(
      'title',
      "Audio recording isn't supported in this browser."
    )
  })

  test('Record tab renders its intended fields', async () => {
    const user = userEventLib.setup()
    renderModal()

    await user.click(screen.getByRole('tab', { name: /record audio/i }))

    // Mic selector + test button
    expect(screen.getByRole('combobox', { name: /microphone input device/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /test microphone/i })).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: /microphone input level/i })).toBeInTheDocument()

    // Shared CaptureDetails / KeyTermsInput fields
    expect(screen.getByLabelText(/^title$/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /advanced/i })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText(/add key terms for transcription/i)).toBeInTheDocument()
  })

  test('Record tab disables microphone controls while another recording is active', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    act(() => {
      startMock()
    })

    renderModal()
    await user.click(screen.getByRole('tab', { name: /record audio/i }))

    expect(
      screen.getByRole('combobox', { name: /microphone input device/i })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /test microphone/i })
    ).toBeDisabled()
    expect(
      screen.getByText(
        /a recording is already in progress or waiting to upload\. return to it before starting another\./i
      )
    ).toBeInTheDocument()
  })

  test('Record tab disables controls when another same-browser tab is recording (remote)', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()

    render(
      <TooltipProvider delayDuration={0}>
        <RemotePresenceProvider value={{ kind: 'lock-only' }}>
          <CaptureModal />
        </RemotePresenceProvider>
      </TooltipProvider>
    )
    await user.click(screen.getByRole('tab', { name: /record audio/i }))

    expect(
      screen.getByRole('combobox', { name: /microphone input device/i })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /test microphone/i })
    ).toBeDisabled()
    expect(
      screen.getByText(
        /a recording is already in progress in another tab\. return to that tab to continue\./i
      )
    ).toBeInTheDocument()
  })

  test('Record tab disables microphone controls while a recording upload can be retried', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    act(() => {
      __setSnapshotForTesting({
        state: 'error',
        errorMessage: 'Upload failed',
        canRetryUpload: true,
      })
    })

    renderModal()
    await user.click(screen.getByRole('tab', { name: /record audio/i }))

    expect(
      screen.getByRole('combobox', { name: /microphone input device/i })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /test microphone/i })
    ).toBeDisabled()
    expect(
      screen.getByText(
        /a recording is already in progress or waiting to upload\. return to it before starting another\./i
      )
    ).toBeInTheDocument()
  })

  test('Record tab shows the immediate microphone failure reason on start', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockRejectedValue(
          Object.assign(new Error('missing mic'), { name: 'NotFoundError' })
        ),
      },
    })

    renderModal()
    await user.click(screen.getByRole('tab', { name: /record audio/i }))
    await user.click(screen.getByRole('button', { name: /start recording/i }))

    expect(
      await screen.findAllByText('No microphone was found.')
    ).not.toHaveLength(0)
  })

  test('records the project intent when capture starts from a project', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    mockModalState.captureModalIntent = {
      initialTab: 'record',
      projectId: 'project-1',
    }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue(makeMockStream({ deviceId: 'mic-1' })),
        enumerateDevices: jest.fn().mockResolvedValue([]),
      },
    })

    renderModal()
    await user.click(screen.getByRole('button', { name: /start recording/i }))

    await waitFor(() => expect(getSnapshot().state).toBe('recording'))
    expect(getSnapshot().projectId).toBe('project-1')
  })

  test.each([
    ['another project', 'project-2'],
    ['Unfiled', null],
  ])('records into the project the user picked (%s) over the intent', async (_label, picked) => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    mockModalState.captureModalIntent = { initialTab: 'record', projectId: 'project-1' }
    mockCaptureFormState.projectId = picked
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue(makeMockStream({ deviceId: 'mic-1' })),
        enumerateDevices: jest.fn().mockResolvedValue([]),
      },
    })

    renderModal()
    await user.click(screen.getByRole('button', { name: /start recording/i }))

    await waitFor(() => expect(getSnapshot().state).toBe('recording'))
    expect(getSnapshot().projectId).toBe(picked)
  })

  test('locks the transcript details while a recording is starting', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    mockModalState.captureModalIntent = { initialTab: 'record' }
    let resolveMicRequest: ((stream: MediaStream) => void) | undefined
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              resolveMicRequest = resolve
            })
        ),
        enumerateDevices: jest.fn().mockResolvedValue([]),
      },
    })

    renderModal()
    expect(screen.getByLabelText(/^title$/i)).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Project Unfiled' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /start recording/i }))

    expect(screen.getByLabelText(/^title$/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Project Unfiled' })).toBeDisabled()
    expect(screen.getByLabelText(/add key terms for transcription/i)).toBeDisabled()

    await act(async () => {
      resolveMicRequest?.(makeMockStream({ deviceId: 'mic-1' }))
    })
    await waitFor(() => expect(getSnapshot().state).toBe('recording'))
  })

  test('Record tab disables Start Recording while a microphone request is pending', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    let resolveMicRequest: ((stream: MediaStream) => void) | undefined
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              resolveMicRequest = resolve
            })
        ),
      },
    })

    renderModal()
    await user.click(screen.getByRole('tab', { name: /record audio/i }))
    await user.click(screen.getByRole('button', { name: /test microphone/i }))

    const startButton = screen.getByRole('button', { name: /start recording/i })
    expect(startButton).toBeDisabled()
    expect(startButton).toHaveAttribute('title', 'Requesting microphone…')

    await act(async () => {
      resolveMicRequest?.({
        getAudioTracks: () => [],
        getTracks: () => [],
      } as unknown as MediaStream)
    })
  })

  test('closing the modal stops a microphone request that resolves afterward', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    const stop = jest.fn()
    let resolveMicRequest: ((stream: MediaStream) => void) | undefined
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              resolveMicRequest = resolve
            })
        ),
      },
    })

    const { rerender } = renderModal()
    await user.click(screen.getByRole('tab', { name: /record audio/i }))
    await user.click(screen.getByRole('button', { name: /test microphone/i }))

    mockModalState.isCaptureModalOpen = false
    rerender(
      <TooltipProvider delayDuration={0}>
        <CaptureModal />
      </TooltipProvider>
    )

    await act(async () => {
      resolveMicRequest?.({
        getAudioTracks: () => [],
        getTracks: () => [{ stop }],
      } as unknown as MediaStream)
    })

    expect(stop).toHaveBeenCalledTimes(1)
  })

  test('closing the modal cancels a microphone request during device enumeration', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    const stop = jest.fn()
    let resolveEnumeration: ((devices: MediaDeviceInfo[]) => void) | undefined
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue({
          getAudioTracks: () => [
            {
              getSettings: () => ({ deviceId: 'mic-1' }),
            },
          ],
          getTracks: () => [{ stop }],
        } as unknown as MediaStream),
        enumerateDevices: jest.fn(
          () =>
            new Promise<MediaDeviceInfo[]>((resolve) => {
              resolveEnumeration = resolve
            })
        ),
      },
    })

    const { rerender } = renderModal()
    await user.click(screen.getByRole('tab', { name: /record audio/i }))
    await user.click(screen.getByRole('button', { name: /start recording/i }))

    mockModalState.isCaptureModalOpen = false
    rerender(
      <TooltipProvider delayDuration={0}>
        <CaptureModal />
      </TooltipProvider>
    )

    await act(async () => {
      resolveEnumeration?.([])
    })

    expect(stop).toHaveBeenCalledTimes(1)
  })

  test('Safari prewarms a freshly acquired mic before recording starts', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    setSafariNavigator()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue(makeMockStream({ deviceId: 'mic-1' })),
      },
    })

    renderModal()
    await user.click(screen.getByRole('tab', { name: /record audio/i }))
    jest.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))

    expect(await screen.findAllByText('Preparing microphone…')).not.toHaveLength(0)
    expect(getSnapshot().state).toBe('idle')

    await act(async () => {
      jest.advanceTimersByTime(3999)
    })

    expect(getSnapshot().state).toBe('idle')

    await act(async () => {
      jest.advanceTimersByTime(1)
    })

    expect(getSnapshot().state).toBe('recording')
    expect(mockCloseCaptureModal).toHaveBeenCalledTimes(1)
  })

  test('closing the modal during Safari prewarm stops the fresh mic stream', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    setSafariNavigator()
    const stop = jest.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue(
          makeMockStream({ deviceId: 'mic-1', stop })
        ),
      },
    })

    const { rerender } = renderModal()
    await user.click(screen.getByRole('tab', { name: /record audio/i }))
    jest.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))

    expect(await screen.findAllByText('Preparing microphone…')).not.toHaveLength(0)

    mockModalState.isCaptureModalOpen = false
    rerender(
      <TooltipProvider delayDuration={0}>
        <CaptureModal />
      </TooltipProvider>
    )

    expect(stop).toHaveBeenCalledTimes(1)
    expect(getSnapshot().state).toBe('idle')
  })

  test('Safari shows microphone preparation when testing a fresh mic stream', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    setSafariNavigator()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue(makeMockStream({ deviceId: 'mic-1' })),
      },
    })

    renderModal()
    await user.click(screen.getByRole('tab', { name: /record audio/i }))
    jest.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /test microphone/i }))

    expect(await screen.findAllByText('Preparing microphone…')).not.toHaveLength(0)

    await act(async () => {
      jest.advanceTimersByTime(4000)
    })

    expect(screen.queryByText('Preparing microphone…')).not.toBeInTheDocument()
    expect(getSnapshot().state).toBe('idle')
  })

  test('Safari waits only the remaining mic warmup when recording after a quick test', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    setSafariNavigator()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue(makeMockStream({ deviceId: 'mic-1' })),
      },
    })

    renderModal()
    await user.click(screen.getByRole('tab', { name: /record audio/i }))
    jest.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /test microphone/i }))
    expect(await screen.findAllByText('Preparing microphone…')).not.toHaveLength(0)

    await act(async () => {
      jest.advanceTimersByTime(1000)
    })

    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))

    await act(async () => {
      jest.advanceTimersByTime(2999)
    })

    expect(getSnapshot().state).toBe('idle')

    await act(async () => {
      jest.advanceTimersByTime(1)
    })

    expect(getSnapshot().state).toBe('recording')
    expect(mockCloseCaptureModal).toHaveBeenCalledTimes(1)
  })

  test('Safari uses a fully warmed tested mic stream without another prewarm delay', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    setSafariNavigator()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue(makeMockStream({ deviceId: 'mic-1' })),
      },
    })

    renderModal()
    await user.click(screen.getByRole('tab', { name: /record audio/i }))
    jest.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /test microphone/i }))

    expect(await screen.findAllByText('Preparing microphone…')).not.toHaveLength(0)

    await act(async () => {
      jest.advanceTimersByTime(4000)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start recording/i }))
    })

    expect(screen.queryByText('Preparing microphone…')).not.toBeInTheDocument()
    expect(getSnapshot().state).toBe('recording')
    expect(mockCloseCaptureModal).toHaveBeenCalledTimes(1)
  })

  test('switching back to Upload restores the Begin Transcription CTA', async () => {
    const user = userEventLib.setup()
    renderModal()

    await user.click(screen.getByRole('tab', { name: /record audio/i }))
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /upload audio/i }))

    const submitButton = screen.getByRole('button', { name: /begin transcription/i })
    expect(submitButton).toBeInTheDocument()
    expect(submitButton).toHaveAttribute('title', 'Select a file to continue')
  })

  test('keeps upload progress visible and tabs locked while uploading', async () => {
    const user = userEventLib.setup()
    mockCaptureFormState.isUploading = true
    renderModal()

    const uploadTab = screen.getByRole('tab', { name: /upload audio/i })
    const recordTab = screen.getByRole('tab', { name: /record audio/i })

    expect(uploadTab).toBeDisabled()
    expect(recordTab).toBeDisabled()

    await user.click(recordTab)

    expect(uploadTab).toHaveAttribute('data-state', 'active')
    expect(recordTab).toHaveAttribute('data-state', 'inactive')
    expect(screen.getByRole('button', { name: /begin transcription/i })).toBeInTheDocument()
  })

  test('remembers the last-used tab across close and reopen', async () => {
    const user = userEventLib.setup()

    function Harness() {
      return (
        <TooltipProvider delayDuration={0}>
          <CaptureModal />
        </TooltipProvider>
      )
    }

    const { rerender } = render(<Harness />)

    // Switch to Record tab
    await user.click(screen.getByRole('tab', { name: /record audio/i }))
    expect(screen.getByRole('tab', { name: /record audio/i })).toHaveAttribute('data-state', 'active')

    // Close the modal (simulating the global modal being toggled off)
    mockModalState.isCaptureModalOpen = false
    rerender(<Harness />)
    expect(screen.queryByRole('dialog', { name: /Capture/i })).not.toBeInTheDocument()

    // Reopen — modal is still mounted at root, so tab state should persist
    mockModalState.isCaptureModalOpen = true
    rerender(<Harness />)

    expect(screen.getByRole('tab', { name: /record audio/i })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('tab', { name: /upload audio/i })).toHaveAttribute('data-state', 'inactive')
  })
})

describe('CaptureModal project field', () => {
  beforeEach(() => {
    resetModalTestState()
  })

  test('shows Unfiled when opened from outside a project', () => {
    renderModal()
    expect(screen.getByRole('button', { name: 'Project Unfiled' })).toBeEnabled()
  })

  test('sits between Title and Key terms', () => {
    renderModal()
    const title = screen.getByLabelText(/^title$/i)
    const project = screen.getByRole('button', { name: 'Project Unfiled' })
    const keyTerms = screen.getByRole('textbox', { name: 'Add key terms for transcription' })
    expect(title.compareDocumentPosition(project) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(project.compareDocumentPosition(keyTerms) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('shows the project path, and keeps it when switching tabs', async () => {
    const user = userEventLib.setup()
    mockModalState.captureModalIntent = { projectId: 'project-2' }
    renderModal()

    expect(screen.getByRole('button', { name: 'Project Clients / Acme' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /record audio/i }))
    expect(screen.getByRole('button', { name: 'Project Clients / Acme' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /upload audio/i }))
    expect(screen.getByRole('button', { name: 'Project Clients / Acme' })).toBeInTheDocument()
  })

  test('picks a destination from the project tree and closes it', async () => {
    const user = userEventLib.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: 'Project Unfiled' }))
    expect(screen.getByRole('dialog', { name: 'Project' })).toBeInTheDocument()
    expect(screen.getByRole('tree', { name: 'Project destinations' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search projects' })).toHaveFocus()

    await user.click(screen.getByRole('treeitem', { name: 'Clients' }))

    expect(mockSetProjectId).toHaveBeenCalledWith('project-1')
    await waitFor(() =>
      expect(screen.queryByRole('tree', { name: 'Project destinations' })).not.toBeInTheDocument()
    )
  })

  test('Escape closes the project tree without closing the dialog', async () => {
    const user = userEventLib.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: 'Project Unfiled' }))
    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('tree', { name: 'Project destinations' })).not.toBeInTheDocument()
    )
    expect(mockCloseCaptureModal).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Project Unfiled' })).toHaveFocus()
  })

  test('waits for projects to load', () => {
    mockUseProjectsData.mockReturnValue({ ...projectProviderData([]), projectsLoading: true })
    renderModal()
    expect(screen.getByRole('button', { name: 'Project Loading projects…' })).toBeDisabled()
  })

  test('offers a retry when projects failed to load', async () => {
    const user = userEventLib.setup()
    const data = { ...projectProviderData([]), projectError: new Error('offline') }
    mockUseProjectsData.mockReturnValue(data)
    mockModalState.captureModalIntent = { projectId: 'project-1' }
    renderModal()

    expect(screen.getByRole('button', { name: "Project Couldn't load projects" })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(data.refetchProjects).toHaveBeenCalledTimes(1)
  })

  test('locks while uploading', () => {
    mockCaptureFormState.isUploading = true
    renderModal()
    expect(screen.getByRole('button', { name: 'Project Unfiled' })).toBeDisabled()
  })
})

describe('CaptureModal advanced options', () => {
  beforeEach(() => {
    resetModalTestState()
  })

  function startableMic() {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue(makeMockStream({ deviceId: 'mic-1' })),
        enumerateDevices: jest.fn().mockResolvedValue([]),
      },
    })
  }

  test('starts collapsed, with the options summed up on its row', () => {
    mockCaptureFormState.transcriptionOptions = {
      engine: 'deepgram',
      language: 'es',
      detect_speakers: false,
      keep_filler_words: true,
      mask_profanity: true,
    }
    renderModal()

    const trigger = screen.getByRole('button', { name: /advanced/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveTextContent('Spanish · speakers off · profanity masked')
    expect(screen.queryByRole('switch', { name: 'Detect speakers' })).not.toBeInTheDocument()
  })

  test('opens to the language and the three switches, set to the form state', async () => {
    const user = userEventLib.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: /advanced/i }))

    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent('English')
    expect(screen.getByRole('switch', { name: 'Detect speakers' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Keep filler words' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Mask profanity' })).not.toBeChecked()
  })

  test('a switch hands the whole changed options to the form', async () => {
    const user = userEventLib.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: /advanced/i }))
    await user.click(screen.getByRole('switch', { name: 'Mask profanity' }))

    expect(mockSetTranscriptionOptions).toHaveBeenCalledWith({
      ...DEFAULT_TRANSCRIPTION_OPTIONS,
      mask_profanity: true,
    })
  })

  test('filler words are English only', async () => {
    const user = userEventLib.setup()
    mockCaptureFormState.transcriptionOptions = { ...DEFAULT_TRANSCRIPTION_OPTIONS, language: 'fr' }
    renderModal()

    await user.click(screen.getByRole('button', { name: /advanced/i }))

    const fillers = screen.getByRole('switch', { name: 'Keep filler words' })
    expect(fillers).toBeDisabled()
    expect(fillers).not.toBeChecked()
    expect(screen.getByText('English only')).toBeInTheDocument()
  })

  test('locks while uploading', async () => {
    const user = userEventLib.setup()
    mockCaptureFormState.isUploading = true
    renderModal()

    await user.click(screen.getByRole('button', { name: /advanced/i }))

    expect(screen.getByRole('switch', { name: 'Detect speakers' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeDisabled()
  })

  test('a recording starts with the options and saves them for next time', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    startableMic()
    const chosen = { ...DEFAULT_TRANSCRIPTION_OPTIONS, language: 'de' as const, detect_speakers: false }
    mockCaptureFormState.transcriptionOptions = chosen
    mockModalState.captureModalIntent = { initialTab: 'record' }
    renderModal()

    await user.click(screen.getByRole('button', { name: /start recording/i }))

    await waitFor(() => expect(getSnapshot().state).toBe('recording'))
    expect(getSnapshot().transcriptionOptions).toEqual(chosen)
    expect(JSON.parse(window.localStorage.getItem('capture.transcriptionOptions') ?? 'null')).toEqual(chosen)
  })

  test('a recording that fails to start saves nothing', async () => {
    const user = userEventLib.setup()
    enableFakeRecorder()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockRejectedValue(
          Object.assign(new Error('missing mic'), { name: 'NotFoundError' })
        ),
      },
    })
    mockCaptureFormState.transcriptionOptions = { ...DEFAULT_TRANSCRIPTION_OPTIONS, mask_profanity: true }
    mockModalState.captureModalIntent = { initialTab: 'record' }
    renderModal()

    await user.click(screen.getByRole('button', { name: /start recording/i }))

    expect(await screen.findAllByText('No microphone was found.')).not.toHaveLength(0)
    expect(window.localStorage.getItem('capture.transcriptionOptions')).toBeNull()
  })
})
