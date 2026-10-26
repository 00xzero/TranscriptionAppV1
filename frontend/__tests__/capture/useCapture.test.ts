import { act, renderHook } from '@testing-library/react'
import { useCapture } from '@/lib/capture/useCapture'
import { runCaptureUpload, type CaptureUploadOptions } from '@/lib/capture/upload'
import { resetTestAuth, setTestAuth } from '@/__tests__/helpers/auth'

jest.mock('@/lib/auth/AuthProvider', () => require('@/__tests__/helpers/auth').authProviderMock)

jest.mock('@/lib/capture/upload', () => ({
  runCaptureUpload: jest.fn(),
  validateFile: jest.fn(() => null),
}))

const runCaptureUploadMock = runCaptureUpload as jest.MockedFunction<typeof runCaptureUpload>

function makeFile(size: number): File {
  const file = new File([new Uint8Array(8)], 'talk.m4a', { type: 'audio/mp4' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('useCapture upload bytes', () => {
  beforeEach(() => {
    resetTestAuth()
    setTestAuth({ userId: 'user-1', ready: true })
  })

  test('counts from zero once the file starts uploading and clears when the upload ends', async () => {
    let options: CaptureUploadOptions | undefined
    let finish: () => void = () => {}
    runCaptureUploadMock.mockImplementation((_file, _title, _terms, opts) => {
      options = opts
      return new Promise((resolve) => {
        finish = () => resolve({ kind: 'success', transcriptId: 't1', outcome: 'started' })
      })
    })
    const { result } = renderHook(() => useCapture())

    let pending: Promise<unknown> = Promise.resolve()
    act(() => {
      pending = result.current.upload(makeFile(200), 'Talk', [])
    })
    expect(result.current.uploadBytes).toBeNull()

    act(() => options?.onProgress?.('uploading'))
    expect(result.current.uploadBytes).toEqual({ sent: 0, total: 200 })

    act(() => options?.onUploadBytes?.(120, 200))
    expect(result.current.uploadBytes).toEqual({ sent: 120, total: 200 })

    act(() => options?.onProgress?.('starting'))
    expect(result.current.uploadBytes).toEqual({ sent: 120, total: 200 })

    await act(async () => {
      finish()
      await pending
    })
    expect(result.current.uploadBytes).toBeNull()
  })

  test('clears the count when the upload fails', async () => {
    runCaptureUploadMock.mockImplementation(async (_file, _title, _terms, opts) => {
      opts?.onProgress?.('uploading')
      opts?.onUploadBytes?.(50, 200)
      return { kind: 'failure', message: 'Upload failed: network died' } as never
    })
    const { result } = renderHook(() => useCapture())

    await act(async () => {
      await result.current.upload(makeFile(200), 'Talk', [])
    })

    expect(result.current.uploadBytes).toBeNull()
    expect(result.current.error).toBe('Upload failed: network died')
  })
})
