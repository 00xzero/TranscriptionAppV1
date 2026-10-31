import { randomId } from '@/lib/ids'

type Operation = 'proxy' | 'session-read' | 'identity' | 'sign-in-completion' | 'renewal'
  | 'password' | 'sign-up' | 'code' | 'oauth' | 'reset' | 'resend' | 'reset-request'
export type AuthStage = 'lookup' | 'token' | 'realtime' | 'provisioning' | 'save-session' | 'tokens'
type Category = 'unknown' | 'unconfirmed' | 'network' | 'upstream' | 'throttled'
  | 'permission' | 'configuration' | 'transient' | 'refused' | 'session-mismatch' | 'missing-tokens'

// Only recognized codes leave this module; SDK messages, causes and payloads never do.
const CATEGORIES: Record<string, Category> = {
  ECONNREFUSED: 'network', ECONNRESET: 'network', ETIMEDOUT: 'network', ENOTFOUND: 'network', EAI_AGAIN: 'network',
  '42501': 'permission', '42P01': 'configuration', PGRST202: 'configuration', invalid_grant: 'refused',
}

/** One operation's sanitized console records. retryLimit silences intermediate and later retries. */
export function authDiagnostics(operation: Operation, retryLimit?: number) {
  const started = Date.now()
  let correlationId: string | undefined
  let failures = 0
  return (
    event: 'failed' | 'recovered' | 'unavailable' | 'refused',
    error?: unknown,
    details: { stage?: AuthStage; category?: Category } = {}
  ): void => {
    if (event === 'failed') {
      failures++
      if (retryLimit && failures !== 1 && failures !== retryLimit) return
    }
    if (event === 'recovered' && !failures) return
    const source = error && typeof error === 'object' ? error as Record<string, unknown> : {}
    const status = typeof source.status === 'number' && Number.isInteger(source.status)
      && source.status >= 400 && source.status <= 599 ? source.status : undefined
    const code = typeof source.code === 'string' && Object.hasOwn(CATEGORIES, source.code) ? source.code : undefined
    const category = details.category ?? (source.isTransient === true ? 'transient'
      : code ? CATEGORIES[code] : status === 429 ? 'throttled' : status && status >= 500 ? 'upstream' : 'unknown')
    const record = {
      event: `auth.${operation}.${event === 'failed' && failures === retryLimit ? 'exhausted' : event}`,
      correlation_id: correlationId ??= randomId(),
      elapsed_ms: Math.max(0, Date.now() - started),
      stage: details.stage,
      attempt: event === 'failed' || event === 'recovered' ? failures : undefined,
      category: event === 'recovered' ? undefined : category,
      status,
      code,
    }
    console[event === 'recovered' ? 'info' : 'warn']('[auth]', JSON.stringify(record))
    if (event === 'recovered') failures = 0
  }
}
