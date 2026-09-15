import { act, renderHook } from '@testing-library/react'
import { useCaptureForm } from '@/components/CaptureModal/useCaptureForm'

const pushMock = jest.fn()
const uploadMock = jest.fn()
const resetErrorMock = jest.fn()
const toastMock = jest.fn()
const useCaptureMock = jest.fn((_projectId?: string | null) => ({
  upload: uploadMock,
  isUploading: false,
  error: null,
  progress: 'idle',
  resetError: resetErrorMock,
}))

jest.mock('@/lib/recording/guardedNavigation', () => ({
  useGuardedNavigate: () => ({
    push: pushMock,
  }),
}))

jest.mock('@/lib/hooks/useCapture', () => ({
  useCapture: (projectId?: string | null) => useCaptureMock(projectId),
}))

jest.mock('@/lib/capture/upload', () => ({
  MAX_FILE_SIZE_BYTES: 1024,
  validateFile: jest.fn(() => null),
}))

jest.mock('@/components/ui/toaster', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}))

describe('useCaptureForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('routes warned retry outcomes through guarded navigation and shows the warning', async () => {
    uploadMock.mockResolvedValue({
      outcome: 'saved_needs_retry',
      transcriptId: 'transcript-1',
      message: 'Specific retry guidance.',
      warning: 'project_missing',
    })
    const closeCaptureModal = jest.fn()
    const file = new File(['audio'], 'sample.wav', { type: 'audio/wav' })
    const { result } = renderHook(() =>
      useCaptureForm({ isCaptureModalOpen: true, closeCaptureModal })
    )

    act(() => {
      result.current.handleFileSelect(file)
    })

    await act(async () => {
      await result.current.handleSubmit()
    })

    expect(closeCaptureModal).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith(
      '/transcripts?capture=saved_needs_retry&transcriptId=transcript-1&captureMessage=Specific+retry+guidance.'
    )
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith({
      title: 'Saved to Unfiled: the project is no longer available',
    })
  })

  test('threads project intent into capture and shows the Unfiled warning', async () => {
    uploadMock.mockResolvedValue({
      outcome: 'started',
      transcriptId: 'transcript-1',
      warning: 'project_missing',
    })
    const closeCaptureModal = jest.fn()
    const file = new File(['audio'], 'sample.wav', { type: 'audio/wav' })
    const { result } = renderHook(() =>
      useCaptureForm({
        isCaptureModalOpen: true,
        closeCaptureModal,
        projectId: 'project-1',
      })
    )

    act(() => result.current.handleFileSelect(file))
    await act(async () => result.current.handleSubmit())

    expect(useCaptureMock).toHaveBeenCalledWith('project-1')
    expect(toastMock).toHaveBeenCalledWith({
      title: 'Saved to Unfiled: the project is no longer available',
    })
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalled()
  })
})
