/** @jest-environment node */

import React from 'react'
import { JSDOM } from 'jsdom'
import { AuthProvider, useAuth } from '@/lib/auth/AuthProvider'
import { createClient } from '@/infra/supabase/client'
import { accessTokenSubject, notifyAccountChanged } from '@/infra/workos/access-token'
import { useSupabaseRealtime } from '@/lib/supabase/realtime'
import {
  accessTokenFor,
  mockGetAccessToken,
  mockRefreshAuth,
  resetAuthKitState,
  setAuthKitState,
  workosUser,
} from '@/__mocks__/workos-authkit-nextjs-components'

// Real AuthProvider, application client, subscription hook and installed
// Supabase/Phoenix SDK. Only HTTP and the websocket server are simulated.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000' })
Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement })
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
const { act, cleanup, renderHook, waitFor } = require('@testing-library/react/pure') as typeof import('@testing-library/react/pure')

const USER_A = '00000000-0000-4000-8000-00000000000a'
const USER_B = '00000000-0000-4000-8000-00000000000b'
type Row = { id: string; title: string; user_id: string }
type Filter = { id: number; event: string; schema: string; table: string; filter?: string }
type Membership = { joinRef: string; subject: string | null; filters: Filter[] }
const joins: Array<{ topic: string; subject: string | null }> = []

class RealtimeServer {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static sockets: RealtimeServer[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  memberships = new Map<string, Membership>()

  constructor() {
    RealtimeServer.sockets.push(this)
    queueMicrotask(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.onopen?.()
    })
  }

  receive(joinRef: string | null, ref: string | null, topic: string, event: string, payload: unknown) {
    this.onmessage?.({ data: JSON.stringify([joinRef, ref, topic, event, payload]) })
  }

  send(encoded: string) {
    const [joinRef, ref, topic, event, payload] = JSON.parse(encoded)
    let response = {}
    if (event === 'phx_join') {
      const subject = accessTokenSubject(payload.access_token ?? '')
      const filters = (payload.config.postgres_changes ?? []).map((filter: Filter, index: number) => ({ ...filter, id: index + 1 }))
      joins.push({ topic, subject })
      this.memberships.set(topic, { joinRef, subject, filters })
      response = { postgres_changes: filters }
    } else if (event === 'phx_leave') {
      this.memberships.delete(topic)
    } else if (event === 'access_token') {
      const membership = this.memberships.get(topic)
      if (membership) membership.subject = accessTokenSubject(payload.access_token ?? '')
    }
    queueMicrotask(() => this.receive(joinRef, ref, topic, 'phx_reply', { status: 'ok', response }))
  }

  insert(row: Row, subject: string) {
    for (const [topic, membership] of this.memberships) {
      // Server authorization uses the token actually sent, never the SDK's
      // subsequently updated accessTokenValue or mutable join payload.
      if (membership.subject !== subject) continue
      const filters = membership.filters.filter(filter => filter.table === 'transcripts' && filter.filter === `user_id=eq.${row.user_id}`)
      if (!filters.length) continue
      this.receive(membership.joinRef, null, topic, 'postgres_changes', {
        ids: filters.map(filter => filter.id),
        data: { schema: 'public', table: 'transcripts', type: 'INSERT', columns: [], record: row, old_record: {}, errors: null, commit_timestamp: new Date().toISOString() },
      })
    }
  }

  close() {
    this.readyState = 3
    this.memberships.clear()
    queueMicrotask(() => this.onclose?.())
  }
}

const emptyRows = async (): Promise<Row[]> => []
const originalWebSocket = global.WebSocket
const originalFetch = global.fetch

beforeAll(() => {
  Object.defineProperty(global, 'WebSocket', { configurable: true, writable: true, value: RealtimeServer })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  global.fetch = jest.fn(async (_input, init) => {
    const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '') ?? ''
    return new Response(JSON.stringify(accessTokenSubject(token) === 'user_A' ? USER_A : USER_B), {
      headers: { 'Content-Type': 'application/json' },
    })
  })
})

afterEach(async () => {
  cleanup()
  // The hook owns unsubscribe. Wait for it instead of issuing a second
  // leave on the same SDK channel while its first leave is still pending.
  await waitFor(() => expect(createClient().getChannels()).toHaveLength(0))
  await createClient().realtime.disconnect()
  resetAuthKitState()
})
afterAll(() => {
  global.WebSocket = originalWebSocket
  global.fetch = originalFetch
  dom.window.close()
})

test('account-switch joins use the new token and deliver the first live update without reconnecting', async () => {
  resetAuthKitState()
  setAuthKitState({ user: workosUser('user_A') })
  mockGetAccessToken.mockResolvedValue(accessTokenFor('user_A'))
  const { result } = renderHook(() => {
    const auth = useAuth()
    const live = useSupabaseRealtime<Row>('transcripts', emptyRows, {
      enabled: Boolean(auth.userId),
      realtimeFilter: `user_id=eq.${auth.userId}`,
      enablePollingFallback: false,
    })
    return { auth, live }
  }, { wrapper: AuthProvider })

  await waitFor(() => expect(result.current.live.connectionStatus).toBe('connected'))
  expect(joins[0].subject).toBe('user_A')
  const socketCount = RealtimeServer.sockets.length

  for (const [subject, userId] of [['user_B', USER_B], ['user_A', USER_A]]) {
    // Another tab changes the cookie; this tab still has the old SDK token.
    mockRefreshAuth.mockImplementation(async () => {
      mockGetAccessToken.mockResolvedValue(accessTokenFor(subject))
      setAuthKitState({ user: workosUser(subject) })
    })
    act(() => notifyAccountChanged())
    await waitFor(() => {
      expect(result.current.auth.userId).toBe(userId)
      expect(result.current.live.connectionStatus).toBe('connected')
    })
    await act(async () => {})

    const latestJoin = joins.filter(join => join.topic.includes(`user_id=eq.${userId}`)).at(-1)
    expect(latestJoin?.subject).toBe(subject)
    const row = { id: `first-${subject}`, title: `Private ${subject} update`, user_id: userId }
    act(() => RealtimeServer.sockets.forEach(socket => socket.insert(row, subject)))
    expect(result.current.live.data).toEqual([row])
    expect(RealtimeServer.sockets).toHaveLength(socketCount)
  }
})
