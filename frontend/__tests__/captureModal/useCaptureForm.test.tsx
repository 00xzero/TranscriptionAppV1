import { act, renderHook } from '@testing-library/react'
import { useCaptureForm } from '@/components/CaptureModal/useCaptureForm'

const pushMock = jest.fn()
const uploadMock = jest.fn()
const resetErrorMock = jest.fn()
const showCaptureWarningMock = jest.fn()

jest.mock('@/lib/recording/guardedNavigation', () => ({
  useGuardedNavigate: () => ({
    push: pushMock,
  }),
}))

jest.mock('@/lib/capture/useCapture', () => ({
  useCapture: () => ({
    upload: uploadMock,
    isUploading: false,
    error: null,
    progress: 'idle',
    resetError: resetErrorMock,
  }),
}))

jest.mock('@/lib/capture/upload', () => ({
  MAX_FILE_SIZE_BYTES: 1024,
  validateFile: jest.fn(() => null),
}))

jest.mock('@/lib/capture/warnings', () => ({
  showCaptureWarning: (...args: unknown[]) => showCaptureWarningMock(...args),
}))

async function submitFile(projectId?: string | null) {
  const closeCaptureModal = jest.fn()
  const file = new File(['audio'], 'sample.wav', { type: 'audio/wav' })
  const { result } = renderHook(() =>
    useCaptureForm({ isCaptureModalOpen: true, closeCaptureModal, projectId })
  )

  act(() => {
    result.current.handleFileSelect(file)
  })
  await act(async () => {
    await result.current.handleSubmit()
  })

  return closeCaptureModal
}

describe('useCaptureForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('routes non-started upload outcomes through guarded navigation', async () => {
    uploadMock.mockResolvedValue({
      outcome: 'saved_needs_retry',
      transcriptId: 'transcript-1',
      message: 'Specific retry guidance.',
    })

    const closeCaptureModal = await submitFile()

    expect(closeCaptureModal).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith(
      '/transcripts?capture=saved_needs_retry&transcriptId=transcript-1&captureMessage=Specific+retry+guidance.'
    )
  })

  test('uploads into the intent project and surfaces the creation warning', async () => {
    uploadMock.mockResolvedValue({
      outcome: 'started',
      transcriptId: 'transcript-1',
      warning: 'project_missing',
    })

    await submitFile('project-1')

    expect(uploadMock).toHaveBeenCalledWith(expect.any(File), 'sample', [], 'project-1')
    expect(showCaptureWarningMock).toHaveBeenCalledTimes(1)
    expect(showCaptureWarningMock).toHaveBeenCalledWith('project_missing')
    expect(pushMock).not.toHaveBeenCalled()
  })

  test('prefills an over-long filename in full and blocks submit until it is shortened', async () => {
    const longName = 'z'.repeat(130)
    const file = new File(['audio'], `${longName}.wav`, { type: 'audio/wav' })
    const { result } = renderHook(() =>
      useCaptureForm({ isCaptureModalOpen: true, closeCaptureModal: jest.fn(), projectId: null })
    )

    act(() => {
      result.current.handleFileSelect(file)
    })
    expect(result.current.title).toBe(longName)
    expect(result.current.titleError).toBeNull()

    await act(async () => {
      await result.current.handleSubmit()
    })
    expect(uploadMock).not.toHaveBeenCalled()
    expect(result.current.titleError).toBe('Titles must be 120 characters or fewer.')

    act(() => {
      result.current.setTitle('z'.repeat(120))
    })
    expect(result.current.titleError).toBeNull()
  })

  test('sends a cleared title empty so the upload names it from the file', async () => {
    uploadMock.mockResolvedValue({ outcome: 'started', transcriptId: 'transcript-1' })
    const file = new File(['audio'], 'sample.wav', { type: 'audio/wav' })
    const { result } = renderHook(() =>
      useCaptureForm({ isCaptureModalOpen: true, closeCaptureModal: jest.fn(), projectId: null })
    )

    act(() => {
      result.current.handleFileSelect(file)
    })
    act(() => {
      result.current.setTitle('   ')
    })
    await act(async () => {
      await result.current.handleSubmit()
    })

    expect(uploadMock).toHaveBeenCalledWith(expect.any(File), '', [], null)
  })
})
