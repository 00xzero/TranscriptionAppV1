import { act, renderHook } from '@testing-library/react'
import { useCaptureForm } from '@/components/CaptureModal/useCaptureForm'
import { validateFile } from '@/lib/capture/upload'
import { makeProject, projectProviderData } from '../projects/fixtures'
import { DEFAULT_TRANSCRIPTION_OPTIONS, type TranscriptionOptions } from '@/contracts/transcription-options'
import { TRANSCRIPTION_PREFERENCES_KEY } from '@/lib/capture/transcriptionPreferences'

const pushMock = jest.fn()
const uploadMock = jest.fn()
const resetErrorMock = jest.fn()
const showCaptureWarningMock = jest.fn()
const mockUseProjectsData = jest.fn()

jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useProjectsData: () => mockUseProjectsData(),
}))

const loadedProjects = [
  makeProject({ id: 'project-1', name: 'Clients' }),
  makeProject({ id: 'project-2', name: 'Research' }),
  makeProject({ id: 'deleting', name: 'Old', deleting_at: '2026-09-15T00:00:00Z' }),
]

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

async function submitFile(intentProjectId?: string | null) {
  const closeCaptureModal = jest.fn()
  const file = new File(['audio'], 'sample.wav', { type: 'audio/wav' })
  const { result } = renderHook(() =>
    useCaptureForm({ isCaptureModalOpen: true, closeCaptureModal, intentProjectId })
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
    window.localStorage.clear()
    mockUseProjectsData.mockReturnValue(projectProviderData(loadedProjects))
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

    expect(uploadMock).toHaveBeenCalledWith(expect.any(File), 'sample', [], 'project-1', DEFAULT_TRANSCRIPTION_OPTIONS)
    expect(showCaptureWarningMock).toHaveBeenCalledTimes(1)
    expect(showCaptureWarningMock).toHaveBeenCalledWith('project_missing')
    expect(pushMock).not.toHaveBeenCalled()
  })

  test('prefills an over-long filename in full and blocks submit until it is shortened', async () => {
    const longName = 'z'.repeat(130)
    const file = new File(['audio'], `${longName}.wav`, { type: 'audio/wav' })
    const { result } = renderHook(() =>
      useCaptureForm({ isCaptureModalOpen: true, closeCaptureModal: jest.fn(), intentProjectId: null })
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
      useCaptureForm({ isCaptureModalOpen: true, closeCaptureModal: jest.fn(), intentProjectId: null })
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

    expect(uploadMock).toHaveBeenCalledWith(expect.any(File), '', [], null, DEFAULT_TRANSCRIPTION_OPTIONS)
  })

  describe('the title follows the file', () => {
    function renderForm() {
      return renderHook(() =>
        useCaptureForm({ isCaptureModalOpen: true, closeCaptureModal: jest.fn(), intentProjectId: null })
      )
    }
    const fileNamed = (name: string) => new File(['audio'], name, { type: 'audio/wav' })

    test('names the title after the picked file', () => {
      const { result } = renderForm()
      act(() => result.current.handleFileSelect(fileNamed('interview-a.wav')))
      expect(result.current.title).toBe('interview-a')
    })

    test('a new file replaces the title, even one the user edited', () => {
      const { result } = renderForm()
      act(() => result.current.handleFileSelect(fileNamed('interview-a.wav')))
      act(() => result.current.setTitle('Client call'))
      act(() => result.current.handleFileSelect(fileNamed('interview-b.wav')))
      expect(result.current.title).toBe('interview-b')
    })

    test('a file replaces a title typed before any file was picked', () => {
      const { result } = renderForm()
      act(() => result.current.setTitle('Client call'))
      act(() => result.current.handleFileSelect(fileNamed('interview-a.wav')))
      expect(result.current.title).toBe('interview-a')
    })

    test('a file that fails validation removes the previous file and its title', () => {
      const { result } = renderForm()
      act(() => result.current.handleFileSelect(fileNamed('interview-a.wav')))
      act(() => result.current.setTitle('Client call'))
      ;(validateFile as jest.Mock).mockReturnValueOnce('Unsupported file type.')
      act(() => result.current.handleFileSelect(fileNamed('notes.txt')))
      expect(result.current.selectedFile).toBeNull()
      expect(result.current.title).toBe('')
      expect(result.current.displayError).toBe('Unsupported file type.')
    })
  })

  describe('project destination', () => {
    const sample = () => new File(['audio'], 'sample.wav', { type: 'audio/wav' })

    function renderForm(intentProjectId: string | null) {
      return renderHook(
        ({ open }: { open: boolean }) =>
          useCaptureForm({ isCaptureModalOpen: open, closeCaptureModal: jest.fn(), intentProjectId }),
        { initialProps: { open: true } }
      )
    }

    async function submit(result: ReturnType<typeof renderForm>['result']) {
      act(() => result.current.handleFileSelect(sample()))
      await act(async () => {
        await result.current.handleSubmit()
      })
    }

    beforeEach(() => {
      uploadMock.mockResolvedValue({ outcome: 'started', transcriptId: 'transcript-1' })
    })

    test('starts on the project the dialog was opened from', () => {
      const { result } = renderForm('project-1')
      expect(result.current.projectId).toBe('project-1')
    })

    test('uploads into a picked project rather than the intent', async () => {
      const { result } = renderForm('project-1')
      act(() => result.current.setProjectId('project-2'))
      await submit(result)
      expect(uploadMock).toHaveBeenCalledWith(expect.any(File), 'sample', [], 'project-2', DEFAULT_TRANSCRIPTION_OPTIONS)
    })

    test('picking Unfiled over an intent project uploads with no project', async () => {
      const { result } = renderForm('project-1')
      act(() => result.current.setProjectId(null))
      expect(result.current.projectId).toBeNull()
      await submit(result)
      expect(uploadMock).toHaveBeenCalledWith(expect.any(File), 'sample', [], null, DEFAULT_TRANSCRIPTION_OPTIONS)
    })

    test('falls back to Unfiled when the project is being deleted', () => {
      const { result } = renderForm('deleting')
      expect(result.current.projectId).toBeNull()
    })

    test('falls back to Unfiled when a loaded tree no longer has the project', () => {
      const { result } = renderForm('project-1')
      act(() => result.current.setProjectId('project-2'))
      mockUseProjectsData.mockReturnValue(projectProviderData(loadedProjects.filter((p) => p.id !== 'project-2')))
      act(() => result.current.setTitle('rerender'))
      expect(result.current.projectId).toBeNull()
    })

    test('keeps the choice while projects are still loading', () => {
      mockUseProjectsData.mockReturnValue({ ...projectProviderData([]), projectsLoading: true })
      const { result } = renderForm('project-1')
      expect(result.current.projectId).toBe('project-1')
    })

    test('keeps the choice when projects failed to load', () => {
      mockUseProjectsData.mockReturnValue({ ...projectProviderData([]), projectError: new Error('offline') })
      const { result } = renderForm('project-1')
      expect(result.current.projectId).toBe('project-1')
    })

    test('forgets the pick when the dialog closes', () => {
      const { result, rerender } = renderForm('project-1')
      act(() => result.current.setProjectId('project-2'))
      rerender({ open: false })
      rerender({ open: true })
      expect(result.current.projectId).toBe('project-1')
    })
  })

  describe('clearing the file', () => {
    function renderForm() {
      return renderHook(() =>
        useCaptureForm({ isCaptureModalOpen: true, closeCaptureModal: jest.fn(), intentProjectId: null })
      )
    }
    const fileNamed = (name: string) => new File(['audio'], name, { type: 'audio/wav' })

    test('clears the file and its title', () => {
      const { result } = renderForm()
      act(() => result.current.handleFileSelect(fileNamed('interview-a.wav')))
      act(() => result.current.clearFile())
      expect(result.current.selectedFile).toBeNull()
      expect(result.current.title).toBe('')
      expect(result.current.canSubmit).toBe(false)
    })

    test('clears the title even after the user edited it', () => {
      const { result } = renderForm()
      act(() => result.current.handleFileSelect(fileNamed('interview-a.wav')))
      act(() => result.current.setTitle('Client call'))
      act(() => result.current.clearFile())
      expect(result.current.title).toBe('')
    })

    test('fills the title from the next file after clearing', () => {
      const { result } = renderForm()
      act(() => result.current.handleFileSelect(fileNamed('interview-a.wav')))
      act(() => result.current.clearFile())
      act(() => result.current.handleFileSelect(fileNamed('interview-b.wav')))
      expect(result.current.title).toBe('interview-b')
    })

    test('clears file and upload errors', () => {
      ;(validateFile as jest.Mock).mockReturnValueOnce('Unsupported file type.')
      const { result } = renderForm()
      act(() => result.current.handleFileSelect(fileNamed('notes.txt')))
      expect(result.current.displayError).toBe('Unsupported file type.')
      act(() => result.current.clearFile())
      expect(result.current.displayError).toBeNull()
      expect(resetErrorMock).toHaveBeenCalled()
    })

    test('drops a blocked over-long title, so the next long filename is not flagged before submit', async () => {
      const longName = 'z'.repeat(130)
      const { result } = renderForm()
      act(() => result.current.handleFileSelect(fileNamed(`${longName}.wav`)))
      await act(async () => {
        await result.current.handleSubmit()
      })
      expect(result.current.titleError).not.toBeNull()

      act(() => result.current.clearFile())
      expect(result.current.titleError).toBeNull()
      act(() => result.current.handleFileSelect(fileNamed(`${'y'.repeat(130)}.wav`)))
      expect(result.current.titleError).toBeNull()
    })

    test('a new long filename is not flagged before submit after a blocked one', async () => {
      const { result } = renderForm()
      act(() => result.current.handleFileSelect(fileNamed(`${'z'.repeat(130)}.wav`)))
      await act(async () => {
        await result.current.handleSubmit()
      })
      expect(result.current.titleError).not.toBeNull()

      act(() => result.current.handleFileSelect(fileNamed(`${'y'.repeat(130)}.wav`)))
      expect(result.current.titleError).toBeNull()
    })
  })

  describe('transcription options', () => {
    const chosen: TranscriptionOptions = { language: 'es', detect_speakers: false, keep_filler_words: true, mask_profanity: true }
    const stored = () => JSON.parse(window.localStorage.getItem(TRANSCRIPTION_PREFERENCES_KEY) ?? 'null')
    const sample = () => new File(['audio'], 'sample.wav', { type: 'audio/wav' })

    function renderForm() {
      return renderHook(
        ({ open }: { open: boolean }) =>
          useCaptureForm({ isCaptureModalOpen: open, closeCaptureModal: jest.fn(), intentProjectId: null }),
        { initialProps: { open: true } }
      )
    }

    async function submit(result: ReturnType<typeof renderForm>['result']) {
      act(() => result.current.handleFileSelect(sample()))
      await act(async () => {
        await result.current.handleSubmit()
      })
    }

    test('start from the defaults when nothing was saved, or what was saved is unreadable', () => {
      expect(renderForm().result.current.transcriptionOptions).toEqual(DEFAULT_TRANSCRIPTION_OPTIONS)
      window.localStorage.setItem(TRANSCRIPTION_PREFERENCES_KEY, '{"language":"klingon"}')
      expect(renderForm().result.current.transcriptionOptions).toEqual(DEFAULT_TRANSCRIPTION_OPTIONS)
    })

    test('start from the options last saved', () => {
      window.localStorage.setItem(TRANSCRIPTION_PREFERENCES_KEY, JSON.stringify(chosen))
      expect(renderForm().result.current.transcriptionOptions).toEqual(chosen)
    })

    test('an upload sends them and saves them for next time', async () => {
      uploadMock.mockResolvedValue({ outcome: 'started', transcriptId: 'transcript-1' })
      const { result } = renderForm()
      act(() => result.current.setTranscriptionOptions(chosen))
      await submit(result)

      expect(uploadMock).toHaveBeenCalledWith(expect.any(File), 'sample', [], null, chosen)
      expect(stored()).toEqual(chosen)
    })

    test('an upload that creates no transcript saves nothing', async () => {
      uploadMock.mockResolvedValue(null)
      const { result } = renderForm()
      act(() => result.current.setTranscriptionOptions(chosen))
      await submit(result)

      expect(stored()).toBeNull()
    })

    test('opening reads what another tab saved while this dialog was closed', () => {
      const { result, rerender } = renderForm()
      rerender({ open: false })
      window.localStorage.setItem(TRANSCRIPTION_PREFERENCES_KEY, JSON.stringify(chosen))
      rerender({ open: true })

      expect(result.current.transcriptionOptions).toEqual(chosen)
    })

    test('closing without beginning drops the change', () => {
      const { result, rerender } = renderForm()
      act(() => result.current.setTranscriptionOptions(chosen))
      rerender({ open: false })
      rerender({ open: true })

      expect(result.current.transcriptionOptions).toEqual(DEFAULT_TRANSCRIPTION_OPTIONS)
      expect(stored()).toBeNull()
    })
  })
})
