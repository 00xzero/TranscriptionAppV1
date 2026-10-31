'use client'

/**
 * The sign-in page's steps: choose a way in, then a password (sign in or
 * create an account), an emailed code when WorkOS asks for one, a forgotten
 * password, and a new password from a reset link.
 *
 * Every form fetches Radar's signals token first, waiting at most 1.5 s: a
 * missing token never stops a sign-in (WorkOS still judges it, and still
 * challenges or blocks it). A successful sign-in loads the /auth/finish URL
 * as a new page, so the app starts from fresh AuthKit state.
 */
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { RadarSignalsProvider, useRadarToken } from '@workos/radar-signals/react'
import {
  EmailSchema,
  type AuthActionResult,
  type AuthNotice,
  type SignInError,
} from '@/contracts/auth'
import {
  requestPasswordReset,
  resendCode,
  resetPassword,
  signIn,
  signUp,
  verifyCode,
} from '@/app/auth/actions'
import { CodeStep, ForgotStep, MessageLine, PasswordStep, ResetStep, StartStep } from './SignInSteps'
import type { Message, Mode, PendingCode, Placement } from './sign-in-types'

export type { PendingCode } from './sign-in-types'

type Step = 'start' | 'password' | 'code' | 'forgot' | 'reset'
type ServerAction = (previous: AuthActionResult, formData: FormData) => Promise<AuthActionResult>
type GetSignals = () => Promise<string | undefined>
/** What a press is waiting on, so only that button spins. */
type Waiting = 'sign-in' | 'sign-up' | 'verify' | 'resend' | 'forgot' | 'reset' | 'google' | 'microsoft'

export interface SignInFormProps {
  next: string
  /** WorkOS client id, for Radar's browser signals. Publishable. */
  clientId?: string
  initialMode?: Mode
  initialError?: SignInError
  pendingCode?: PendingCode | null
  /** On the reset page: the token from WorkOS's reset email. */
  resetToken?: string
}

const IDLE: AuthActionResult = { kind: 'idle' }
const SIGNALS_WAIT_MS = 1500

const ERRORS: Record<SignInError, string> = {
  invalid_input: 'Check the email and password, then try again.',
  invalid_credentials: "That email and password don't match.",
  email_taken: "There's already an account for that email.",
  weak_password: 'Choose a stronger password.',
  invalid_code: "That code isn't right. Check the email and try again.",
  code_expired: 'That code has expired. Sign in again.',
  reset_link: 'This reset link has expired or was already used. Enter your email to get a new one.',
  blocked: "We couldn't sign you in right now. Try again later.",
  unsupported: "This account can't sign in here.",
  service: 'Something went wrong on our side. Try again in a moment.',
  not_finished: "We couldn't finish signing you in. Sign in again.",
  oauth: "That sign-in didn't finish. Try again.",
  session:
    "You signed in, but your browser didn't keep the sign-in. Check that cookies are allowed for this site, then try again.",
}

/** A submit that got no answer, so nothing happened: the same step can simply try again. */
const CONNECTION_ERROR = "We couldn't reach the server. Check your connection and try again."

const NOTICES: Record<AuthNotice, string> = {
  account_created: 'Your account is ready. Sign in to continue.',
  password_updated: 'Password updated. Sign in with your new password.',
  reset_sent: "If there's an account for that email, we've sent a link to reset the password.",
  code_sent: "We've sent a new code.",
}

/** Answers about what was typed in the step's one field, which shakes, as a login window does. */
const FIELD_ERRORS = new Set<SignInError>(['invalid_credentials', 'weak_password', 'invalid_code'])

const SHAKE: Keyframe[] = [
  { transform: 'translateX(0)' },
  { transform: 'translateX(-8px)' },
  { transform: 'translateX(7px)' },
  { transform: 'translateX(-5px)' },
  { transform: 'translateX(3px)' },
  { transform: 'translateX(-1px)' },
  { transform: 'translateX(0)' },
]

/** A short sideways shake that settles; none for anyone who asked for less motion. */
function shake(element: HTMLElement | null) {
  if (!element?.animate) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  element.animate(SHAKE, { duration: 400, easing: 'ease-out' })
}

export function SignInForm(props: SignInFormProps) {
  if (!props.clientId) return <Steps {...props} getSignals={async () => undefined} />
  return (
    <RadarSignalsProvider clientId={props.clientId}>
      <WithRadar {...props} />
    </RadarSignalsProvider>
  )
}

function WithRadar(props: SignInFormProps) {
  const { getToken } = useRadarToken()
  const getSignals = useCallback<GetSignals>(async () => {
    try {
      const token = await Promise.race([
        getToken(),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), SIGNALS_WAIT_MS)),
      ])
      return token || undefined
    } catch {
      return undefined
    }
  }, [getToken])
  return <Steps {...props} getSignals={getSignals} />
}

