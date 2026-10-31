/**
 * Runs the installed AuthKit's `authkit()` (what proxy.ts calls) against a
 * local stand-in for WorkOS, and prints, for each way a session can fail,
 * whether AuthKit found a user and whether it deleted the session cookie.
 * proxy.ts tells a WorkOS outage from a sign-out by exactly that, so
 * __tests__/authkitOutageContract.test.ts checks it on every run.
 *
 *   node --import ./scripts/authkit-contract/register.mjs scripts/authkit-contract/outage-probe.mjs
 */
import http from 'node:http'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { sealData } from 'iron-session'

const PASSWORD = 'contract-cookie-password-at-least-32-chars'
let mode = { jwks: 'ok', refresh: 'ok' }

const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
const tokenExpiring = (exp) =>
  new SignJWT({ sid: 'session_1' }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject('user_A').setIssuedAt().setExpirationTime(exp).sign(privateKey)

const workos = http.createServer(async (request, response) => {
  const send = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  if (request.url.startsWith('/sso/jwks/')) {
    return mode.jwks === 'down' ? send(503, { message: 'down' }) : send(200, { keys: [jwk] })
  }
  if (request.url === '/user_management/authenticate') {
    if (mode.refresh === 'down') return send(503, { message: 'down' })
    if (mode.refresh === 'refused') return send(400, { error: 'invalid_grant', error_description: 'refresh token revoked' })
    return send(200, {
      user: { object: 'user', id: 'user_A', email: 'a@example.com' },
      access_token: await tokenExpiring('5m'),
      refresh_token: 'refresh-2',
    })
  }
  send(404, {})
})
await new Promise((resolve) => workos.listen(0, '127.0.0.1', resolve))

Object.assign(process.env, {
  WORKOS_API_HOSTNAME: '127.0.0.1',
  WORKOS_API_PORT: String(workos.address().port),
  WORKOS_API_HTTPS: 'false',
  WORKOS_CLIENT_ID: 'client_contract',
  WORKOS_API_KEY: 'sk_test_contract',
  WORKOS_COOKIE_PASSWORD: PASSWORD,
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: 'http://localhost:3000/auth/callback',
})
// After the environment: AuthKit reads it when it loads.
const { NextRequest } = await import('next/server')
const { authkit } = await import('@workos-inc/authkit-nextjs')

const seal = async (accessToken) =>
  sealData({ accessToken, refreshToken: 'refresh-1', user: { id: 'user_A', email: 'a@example.com' } }, { password: PASSWORD })
const foreignSignature = await new SignJWT({}).setProtectedHeader({ alg: 'HS256', kid: 'k1' })
  .setSubject('user_A').setExpirationTime('5m').sign(new TextEncoder().encode('another-key-of-at-least-32-bytes!!'))

// AuthKit keeps the signing keys once fetched, so the keys-down case runs first.
const cases = [
  ['signing keys unreachable', await seal(await tokenExpiring('5m')), { jwks: 'down', refresh: 'ok' }],
  ['valid session', await seal(await tokenExpiring('5m')), { jwks: 'ok', refresh: 'ok' }],
  ['expired token, refresh works', await seal(await tokenExpiring(Math.floor(Date.now() / 1000) - 60)), { jwks: 'ok', refresh: 'ok' }],
  ['expired token, refresh service down', await seal(await tokenExpiring(Math.floor(Date.now() / 1000) - 60)), { jwks: 'ok', refresh: 'down' }],
  ['expired token, refresh refused', await seal(await tokenExpiring(Math.floor(Date.now() / 1000) - 60)), { jwks: 'ok', refresh: 'refused' }],
  ['invalid token', await seal(foreignSignature), { jwks: 'ok', refresh: 'ok' }],
  ['unreadable cookie', 'not-a-sealed-value', { jwks: 'ok', refresh: 'ok' }],
  ['cookie sealed with another password', await sealData({ accessToken: 'a' }, { password: 'z'.repeat(40) }), { jwks: 'ok', refresh: 'ok' }],
]

const results = {}
for (const [name, cookie, nextMode] of cases) {
  mode = nextMode
  const { session, headers } = await authkit(
    new NextRequest('http://localhost:3000/editor/x', { headers: { cookie: `wos-session=${cookie}` } })
  )
  results[name] = {
    user: session.user?.id ?? null,
    cookieDeleted: headers.getSetCookie().some((value) => value.split(';')[0].trim() === 'wos-session='),
  }
}
workos.close()
process.stdout.write(JSON.stringify(results))
