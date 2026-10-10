import { fetchExportData } from '../../lib/supabase/export-data'
import { paginateAllRows } from '../../lib/supabase/queries'

jest.mock('../../lib/supabase/queries', () => ({
  paginateAllRows: jest.fn(),
}))

const mockPaginateAllRows = paginateAllRows as jest.MockedFunction<typeof paginateAllRows>

const makeTranscriptQuery = jest.fn((transcript: unknown, error: unknown = null) => ({
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: transcript, error }),
}))

const speakersSelect = jest.fn()
const makeSpeakersQuery = jest.fn((speakers: unknown[] | null, error: unknown = null) => ({
  select: speakersSelect.mockReturnThis(),
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

  it('reads linked people and organisations in the speakers query', async () => {
    mockPaginateAllRows.mockResolvedValueOnce([
      { id: 'seg1', speaker_id: 'sp1', start_ms: 0, end_ms: 1000, text: 'First' },
      { id: 'seg2', speaker_id: 'sp2', start_ms: 1000, end_ms: 2000, text: 'Second' },
    ] as any)
    const alex = { id: 'p1', name: 'Alex', organisation: { name: 'Example Org' } }
    const from = jest.fn((table: string) => {
      if (table === 'transcripts') return makeTranscriptQuery({ id: 't1', title: 'Review' })
      if (table === 'speakers') return makeSpeakersQuery([
        { id: 'sp1', ordinal: 0, custom_label: null, person_id: 'p1', person: alex },
        { id: 'sp2', ordinal: 1, custom_label: null, person_id: 'p1', person: alex },
      ])
      throw new Error(table)
    })
    const result = await fetchExportData({ auth: { getUser: jest.fn().mockResolvedValue({
      data: { user: { id: 'u1' } }, error: null,
    }) }, from } as any, 't1')
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(from).toHaveBeenCalledTimes(2)
    expect(result.data.speakers.participants).toEqual(['Alex — Example Org'])
    expect(result.data.speakers.identityKeys.get('sp1')).toBe(result.data.speakers.identityKeys.get('sp2'))
    expect(result.data.speakers.labels.get('sp2')).toBe('Alex')
  })

  it('reads from segments, preserves order, and resolves speaker labels', async () => {
    const transcript = {
      id: 'p1',
      title: 'Transcript',
      created_at: '2024-01-01T00:00:00Z',
      duration_seconds: 42,
    }
    const segments = [
      { id: 's1', speaker_id: 'sp2', start_ms: 1000, end_ms: 2000, text: 'Second' },
      { id: 's2', speaker_id: 'sp1', start_ms: 3000, end_ms: 4000, text: 'Third' },
      { id: 's3', speaker_id: 'sp3', start_ms: 5000, end_ms: 6000, text: 'Fourth' },
      { id: 's4', speaker_id: null, start_ms: 7000, end_ms: 8000, text: 'Fifth' },
    ]
    // sp3 shares sp1's label and appears later, so it is the one numbered.
    const speakers = [
      { id: 'sp1', ordinal: 0, custom_label: 'Alice', person_id: null, person: null },
      { id: 'sp2', ordinal: 1, custom_label: null, person_id: null, person: null },
      { id: 'sp3', ordinal: 2, custom_label: 'Alice', person_id: null, person: null },
    ]

    mockPaginateAllRows.mockResolvedValueOnce(segments as any)

    const from = jest.fn((table: string) => {
      if (table === 'transcripts') return makeTranscriptQuery(transcript)
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

    expect(from).toHaveBeenCalledWith('transcripts')
    expect(from).toHaveBeenCalledWith('speakers')
    expect(from).not.toHaveBeenCalledWith('chunks')
    expect(mockPaginateAllRows).toHaveBeenCalledWith(supabase, 'segments', 'p1', 'start_ms')

    expect(speakersSelect).toHaveBeenCalledWith(expect.stringContaining('person:people!speakers_person_owner_fk('))
    expect(result.data.exportSegments).toEqual([
      { speaker_id: 'sp2', start_ms: 1000, end_ms: 2000, text: 'Second' },
      { speaker_id: 'sp1', start_ms: 3000, end_ms: 4000, text: 'Third' },
      { speaker_id: 'sp3', start_ms: 5000, end_ms: 6000, text: 'Fourth' },
      { speaker_id: null, start_ms: 7000, end_ms: 8000, text: 'Fifth' },
    ])
    expect(Object.fromEntries(result.data.speakers.labels)).toEqual({
      sp1: 'Alice',
      sp2: 'Speaker 1',
      sp3: 'Alice (2)',
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
    expect(makeTranscriptQuery).not.toHaveBeenCalled()
    expect(makeSpeakersQuery).not.toHaveBeenCalled()
  })

  it('returns not found when the transcript query returns no rows', async () => {
    const from = jest.fn((table: string) => {
      if (table === 'transcripts') return makeTranscriptQuery(null)
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
      error: { error: 'Transcript not found', status: 404 },
    })
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('transcripts')
    expect(mockPaginateAllRows).not.toHaveBeenCalled()
    expect(makeTranscriptQuery).toHaveBeenCalledWith(null)
    expect(makeSpeakersQuery).not.toHaveBeenCalled()
  })

  it('returns a transcript fetch error when segment pagination rejects', async () => {
    const transcript = {
      id: 'p1',
      title: 'Transcript',
      created_at: '2024-01-01T00:00:00Z',
      duration_seconds: 42,
    }

    mockPaginateAllRows.mockRejectedValueOnce(new Error('segments failed'))

    const from = jest.fn((table: string) => {
      if (table === 'transcripts') return makeTranscriptQuery(transcript)
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
    expect(from).toHaveBeenCalledWith('transcripts')
    expect(from).not.toHaveBeenCalledWith('speakers')
    expect(mockPaginateAllRows).toHaveBeenCalledWith(supabase, 'segments', 'p1', 'start_ms')
    expect(makeTranscriptQuery).toHaveBeenCalledWith(transcript)
    expect(makeSpeakersQuery).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error fetching segments:',
      expect.any(Error)
    )
  })

  it('returns a speaker fetch error when the speakers query fails', async () => {
    const transcript = {
      id: 'p1',
      title: 'Transcript',
      created_at: '2024-01-01T00:00:00Z',
      duration_seconds: 42,
    }
    const speakersError = { message: 'speakers failed' }

    mockPaginateAllRows.mockResolvedValueOnce([])

    const from = jest.fn((table: string) => {
      if (table === 'transcripts') return makeTranscriptQuery(transcript)
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
    expect(from).toHaveBeenCalledWith('transcripts')
    expect(from).toHaveBeenCalledWith('speakers')
    expect(mockPaginateAllRows).toHaveBeenCalledWith(supabase, 'segments', 'p1', 'start_ms')
    expect(makeTranscriptQuery).toHaveBeenCalledWith(transcript)
    expect(makeSpeakersQuery).toHaveBeenCalledWith(null, speakersError)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error fetching speakers:',
      speakersError
    )
  })
})
