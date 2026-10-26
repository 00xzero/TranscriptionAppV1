/** @jest-environment node */

import React from 'react'
import { JSDOM } from 'jsdom'
import { AuthProvider, useAuth } from '@/lib/auth/AuthProvider'
import { useCapture } from '@/lib/capture/useCapture'
import { POST } from '@/app/api/transcripts/route'
import { withAuth } from '@workos-inc/authkit-nextjs'
import {
  accessTokenFor,
  mockGetAccessToken,
  mockRefreshAuth,
  resetAuthKitState,
  setAuthKitState,
  workosUser,
} from '@/__mocks__/workos-authkit-nextjs-components'
import { accessTokenSubject } from '@/infra/workos/access-token'
import { ACCOUNT_CHANGED_CODE, ACCOUNT_CHANGED_MESSAGE, EXPECTED_USER_HEADER } from '@/lib/auth/account-boundary'

// Keep Node's real Request/Response/fetch types for the real Supabase clients
// and route handler, with a DOM for the auth provider and capture hook.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000' })
Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement })
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
const { act, cleanup, renderHook, waitFor } = require('@testing-library/react/pure') as typeof import('@testing-library/react/pure')

const USER_A = '00000000-0000-4000-8000-00000000000a'
const USER_B = '00000000-0000-4000-8000-00000000000b'
const TRANSCRIPT = '00000000-0000-4000-8000-000000000010'
const userIdFor = (subject: string | null) => subject === 'user_A' ? USER_A : USER_B
let cookieSubject = 'user_A'
let switchAfterCreate = false
let switchDuringUpload = false
const inserts: Array<{ user_id: string }> = []
const storageSubjects: Array<string | null> = []
const startAccounts: Array<string | null> = []
const apiResponses: Response[] = []
const link = jest.fn()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input)
  const headers = new Headers(init?.headers)
  const subject = accessTokenSubject((headers.get('authorization') ?? '').replace(/^Bearer /, ''))
  if (url.includes('/rest/v1/rpc/current_user_id')) return json(userIdFor(subject))

  if (url === '/api/transcripts') {
    const response = await POST(new Request('http://localhost:3000/api/transcripts', init) as never)
    apiResponses.push(response.clone())
    if (response.ok && switchAfterCreate) {
      cookieSubject = 'user_B'
      mockGetAccessToken.mockResolvedValue(accessTokenFor('user_B'))
      setAuthKitState({ user: workosUser('user_B') })
    }
    return response
  }
  if (url.includes('/rest/v1/transcripts') && init?.method === 'POST') {
    const row = JSON.parse(String(init.body))
    inserts.push(row)
    return json({ ...row, id: TRANSCRIPT, status: 'created', created_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T00:00:00Z' })
  }
  if (url.includes('/storage/v1/object/media/')) {
    storageSubjects.push(subject)
    if (switchDuringUpload) {
      cookieSubject = 'user_B'
      mockGetAccessToken.mockResolvedValue(accessTokenFor('user_B'))
      setAuthKitState({ user: workosUser('user_B') })
    }
    return json({ Key: `media/${USER_A}/${TRANSCRIPT}/clip.wav`, Id: 'object-id' })
  }
  if (url.includes('/rest/v1/transcripts') && init?.method === 'PATCH') {
    link(subject)
    return json({ id: TRANSCRIPT })
  }
  if (url === `/api/transcripts/${TRANSCRIPT}/start`) {
    startAccounts.push(headers.get(EXPECTED_USER_HEADER))
    return json({ jobId: 'job-id' })
  }
  throw new Error(`Unexpected request: ${init?.method} ${url}`)
})

function mountCapture() {
  return renderHook(() => ({ auth: useAuth(), capture: useCapture() }), { wrapper: AuthProvider })
}