function Steps({
  next,
  initialMode = 'sign-in',
  initialError,
  pendingCode,
  resetToken,
  getSignals,
}: SignInFormProps & { getSignals: GetSignals }) {
  const [step, setStep] = useState<Step>(
    resetToken ? 'reset' : pendingCode ? 'code' : initialError === 'reset_link' ? 'forgot' : 'start'
  )
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState(pendingCode?.email ?? '')
  const [code, setCode] = useState<PendingCode | null>(pendingCode ?? null)
  const [message, setMessage] = useState<Message | null>(
    initialError ? { tone: 'error', text: ERRORS[initialError], at: 'top' } : null
  )
  // Set once the page is on its way out (a sign-in finished, or off to Google
  // or Microsoft): the button that was pressed keeps spinning until it goes.
  const [leaving, setLeaving] = useState<Waiting | null>(null)
  // The field a `field` message is about, and what shakes: its box (with its
  // eye) or the code boxes.
  const fieldRef = useRef<HTMLInputElement>(null)
  const shakeRef = useRef<HTMLDivElement>(null)
  const answeredRef = useRef<Message | null>(null)

  // The address bar follows a pending code step (`/auth?attempt=…&next=…`), so
  // a refresh reopens it from the attempt's own cookie, and each tab keeps its
  // own attempt. Leaving the step takes the attempt out again. Only the
  // attempt id is ever in the URL: never a password, a code or WorkOS's token.
  useEffect(() => {
    const attempt = step === 'code' && code ? code.attempt : null
    const current = new URL(window.location.href)
    if (!attempt && !current.searchParams.has('attempt')) return
    const target = new URL('/auth', current.origin)
    if (next !== '/') target.searchParams.set('next', next)
    if (attempt) target.searchParams.set('attempt', attempt)
    if (target.href !== current.href) window.history.replaceState(null, '', target)
  }, [step, code, next])

  // Back from Google, Microsoft or the app can bring this page back from the
  // browser's back/forward cache exactly as it was left: buttons disabled.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(null)
    }
    window.addEventListener('pageshow', restored)
    return () => window.removeEventListener('pageshow', restored)
  }, [])

  const go = (to: Step, keep: Message | null = null) => {
    setStep(to)
    setMessage(keep)
  }

  const apply = (result: AuthActionResult, from: Waiting) => {
    switch (result.kind) {
      case 'finish':
        setLeaving(from)
        window.location.assign(result.url)
        return
      case 'code':
        setCode({ attempt: result.attempt, challenge: result.challenge, email: result.email })
        go('code', result.notice ? { tone: 'notice', text: NOTICES[result.notice], at: 'top' } : null)
        return
      case 'notice':
        if (result.notice === 'account_created') {
          setMode('sign-in')
          go('password', { tone: 'notice', text: NOTICES.account_created, at: 'top' })
        } else if (result.notice === 'password_updated') {
          setMode('sign-in')
          go('start', { tone: 'notice', text: NOTICES.password_updated, at: 'top' })
        } else {
          setMessage({ tone: 'notice', text: NOTICES[result.notice], at: 'action' })
        }
        return
      case 'error':
        if (result.error === 'code_expired' || result.error === 'not_finished') {
          setCode(null)
          go('start', { tone: 'error', text: ERRORS[result.error], at: 'top' })
        } else if (result.error === 'reset_link') {
          // A used or expired reset link: straight to asking for a new one.
          go('forgot', { tone: 'error', text: ERRORS.reset_link, at: 'top' })
        } else {
          setMessage({
            tone: 'error',
            text: result.error === 'weak_password' && result.detail ? result.detail : ERRORS[result.error],
            at: FIELD_ERRORS.has(result.error) ? 'field' : 'action',
            switchToSignIn: result.error === 'email_taken',
          })
        }
        return
      case 'idle':
        return
    }
  }

  const run = (from: Waiting, action: ServerAction) => async (previous: AuthActionResult, formData: FormData) => {
    formData.set('signalsId', (await getSignals()) ?? '')
    let result: AuthActionResult
    try {
      result = await action(previous, formData)
    } catch {
      // No answer at all (offline, or the server out of reach). Left uncaught
      // it would take the page to the app's error screen; the step stays.
      setMessage({ tone: 'error', text: CONNECTION_ERROR, at: 'action' })
      return previous
    }
    apply(result, from)
    return result
  }

  const [, signInAction, signingIn] = useActionState(run('sign-in', signIn), IDLE)
  const [, signUpAction, signingUp] = useActionState(run('sign-up', signUp), IDLE)
  const [, verifyAction, verifying] = useActionState(run('verify', verifyCode), IDLE)
  const [, resendAction, resending] = useActionState(run('resend', resendCode), IDLE)
  const [, forgotAction, sendingReset] = useActionState(run('forgot', requestPasswordReset), IDLE)
  const [, resetAction, resettingPassword] = useActionState(run('reset', resetPassword), IDLE)
  const pending: Record<Waiting, boolean> = {
    'sign-in': signingIn,
    'sign-up': signingUp,
    verify: verifying,
    resend: resending,
    forgot: sendingReset,
    reset: resettingPassword,
    google: false,
    microsoft: false,
  }
  const waiting = (...on: Waiting[]) => on.some((key) => pending[key] || leaving === key)
  const busy = leaving !== null || Object.values(pending).some(Boolean)

  // A `field` message: React empties the form after each submit, so the cursor
  // goes back in (the first code box, for a code) for a fresh try, and the
  // field shakes. Once the form is enabled again: the code boxes are disabled
  // while it is busy, and a disabled box can't take the cursor.
  useEffect(() => {
    if (busy || message?.at !== 'field' || answeredRef.current === message) return
    answeredRef.current = message
    const box = fieldRef.current ?? shakeRef.current?.querySelector<HTMLInputElement>('input:not([type="hidden"])')
    box?.focus()
    shake(shakeRef.current)
  }, [message, busy])

  const startOAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const provider = form.dataset.provider as 'google' | 'microsoft'
    // Spinning from the press: Radar's token can take up to 1.5 s.
    setLeaving(provider)
    const field = form.elements.namedItem('signalsId')
    if (field instanceof HTMLInputElement) field.value = (await getSignals()) ?? ''
    form.submit()
  }

  // A form action rather than onSubmit: before the page has hydrated, React
  // renders a form action that can't submit, so the email never ends up in
  // the URL as a plain GET.
  const continueWithEmail = (formData: FormData) => {
    const parsed = EmailSchema.safeParse(formData.get('email'))
    if (!parsed.success) {
      // React empties the form after an action; this puts what was typed back.
      setEmail(String(formData.get('email') ?? ''))
      setMessage({ tone: 'error', text: 'Enter a valid email address.', at: 'field' })
      return
    }
    setEmail(parsed.data)
    go('password')
  }

  const switchMode = (to: Mode) => {
    setMode(to)
    go('start')
  }

  // The code step is centred, so its messages are too.
  const centred = step === 'code' ? 'justify-center text-center' : undefined
  const placed = (at: Placement) =>
    message?.at === at && <MessageLine message={message} className={centred} onSignIn={() => switchMode('sign-in')} />
  const top = placed('top')
  const below = placed('action')
  const fieldError = message?.at === 'field' ? message.text : undefined

  if (step === 'code' && code) {
    return (
      <CodeStep
        code={code}
        top={top}
        below={below}
        busy={busy}
        verifying={waiting('verify')}
        resending={waiting('resend')}
        fieldError={fieldError}
        shakeRef={shakeRef}
        verifyAction={verifyAction}
        resendAction={resendAction}
        onStartAgain={() => switchMode(mode)}
        onChangeEmail={() => go('start')}
      />
    )
  }

  if (step === 'forgot') {
    return (
      <ForgotStep
        email={email}
        top={top}
        below={below}
        busy={busy}
        pending={waiting('forgot')}
        action={forgotAction}
        onBack={() => go(email ? 'password' : 'start')}
      />
    )
  }

  if (step === 'reset' && resetToken) {
    return (
      <ResetStep
        resetToken={resetToken}
        next={next}
        top={top}
        below={below}
        busy={busy}
        pending={waiting('reset')}
        fieldError={fieldError}
        fieldRef={fieldRef}
        shakeRef={shakeRef}
        action={resetAction}
        onNewLink={() => go('forgot')}
        onBack={() => go('start')}
      />
    )
  }

  if (step === 'password' && email) {
    return (
      <PasswordStep
        mode={mode}
        email={email}
        next={next}
        top={top}
        below={below}
        busy={busy}
        pending={waiting('sign-in', 'sign-up')}
        fieldError={fieldError}
        fieldRef={fieldRef}
        shakeRef={shakeRef}
        action={mode === 'sign-up' ? signUpAction : signInAction}
        onChangeEmail={() => go('start')}
        onForgotPassword={() => go('forgot')}
      />
    )
  }

  return (
    <StartStep
      mode={mode}
      email={email}
      next={next}
      top={top}
      below={below}
      busy={busy}
      googleWaiting={waiting('google')}
      microsoftWaiting={waiting('microsoft')}
      fieldError={fieldError}
      fieldRef={fieldRef}
      shakeRef={shakeRef}
      emailAction={continueWithEmail}
      onOAuthSubmit={startOAuth}
      onSwitchMode={switchMode}
    />
  )
}
