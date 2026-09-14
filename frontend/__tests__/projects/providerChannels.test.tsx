import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { ProjectsProvider, useProjectsData } from '@/lib/projects/ProjectsProvider'
import type { Project } from '@/contracts/db'

const mockGetSession = jest.fn()
const mockGetUser = jest.fn()
const mockOnAuthStateChange = jest.fn()
const mockChannel = jest.fn()
const mockRemoveChannel = jest.fn()
const mockFetchProjects = jest.fn()
const mockFetchTranscripts = jest.fn()
let authStateHandler:
  | ((event: string, session: { user: { id: string } } | null) => void)
  | null = null

jest.mock('@/lib/supabase/queries', () => ({
  fetchProjects: () => mockFetchProjects(),
  fetchTranscripts: () => mockFetchTranscripts(),
  createProject: jest.fn(),
  renameProject: jest.fn(),
  moveTranscriptToProject: jest.fn(),
  addTranscriptsToProject: jest.fn(),
  deleteTranscript: jest.fn(),
  fetchTranscriptById: jest.fn(),
  fetchTranscriptJobs: jest.fn(),
  fetchSpeakers: jest.fn(),
  updateTranscript: jest.fn(),
  createSpeaker: jest.fn(),
  updateSpeaker: jest.fn(),
  deleteSpeaker: jest.fn(),
}))

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      getUser: mockGetUser,
      onAuthStateChange: mockOnAuthStateChange,
    },
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  }),
}))

function Consumer() {
  const data = useProjectsData()
  return (
    <div>
      <span data-testid="projects-loading">{String(data.projectsLoading)}</span>
      <span data-testid="project-ids">{data.projects.map((project) => project.id).join(',')}</span>
    </div>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function project(id: string, userId: string): Project {
  return {
    id,
    user_id: userId,
    parent_id: null,
    name: id,
    deleting_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  }
}

describe('ProjectsProvider realtime ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchProjects.mockResolvedValue([])
    mockFetchTranscripts.mockResolvedValue([])
    authStateHandler = null
    mockOnAuthStateChange.mockImplementation((handler) => {
      authStateHandler = handler
      return {
        data: { subscription: { unsubscribe: jest.fn() } },
      }
    })
    mockChannel.mockImplementation(() => {
      let channel: { on: jest.Mock; subscribe: jest.Mock }
      channel = {
        on: jest.fn(() => channel),
        subscribe: jest.fn(() => channel),
      }
      return channel
    })
  })

  test('opens exactly one projects channel and one transcript channel for any consumer count', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-a' } } },
    })
    mockGetUser.mockReturnValue(new Promise(() => undefined))

    render(
      <ProjectsProvider>
        <Consumer />
        <Consumer />
      </ProjectsProvider>
    )

    await waitFor(() => expect(mockChannel).toHaveBeenCalledTimes(2))
    expect(mockGetSession).toHaveBeenCalledTimes(1)
    expect(mockGetUser).toHaveBeenCalledTimes(1)
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1)
    expect(mockChannel.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^projects-changes:user_id=eq\.user-a:/),
        expect.stringMatching(/^transcripts-changes:user_id=eq\.user-a:/),
      ])
    )
  })

  test('does not fetch or open channels while signed out', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })

    render(
      <ProjectsProvider>
        <Consumer />
      </ProjectsProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('projects-loading')).toHaveTextContent('false')
    })
    expect(mockGetUser).not.toHaveBeenCalled()
    expect(mockFetchProjects).not.toHaveBeenCalled()
    expect(mockFetchTranscripts).not.toHaveBeenCalled()
    expect(mockChannel).not.toHaveBeenCalled()
  })

  test('discards the previous account data immediately when identity changes', async () => {
    const nextProjects = deferred<Project[]>()
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-a' } } },
    })
    mockGetUser.mockReturnValue(new Promise(() => undefined))
    mockFetchProjects
      .mockResolvedValueOnce([project('project-a', 'user-a')])
      .mockReturnValueOnce(nextProjects.promise)

    render(
      <ProjectsProvider>
        <Consumer />
      </ProjectsProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('project-ids')).toHaveTextContent('project-a')
    })

    act(() => {
      authStateHandler?.('SIGNED_IN', { user: { id: 'user-b' } })
    })

    expect(screen.getByTestId('project-ids')).toBeEmptyDOMElement()
    expect(screen.getByTestId('projects-loading')).toHaveTextContent('true')

    await act(async () => {
      nextProjects.resolve([project('project-b', 'user-b')])
      await nextProjects.promise
    })

    await waitFor(() => {
      expect(screen.getByTestId('project-ids')).toHaveTextContent('project-b')
    })
    expect(screen.getByTestId('project-ids')).not.toHaveTextContent('project-a')
  })
})
