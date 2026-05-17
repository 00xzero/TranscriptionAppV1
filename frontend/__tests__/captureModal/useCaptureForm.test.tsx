import { act, renderHook } from '@testing-library/react'
import { useCaptureForm } from '@/components/CaptureModal/useCaptureForm'

const pushMock = jest.fn()
const uploadMock = jest.fn()
const resetErrorMock = jest.fn()

jest.mock('@/lib/recording/guardedNavigation', () => ({
  useGuardedNavigate: () => ({
    push: pushMock,
  }),
}))

jest.mock('@/lib/hooks/useCapture', () => ({
  MAX_FILE_SIZE_BYTES: 1024,
  validateFile: jest.fn(() => null),
  useCapture: () => ({
    upload: uploadMock,
    isUploading: false,
    error: null,
    progress: 'idle',
    resetError: resetErrorMock,
  }),
}))

describe('useCaptureForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('routes non-started upload outcomes through guarded navigation', async () => {
    uploadMock.mockResolvedValue({
      outcome: 'saved_needs_retry',
      projectId: 'project-1',
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
      '/projects?capture=saved_needs_retry&projectId=project-1'
    )
  })
})
