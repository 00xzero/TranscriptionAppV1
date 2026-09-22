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
})
