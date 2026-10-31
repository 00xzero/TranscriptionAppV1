/**
 * The WorkOS settings the sign-in code reads when it loads. Import this first
 * in a suite, before the modules under test, so they see these values.
 */
process.env.WORKOS_CLIENT_ID = 'client_test'
process.env.WORKOS_COOKIE_PASSWORD = 'a-test-cookie-password-of-at-least-32-chars'
process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = 'http://localhost:3000/auth/callback'

export {}
