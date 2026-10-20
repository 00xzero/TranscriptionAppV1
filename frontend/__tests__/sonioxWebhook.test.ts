/** @jest-environment node */

const mockSend = jest.fn(async () => ({ ids: ['evt'] }))
jest.mock('@/infra/inngest/client', () => ({
  sendInngestEvent: (...a: unknown[]) => mockSend(...(a as [])),
}))

import { NextRequest } from 'next/server'
import { POST } from '../app/api/webhooks/soniox/route'

const transcriptId = '11111111-1111-4111-8111-111111111111'
const jobId = '33333333-3333-4333-8333-333333333333'
const ENV = { ...process.env }

function callback(opts: { auth?: string | null; query?: string; body?: unknown } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  const auth = opts.auth === undefined ? 'Bearer test-secret' : opts.auth
  if (auth !== null) headers.set('Authorization', auth)
  return new NextRequest(
    `https://app.test/api/webhooks/soniox?${opts.query ?? `transcript_id=${transcriptId}&job_id=${jobId}`}`,
    {
      method: 'POST',
      headers,
      body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? { id: 'soniox-job-1', status: 'completed' }),
    }
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ENV, SONIOX_WEBHOOK_SECRET: 'test-secret' }
})

afterAll(() => {
  process.env = ENV
})

describe('Soniox webhook route', () => {
  test('passes a good callback on, named for its job and status so a redelivery collapses', async () => {
    const res = await POST(callback())

    expect(res.status).toBe(200)
    expect(mockSend).toHaveBeenCalledWith({
      name: 'soniox/callback',
      id: 'soniox-callback:soniox-job-1:completed',
      data: { transcriptId, jobId, requestId: 'soniox-job-1', status: 'completed' },
    })
  })

  test.each([
    ['missing', null],
    ['wrong', 'Bearer not-the-secret'],
    ['unprefixed', 'test-secret'],
  ])('refuses a %s secret', async (_label, auth) => {
    const res = await POST(callback({ auth }))
    expect(res.status).toBe(401)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('without its own secret configured it refuses everything', async () => {
    delete process.env.SONIOX_WEBHOOK_SECRET
    expect((await POST(callback())).status).toBe(500)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test.each([
    ['a body that is not JSON', { body: 'not json' }],
    ['an unknown status', { body: { id: 'soniox-job-1', status: 'processing' } }],
    ['no job id in the address', { query: `transcript_id=${transcriptId}` }],
    ['a transcript id that is not one', { query: `transcript_id=nope&job_id=${jobId}` }],
  ])('answers 400 to %s, since a retry cannot fix it', async (_label, opts) => {
    expect((await POST(callback(opts))).status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('answers 500 when the callback cannot be passed on, so Soniox retries', async () => {
    mockSend.mockRejectedValueOnce(new Error('inngest down'))
    expect((await POST(callback())).status).toBe(500)
  })
})
