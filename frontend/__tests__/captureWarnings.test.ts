import { showCaptureWarning } from '@/lib/capture/warnings'

const toastMock = jest.fn()

jest.mock('@/components/ui/toaster', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}))

describe('showCaptureWarning', () => {
  beforeEach(() => {
    toastMock.mockReset()
  })

  test('shows the exact Unfiled message for a project_missing warning', () => {
    expect(showCaptureWarning('project_missing')).toBe(true)

    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith({
      title: 'Saved to Unfiled: the project is no longer available',
    })
  })

  test('passes a caller description through', () => {
    showCaptureWarning('project_missing', '“Clip” is uploading and will start transcribing.')

    expect(toastMock).toHaveBeenCalledWith({
      title: 'Saved to Unfiled: the project is no longer available',
      description: '“Clip” is uploading and will start transcribing.',
    })
  })

  test('shows nothing when there is no warning', () => {
    expect(showCaptureWarning(undefined)).toBe(false)
    expect(toastMock).not.toHaveBeenCalled()
  })
})
