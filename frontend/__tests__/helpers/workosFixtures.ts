/** A minimal WorkOS authentication answer, fresh for each caller. */
export function makeAuthResponse() {
  return { user: { id: 'user_01A', email: 'ada@example.com' }, accessToken: 'at', refreshToken: 'rt' }
}

/** An error shaped the way the WorkOS SDK throws it. */
export function workosError(fields: Record<string, unknown>) {
  return Object.assign(new Error(String(fields.code ?? fields.name)), fields)
}
