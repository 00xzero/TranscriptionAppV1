import { authDiagnostics } from '@/lib/auth/diagnostics'

afterEach(() => jest.restoreAllMocks())

test('logs only recognized error metadata, never messages, payloads or arbitrary codes', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  const diagnose = authDiagnostics('password')
  const secret = 'private@example.com/password/token?secret=123'
  diagnose('failed', Object.assign(new Error(secret), {
    status: 503, code: secret, accessToken: secret, rawData: { email: secret }, cause: new Error(secret),
  }))
  diagnose('failed', { code: '42501', message: secret })

  expect(JSON.stringify(warn.mock.calls)).not.toContain(secret)
  expect(JSON.parse(warn.mock.calls[0][1])).toMatchObject({ category: 'upstream', status: 503 })
  expect(JSON.parse(warn.mock.calls[0][1])).not.toHaveProperty('code')
  expect(JSON.parse(warn.mock.calls[1][1])).toMatchObject({ category: 'permission', code: '42501' })
})

test('keeps one correlation id through first failure, exhausted retries and recovery without flooding logs', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  const info = jest.spyOn(console, 'info').mockImplementation(() => {})
  const diagnose = authDiagnostics('identity', 6)
  diagnose('recovered')
  expect(info).not.toHaveBeenCalled()
  for (let i = 0; i < 9; i++) diagnose('failed', { code: 'ECONNRESET' }, { stage: 'lookup' })
  diagnose('recovered')

  expect(warn).toHaveBeenCalledTimes(2)
  expect(info).toHaveBeenCalledTimes(1)
  const records = [...warn.mock.calls, ...info.mock.calls].map((call) => JSON.parse(call[1]))
  expect(records.map(({ event, attempt }) => [event, attempt])).toEqual([
    ['auth.identity.failed', 1], ['auth.identity.exhausted', 6], ['auth.identity.recovered', 9],
  ])
  expect(new Set(records.map((record) => record.correlation_id)).size).toBe(1)
})
