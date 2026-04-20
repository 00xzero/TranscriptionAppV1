import { fetchExportData } from '../../core/exports/data'
import { paginateAllRows } from '../../lib/supabase/queries'

jest.mock('../../lib/supabase/queries', () => ({
  paginateAllRows: jest.fn(),
}))

const mockPaginateAllRows = paginateAllRows as jest.MockedFunction<typeof paginateAllRows>

const makeProjectQuery = jest.fn((project: unknown, error: unknown = null) => ({
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: project, error }),
}))

const makeSpeakersQuery = jest.fn((speakers: unknown[] | null, error: unknown = null) => ({
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockResolvedValue({ data: speakers, error }),
}))

describe('fetchExportData', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('reads from segments, preserves order, and maps to export chunks', async () => {
    const project = {
      id: 'p1',
      title: 'Transcript',
      created_at: '2024-01-01T00:00:00Z',
      duration_seconds: 42,
    }
    const segments = [
      { id: 's1', speaker_id: 'sp2', start_ms: 1000, end_ms: 2000, text: 'Second' },
      { id: 's2', speaker_id: 'sp1', start_ms: 3000, end_ms: 4000, text: 'Third' },
    ]
    const speakers = [
      { id: 'sp1', label: 'Alice', color: '#111111' },
      { id: 'sp2', label: 'Bob', color: '#222222' },
    ]

    mockPaginateAllRows.mockResolvedValueOnce(segments as any)

    const from = jest.fn((table: string) => {
      if (table === 'projects') return makeProjectQuery(project)
      if (table === 'speakers') return makeSpeakersQuery(speakers)
      throw new Error(`Unexpected table ${table}`)
    })

    const supabase = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from,
    }

    const result = await fetchExportData(supabase as any, 'p1')

    expect(result.success).toBe(true)
    if (!result.success) {
      throw new Error('Expected success result')
    }

    expect(from).toHaveBeenCalledWith('projects')
    expect(from).toHaveBeenCalledWith('speakers')
    expect(from).not.toHaveBeenCalledWith('chunks')
    expect(mockPaginateAllRows).toHaveBeenCalledWith(supabase, 'segments', 'p1', 'start_ms')

    expect(result.data.exportChunks).toEqual([
      { speaker_id: 'sp2', start_ms: 1000, end_ms: 2000, text: 'Second' },
      { speaker_id: 'sp1', start_ms: 3000, end_ms: 4000, text: 'Third' },
    ])
    expect(result.data.speakersMap).toEqual({
      sp1: { label: 'Alice', color: '#111111' },
      sp2: { label: 'Bob', color: '#222222' },
    })
  })

  it('returns unauthorized when auth lookup fails', async () => {
    const from = jest.fn()
    const supabase = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'token expired' },
        }),
      },
      from,
    }

    const result = await fetchExportData(supabase as any, 'p1')

    expect(result).toEqual({
      success: false,
      error: { error: 'Unauthorized', status: 401 },
    })
    expect(supabase.auth.getUser).toHaveBeenCalledTimes(1)
    expect(from).not.toHaveBeenCalled()
    expect(mockPaginateAllRows).not.toHaveBeenCalled()
    expect(makeProjectQuery).not.toHaveBeenCalled()
    expect(makeSpeakersQuery).not.toHaveBeenCalled()
  })

  it('returns not found when the project query returns no rows', async () => {
    const from = jest.fn((table: string) => {
      if (table === 'projects') return makeProjectQuery(null)
      throw new Error(`Unexpected table ${table}`)
    })

    const supabase = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from,
    }

    const result = await fetchExportData(supabase as any, 'p1')

    expect(result).toEqual({
      success: false,
      error: { error: 'Project not found', status: 404 },
    })
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('projects')
    expect(mockPaginateAllRows).not.toHaveBeenCalled()
    expect(makeProjectQuery).toHaveBeenCalledWith(null)
    expect(makeSpeakersQuery).not.toHaveBeenCalled()
  })

  it('returns a transcript fetch error when segment pagination rejects', async () => {
    const project = {
      id: 'p1',
      title: 'Transcript',
      created_at: '2024-01-01T00:00:00Z',
      duration_seconds: 42,
    }

    mockPaginateAllRows.mockRejectedValueOnce(new Error('segments failed'))

    const from = jest.fn((table: string) => {
      if (table === 'projects') return makeProjectQuery(project)
      throw new Error(`Unexpected table ${table}`)
    })

    const supabase = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from,
    }

    const result = await fetchExportData(supabase as any, 'p1')

    expect(result).toEqual({
      success: false,
      error: { error: 'Failed to fetch transcript data', status: 500 },
    })
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('projects')
    expect(from).not.toHaveBeenCalledWith('speakers')
    expect(mockPaginateAllRows).toHaveBeenCalledWith(supabase, 'segments', 'p1', 'start_ms')
    expect(makeProjectQuery).toHaveBeenCalledWith(project)
    expect(makeSpeakersQuery).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error fetching segments:',
      expect.any(Error)
    )
  })

  it('returns a speaker fetch error when the speakers query fails', async () => {
    const project = {
      id: 'p1',
      title: 'Transcript',
      created_at: '2024-01-01T00:00:00Z',
      duration_seconds: 42,
    }
    const speakersError = { message: 'speakers failed' }

    mockPaginateAllRows.mockResolvedValueOnce([])

    const from = jest.fn((table: string) => {
      if (table === 'projects') return makeProjectQuery(project)
      if (table === 'speakers') return makeSpeakersQuery(null, speakersError)
      throw new Error(`Unexpected table ${table}`)
    })

    const supabase = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from,
    }

    const result = await fetchExportData(supabase as any, 'p1')

    expect(result).toEqual({
      success: false,
      error: { error: 'Failed to fetch speaker data', status: 500 },
    })
    expect(from).toHaveBeenCalledTimes(2)
    expect(from).toHaveBeenCalledWith('projects')
    expect(from).toHaveBeenCalledWith('speakers')
    expect(mockPaginateAllRows).toHaveBeenCalledWith(supabase, 'segments', 'p1', 'start_ms')
    expect(makeProjectQuery).toHaveBeenCalledWith(project)
    expect(makeSpeakersQuery).toHaveBeenCalledWith(null, speakersError)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error fetching speakers:',
      speakersError
    )
  })
})