beforeEach(() => {
  jest.clearAllMocks()
  resetAuthKitState()
  cookieSubject = 'user_A'
  switchAfterCreate = false
  switchDuringUpload = false
  inserts.length = 0
  storageSubjects.length = 0
  startAccounts.length = 0
  apiResponses.length = 0
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
  process.env.SUPABASE_URL = 'http://localhost:54321'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  global.fetch = fetchMock
  setAuthKitState({ user: workosUser('user_A') })
  mockGetAccessToken.mockResolvedValue(accessTokenFor('user_A'))
  ;(withAuth as jest.Mock).mockImplementation(async () => ({ user: workosUser(cookieSubject), accessToken: accessTokenFor(cookieSubject) }))
  mockRefreshAuth.mockImplementation(async () => {
    mockGetAccessToken.mockResolvedValue(accessTokenFor(cookieSubject))
    setAuthKitState({ user: workosUser(cookieSubject) })
  })
})

afterEach(() => cleanup())
afterAll(() => dom.window.close())

test('tab still showing A with cached token A cannot create or upload under the shared cookie for B', async () => {
  const { result } = mountCapture()
  await waitFor(() => expect(result.current.auth.userId).toBe(USER_A))
  // Only the shared cookie changes in the second tab. This tab's AuthKit
  // user and cached, unexpired access token still belong to A.
  cookieSubject = 'user_B'
  expect(result.current.auth.userId).toBe(USER_A)
  expect(await mockGetAccessToken()).toBe(accessTokenFor('user_A'))

  await act(async () => {
    await result.current.capture.upload(new File(['audio'], 'clip.wav', { type: 'audio/wav' }), 'Private A title', [])
  })

  const createCall = fetchMock.mock.calls.find(([url]) => url === '/api/transcripts')!
  expect(new Headers(createCall[1]?.headers).get(EXPECTED_USER_HEADER)).toBe(USER_A)
  expect(apiResponses[0].status).toBe(409)
  expect(await apiResponses[0].json()).toMatchObject({ code: ACCOUNT_CHANGED_CODE })
  expect(inserts).toEqual([])
  expect(storageSubjects).toEqual([])
  expect(startAccounts).toEqual([])
  expect(result.current.capture.error).toBe(ACCOUNT_CHANGED_MESSAGE)
  await waitFor(() => expect(result.current.auth.userId).toBe(USER_B))
})

test('the unchanged account can create, upload, link and start using its own identity', async () => {
  const { result } = mountCapture()
  await waitFor(() => expect(result.current.auth.userId).toBe(USER_A))
  await act(async () => {
    const uploaded = await result.current.capture.upload(new File(['audio'], 'clip.wav', { type: 'audio/wav' }), 'A title', [])
    expect(uploaded?.outcome).toBe('started')
  })
  expect(inserts).toEqual([expect.objectContaining({ user_id: USER_A })])
  expect(storageSubjects).toEqual(['user_A'])
  expect(link).toHaveBeenCalledWith('user_A')
  expect(startAccounts).toEqual([USER_A])
})

test('switching to B after creation cannot upload A’s file with B’s token', async () => {
  switchAfterCreate = true
  const { result } = mountCapture()
  await waitFor(() => expect(result.current.auth.userId).toBe(USER_A))
  await act(async () => {
    await result.current.capture.upload(new File(['audio'], 'clip.wav', { type: 'audio/wav' }), 'A title', [])
  })
  expect(inserts).toEqual([expect.objectContaining({ user_id: USER_A })])
  expect(storageSubjects).toEqual([])
  expect(startAccounts).toEqual([])
  expect(result.current.capture.error).toBe(ACCOUNT_CHANGED_MESSAGE)
})

test('switching during the upload cannot link or start the original capture as B', async () => {
  switchDuringUpload = true
  const { result } = mountCapture()
  await waitFor(() => expect(result.current.auth.userId).toBe(USER_A))
  await act(async () => {
    await result.current.capture.upload(new File(['audio'], 'clip.wav', { type: 'audio/wav' }), 'A title', [])
  })
  expect(storageSubjects).toEqual(['user_A'])
  expect(link).not.toHaveBeenCalled()
  expect(startAccounts).toEqual([])
  expect(result.current.capture.error).toBe(ACCOUNT_CHANGED_MESSAGE)
})
