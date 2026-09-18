import { act, renderHook, waitFor } from '@testing-library/react'

const useProjectsDataMock = jest.fn()

jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useProjectsData: () => useProjectsDataMock(),
}))

import { useProjectsLoadState } from '@/lib/projects/useProjectsLoadState'
import { RealtimeScopeAbortError } from '@/lib/supabase/realtime'

function projectsData(
  refetchProjects: () => Promise<void>,
  refetchTranscripts: () => Promise<void>
) {
  return {
    projectsLoading: false,
    transcriptsLoading: false,
    projectError: null,
    transcriptError: null,
    refetchProjects,
    refetchTranscripts,
  }
}

describe('useProjectsLoadState', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('logs a non-cancellation retry failure', async () => {
    const error = new Error('retry unavailable')
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    useProjectsDataMock.mockReturnValue(projectsData(
      jest.fn().mockResolvedValue(undefined),
      jest.fn().mockRejectedValue(error)
    ))
    const { result } = renderHook(() => useProjectsLoadState())

    act(() => result.current.retry())

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        '[projects] Failed to retry project data loading:',
        error
      )
    })
    consoleError.mockRestore()
  })

  test('keeps scope cancellation silent', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    useProjectsDataMock.mockReturnValue(projectsData(
      jest.fn().mockRejectedValue(new RealtimeScopeAbortError()),
      jest.fn().mockResolvedValue(undefined)
    ))
    const { result } = renderHook(() => useProjectsLoadState())

    act(() => result.current.retry())
    await act(async () => {
      await Promise.resolve()
    })

    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
