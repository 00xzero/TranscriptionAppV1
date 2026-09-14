const mockFrom = jest.fn()
const mockGetUser = jest.fn()
const mockRpc = jest.fn()

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
  }),
}))

const {
  addTranscriptsToProject,
  createProject,
  fetchProjectBranchTranscriptCount,
  fetchProjects,
  fetchTranscripts,
  moveTranscriptToProject,
  renameProject,
} = jest.requireActual<
  typeof import('@/lib/supabase/queries')
>('@/lib/supabase/queries')

function paginatedBuilder(pages: Array<Array<{ id: string }>>) {
  const builder: {
    select: jest.Mock
    order: jest.Mock
    range: jest.Mock
  } = {
    select: jest.fn(),
    order: jest.fn(),
    range: jest.fn(),
  }
  builder.select.mockReturnValue(builder)
  builder.order.mockReturnValue(builder)
  pages.forEach((page) => builder.range.mockResolvedValueOnce({ data: page, error: null }))
  return builder
}

describe('project list queries', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-a' } },
      error: null,
    })
  })

  test('fetchProjects paginates, de-duplicates overlaps, and uses deterministic ordering', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({ id: `project-${index}` }))
    const builder = paginatedBuilder([
      firstPage,
      [{ id: 'project-999' }, { id: 'project-1000' }],
    ])
    mockFrom.mockReturnValue(builder)

    const projects = await fetchProjects()

    expect(mockFrom).toHaveBeenCalledWith('projects')
    expect(builder.order).toHaveBeenNthCalledWith(1, 'name', { ascending: true })
    expect(builder.order).toHaveBeenNthCalledWith(2, 'id', { ascending: true })
    expect(builder.order).toHaveBeenNthCalledWith(3, 'name', { ascending: true })
    expect(builder.order).toHaveBeenNthCalledWith(4, 'id', { ascending: true })
    expect(builder.range.mock.calls).toEqual([[0, 999], [1000, 1999]])
    expect(projects).toHaveLength(1001)
  })

  test('fetchTranscripts paginates while preserving newest-first ordering', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({ id: `transcript-${index}` }))
    const builder = paginatedBuilder([firstPage, []])
    mockFrom.mockReturnValue(builder)

    const transcripts = await fetchTranscripts()

    expect(mockFrom).toHaveBeenCalledWith('transcripts')
    expect(builder.order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false })
    expect(builder.order).toHaveBeenNthCalledWith(2, 'id', { ascending: true })
    expect(builder.range.mock.calls).toEqual([[0, 999], [1000, 1999]])
    expect(transcripts).toHaveLength(1000)
  })

  test('creates and renames projects and returns the selected rows', async () => {
    const created = { id: 'project-new', user_id: 'user-a', parent_id: null, name: 'New' }
    const createBuilder: Record<string, jest.Mock> = {}
    createBuilder.insert = jest.fn(() => createBuilder)
    createBuilder.select = jest.fn(() => createBuilder)
    createBuilder.single = jest.fn().mockResolvedValue({ data: created, error: null })
    mockFrom.mockReturnValueOnce(createBuilder)

    await expect(createProject({ name: 'New', parent_id: null })).resolves.toBe(created)
    expect(createBuilder.insert).toHaveBeenCalledWith({
      name: 'New',
      parent_id: null,
      user_id: 'user-a',
    })

    const renamed = { ...created, name: 'Renamed' }
    const renameBuilder: Record<string, jest.Mock> = {}
    renameBuilder.update = jest.fn(() => renameBuilder)
    renameBuilder.eq = jest.fn(() => renameBuilder)
    renameBuilder.select = jest.fn(() => renameBuilder)
    renameBuilder.single = jest.fn().mockResolvedValue({ data: renamed, error: null })
    mockFrom.mockReturnValueOnce(renameBuilder)

    await expect(renameProject('project-new', 'Renamed')).resolves.toBe(renamed)
    expect(renameBuilder.update).toHaveBeenCalledWith({ name: 'Renamed' })
    expect(renameBuilder.eq).toHaveBeenCalledWith('id', 'project-new')
  })

  test('moves one transcript and adds many transcripts with one update each', async () => {
    const moveBuilder: Record<string, jest.Mock> = {}
    moveBuilder.update = jest.fn(() => moveBuilder)
    moveBuilder.eq = jest.fn(() => moveBuilder)
    moveBuilder.select = jest.fn(() => moveBuilder)
    moveBuilder.single = jest.fn().mockResolvedValue({
      data: { id: 'transcript-a' },
      error: null,
    })
    mockFrom.mockReturnValueOnce(moveBuilder)

    await expect(moveTranscriptToProject('transcript-a', null)).resolves.toBe('transcript-a')
    expect(moveBuilder.update).toHaveBeenCalledWith({ project_id: null })
    expect(moveBuilder.eq).toHaveBeenCalledWith('id', 'transcript-a')
    expect(moveBuilder.select).toHaveBeenCalledWith('id')

    const addBuilder: Record<string, jest.Mock> = {}
    addBuilder.update = jest.fn(() => addBuilder)
    addBuilder.in = jest.fn(() => addBuilder)
    addBuilder.select = jest.fn().mockResolvedValue({
      data: [{ id: 'transcript-b' }, { id: 'transcript-a' }],
      error: null,
    })
    mockFrom.mockReturnValueOnce(addBuilder)

    await expect(
      addTranscriptsToProject(
        ['transcript-a', 'transcript-b', 'transcript-a'],
        'project-a'
      )
    ).resolves.toEqual(['transcript-a', 'transcript-b'])
    expect(addBuilder.update).toHaveBeenCalledWith({ project_id: 'project-a' })
    expect(addBuilder.in).toHaveBeenCalledWith('id', ['transcript-a', 'transcript-b'])
    expect(addBuilder.select).toHaveBeenCalledWith('id')
  })

  test('rejects missing or partially updated transcript assignments', async () => {
    const moveBuilder: Record<string, jest.Mock> = {}
    moveBuilder.update = jest.fn(() => moveBuilder)
    moveBuilder.eq = jest.fn(() => moveBuilder)
    moveBuilder.select = jest.fn(() => moveBuilder)
    moveBuilder.single = jest.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockReturnValueOnce(moveBuilder)

    await expect(
      moveTranscriptToProject('missing-transcript', 'project-a')
    ).rejects.toThrow('no longer available')

    const addBuilder: Record<string, jest.Mock> = {}
    addBuilder.update = jest.fn(() => addBuilder)
    addBuilder.in = jest.fn(() => addBuilder)
    addBuilder.select = jest.fn().mockResolvedValue({
      data: [{ id: 'transcript-a' }],
      error: null,
    })
    mockFrom.mockReturnValueOnce(addBuilder)

    await expect(
      addTranscriptsToProject(['transcript-a', 'transcript-b'], 'project-a')
    ).rejects.toThrow('Some transcripts could not be added')
  })

  test('reads the recursive branch count RPC result', async () => {
    mockRpc.mockResolvedValueOnce({ data: 42, error: null })

    await expect(fetchProjectBranchTranscriptCount('project-a')).resolves.toBe(42)
    expect(mockRpc).toHaveBeenCalledWith('project_branch_transcript_count', {
      p_id: 'project-a',
    })
  })
})
