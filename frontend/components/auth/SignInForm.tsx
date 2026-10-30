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
  type ReactNode,
  type Ref,
} from 'react'
import { RadarSignalsProvider, useRadarToken } from '@workos/radar-signals/react'
import { CircleAlert, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CodeField } from '@/components/ui/code-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordField } from '@/components/ui/password-field'
import { Spinner } from '@/components/ui/spinner'
import {
  EmailSchema,
  type AuthActionResult,
  type AuthNotice,
  type Challenge,
  type SignInError,
} from '@/contracts/auth'
import { cn } from '@/lib/utils'
import {
  requestPasswordReset,
  resendCode,
  resetPassword,
  signIn,
  signUp,
  verifyCode,
} from '@/app/auth/actions'

type Mode = 'sign-in' | 'sign-up'
type Step = 'start' | 'password' | 'code' | 'forgot' | 'reset'
type ServerAction = (previous: AuthActionResult, formData: FormData) => Promise<AuthActionResult>
type GetSignals = () => Promise<string | undefined>
/** What a press is waiting on, so only that button spins. */
type Waiting = 'sign-in' | 'sign-up' | 'verify' | 'resend' | 'forgot' | 'reset' | 'google' | 'microsoft'

export interface PendingCode {
  attempt: string
  challenge: Challenge
  email: string
}

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

/**
 * Where a message shows, so nothing the person is about to use moves:
 * `top` for one a step opens with (it is there from the first frame),
 * `field` under the field it is about, `action` under the button for any
 * other answer to a submit.
 */
type Placement = 'top' | 'field' | 'action'
type Message = { tone: 'error' | 'notice'; text: string; at: Placement; switchToSignIn?: boolean }

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
  const invalid = fieldError ? { 'aria-invalid': true, 'aria-describedby': FIELD_ERROR_ID } : {}
  const hiddenNext = <input type="hidden" name="next" value={next} />

  if (step === 'code' && code) {
    const radar = code.challenge === 'radar'
    return (
      <Column
        title={radar ? "Confirm it's you." : 'Check your email.'}
        lede={
          <>
            We sent a 6-digit code to <span className="text-foreground">{code.email}</span>
            {radar ? ' to confirm it’s you.' : '.'}
          </>
        }
      >
        {top}
        <form action={verifyAction} className="flex flex-col gap-3">
          <input type="hidden" name="attempt" value={code.attempt} />
          <div className="flex flex-col gap-1.5">
            <div ref={shakeRef}>
              <CodeField
                name="code"
                disabled={busy}
                invalid={!!fieldError}
                aria-describedby={fieldError ? FIELD_ERROR_ID : undefined}
              />
            </div>
            {fieldError && <FieldError className={centred}>{fieldError}</FieldError>}
          </div>
          <SubmitButton waiting={waiting('verify')} disabled={busy}>
            Continue
          </SubmitButton>
        </form>
        {below}
        <div className="flex items-center justify-center gap-4 text-sm">
          {radar ? (
            <TextButton onClick={() => switchMode(mode)}>Start again</TextButton>
          ) : (
            <form action={resendAction}>
              <input type="hidden" name="attempt" value={code.attempt} />
              <TextButton type="submit" disabled={busy} aria-busy={waiting('resend') || undefined}>
                <WithSpinner on={waiting('resend')} className="h-3 w-3">
                  Send a new code
                </WithSpinner>
              </TextButton>
            </form>
          )}
          <TextButton onClick={() => go('start')}>Use a different email</TextButton>
        </div>
      </Column>
    )
  }

  if (step === 'forgot') {
    return (
      <Column title="Reset your password." lede="We'll email you a link to choose a new one.">
        {top}
        <form action={forgotAction} className="flex flex-col gap-3">
          <Field id="forgot-email" label="Email">
            <Input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              defaultValue={email}
              required
              autoFocus
              className="h-10 text-[15px]"
            />
          </Field>
          <SubmitButton waiting={waiting('forgot')} disabled={busy}>
            Send reset link
          </SubmitButton>
        </form>
        {below}
        <Footer>
          <TextButton onClick={() => go(email ? 'password' : 'start')}>Back to sign in</TextButton>
        </Footer>
      </Column>
    )
  }

  if (step === 'reset' && resetToken) {
    return (
      <Column title="Choose a new password." lede="At least 10 characters.">
        {top}
        <form action={resetAction} className="flex flex-col gap-3">
          <input type="hidden" name="token" value={resetToken} />
          {hiddenNext}
          <Field id="new-password" label="New password" error={fieldError} controlRef={shakeRef}>
            <PasswordField
              ref={fieldRef}
              id="new-password"
              name="password"
              autoComplete="new-password"
              required
              autoFocus
              className="h-10 text-[15px]"
              {...invalid}
            />
          </Field>
          <SubmitButton waiting={waiting('reset')} disabled={busy}>
            Save and sign in
          </SubmitButton>
        </form>
        {below}
        <Footer>
          <TextButton onClick={() => go('forgot')}>Send a new link</TextButton>
          {' · '}
          <TextButton onClick={() => go('start')}>Back to sign in</TextButton>
        </Footer>
      </Column>
    )
  }

  if (step === 'password' && email) {
    const signingUpNow = mode === 'sign-up'
    return (
      <Column
        title={signingUpNow ? 'Choose a password.' : 'Welcome back.'}
        lede={
          signingUpNow
            ? "At least 10 characters. We'll email you a code to confirm the address."
            : 'Enter your password to open your library.'
        }
      >
        {top}
        <form action={signingUpNow ? signUpAction : signInAction} className="flex flex-col gap-3">
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-sm border border-border px-3 py-2 text-[15px]">
            <span className="truncate">{email}</span>
            <TextButton onClick={() => go('start')}>Change</TextButton>
          </div>
          {/* For password managers: the account this password belongs to. */}
          <input type="email" name="email" value={email} autoComplete="username" readOnly hidden />
          {hiddenNext}
          <Field
            id="password"
            label="Password"
            error={fieldError}
            controlRef={shakeRef}
            aside={
              signingUpNow ? undefined : <TextButton onClick={() => go('forgot')}>Forgot password?</TextButton>
            }
          >
            <PasswordField
              ref={fieldRef}
              id="password"
              name="password"
              autoComplete={signingUpNow ? 'new-password' : 'current-password'}
              placeholder={signingUpNow ? 'A new password' : 'Your password'}
              required
              autoFocus
              className="h-10 text-[15px]"
              {...invalid}
            />
          </Field>
          <SubmitButton waiting={waiting('sign-in', 'sign-up')} disabled={busy}>
            {signingUpNow ? 'Create account' : 'Sign in'}
          </SubmitButton>
        </form>
        {below}
      </Column>
    )
  }

  const signingUpNow = mode === 'sign-up'
  return (
    <Column
      title={signingUpNow ? 'Start your library.' : 'Every voice, on the page.'}
      lede={signingUpNow ? 'Create an account to record and transcribe.' : 'Sign in to your library of transcripts.'}
    >
      {top}
      <div className="flex flex-col gap-3">
        <OAuthButton
          provider="google"
          next={next}
          disabled={busy}
          waiting={waiting('google')}
          mark={<GoogleMark />}
          onSubmit={startOAuth}
        >
          Continue with Google
        </OAuthButton>
        <OAuthButton
          provider="microsoft"
          next={next}
          disabled={busy}
          waiting={waiting('microsoft')}
          mark={<MicrosoftMark />}
          onSubmit={startOAuth}
        >
          Continue with Microsoft
        </OAuthButton>
      </div>
      <div className="flex items-center gap-3 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
        or
      </div>
      <form action={continueWithEmail} noValidate className="flex flex-col gap-3">
        <Field id="email" label="Email" error={fieldError} controlRef={shakeRef}>
          <Input
            ref={fieldRef}
            id="email"
            name="email"
            type="email"
            // Signing in, it's the account name of a saved password, so Chrome
            // offers saved logins here rather than the addresses it keeps.
            autoComplete={signingUpNow ? 'email' : 'username'}
            placeholder="you@example.com"
            defaultValue={email}
            required
            className="h-10 text-[15px]"
            {...invalid}
          />
        </Field>
        <Button type="submit" variant="ink" size="lg" disabled={busy}>
          Continue with email
        </Button>
      </form>
      {below}
      <Footer>
        {signingUpNow ? 'Already have an account? ' : 'New to olivetti? '}
        <TextButton onClick={() => switchMode(signingUpNow ? 'sign-in' : 'sign-up')}>
          {signingUpNow ? 'Sign in' : 'Create an account'}
        </TextButton>
      </Footer>
    </Column>
  )
}

/** One step: the heading and its line, centred, over the 390px controls. */
function Column({ title, lede, children }: { title: string; lede: ReactNode; children: ReactNode }) {
  return (
    <div className="flex w-fit max-w-full flex-col items-center text-center">
      <h1 className="mb-3.5 font-serif text-[3.5rem] leading-[1.15] font-[350] tracking-[-0.02em] text-balance max-[499px]:text-[3.2rem] max-[349px]:text-[2.375rem]">
        {title}
      </h1>
      <p className="mb-8 text-lg text-muted max-[767px]:text-base">{lede}</p>
      <div className="flex w-[min(390px,100%)] flex-col gap-3.5 text-left">{children}</div>
    </div>
  )
}

function Field({
  id,
  label,
  aside,
  error,
  controlRef,
  children,
}: {
  id: string
  label: string
  aside?: ReactNode
  error?: string
  /** Wraps the field's control, for something to shake. */
  controlRef?: Ref<HTMLDivElement>
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id} className="text-[0.8rem] text-muted">
          {label}
        </Label>
        {aside}
      </div>
      {controlRef ? <div ref={controlRef}>{children}</div> : children}
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}

const FIELD_ERROR_ID = 'sign-in-field-error'

/** Every message's look: an icon and a line of text, red for an error. */
function Line({
  tone,
  id,
  className,
  children,
}: {
  tone: Message['tone']
  id?: string
  className?: string
  children: ReactNode
}) {
  const Icon = tone === 'error' ? CircleAlert : Info
  return (
    <p
      id={id}
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-1.5 text-[0.8125rem] text-foreground', className)}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={2}
        className={cn('mt-[2px] h-3.5 w-3.5 shrink-0', tone === 'error' ? 'text-ember-red' : 'text-accent')}
      />
      <span>{children}</span>
    </p>
  )
}

/** A message about the field above it, named by that field's aria-describedby. */
function FieldError({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Line tone="error" id={FIELD_ERROR_ID} className={className}>
      {children}
    </Line>
  )
}

function Footer({ children }: { children: ReactNode }) {
  return <p className="mt-6 text-center text-sm text-muted">{children}</p>
}

function TextButton({
  className,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        'shrink-0 cursor-pointer text-[0.8125rem] font-medium whitespace-nowrap text-accent underline-offset-[3px] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

function MessageLine({
  message,
  className,
  onSignIn,
}: {
  message: Message
  className?: string
  onSignIn: () => void
}) {
  return (
    <Line tone={message.tone} className={className}>
      {message.text}
      {message.switchToSignIn && (
        <>
          {' '}
          <TextButton onClick={onSignIn}>Sign in instead</TextButton>
        </>
      )}
    </Line>
  )
}

function OAuthButton({
  provider,
  next,
  disabled,
  waiting,
  mark,
  onSubmit,
  children,
}: {
  provider: 'google' | 'microsoft'
  next: string
  disabled: boolean
  waiting: boolean
  mark: ReactNode
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
}) {
  return (
    <form method="post" action={`/auth/oauth/${provider}`} data-provider={provider} onSubmit={onSubmit}>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="signalsId" defaultValue="" />
      <Button
        type="submit"
        variant="secondary"
        size="lg"
        disabled={disabled}
        aria-busy={waiting || undefined}
        className="disabled:aria-busy:opacity-100"
      >
        {/* The spinner takes the logo's place, so the label stays put. */}
        {waiting ? <Spinner className="h-[17px] w-[17px] shrink-0 text-muted" /> : mark}
        {children}
      </Button>
    </form>
  )
}

/**
 * A step's main button. While its answer is coming it spins and stays at full
 * strength; the other buttons are only disabled.
 */
function SubmitButton({ waiting, disabled, children }: { waiting: boolean; disabled: boolean; children: ReactNode }) {
  return (
    <Button
      type="submit"
      variant="ink"
      size="lg"
      disabled={disabled}
      aria-busy={waiting || undefined}
      className="disabled:aria-busy:opacity-100"
    >
      <WithSpinner on={waiting} className="h-4 w-4">
        {children}
      </WithSpinner>
    </Button>
  )
}

/** A label with the spinner hung off its left edge, so the label doesn't move when it starts. */
function WithSpinner({ on, className, children }: { on: boolean; className: string; children: ReactNode }) {
  return (
    <span className="relative">
      {on && <Spinner className={cn('absolute top-1/2 right-full mr-2 -translate-y-1/2', className)} />}
      {children}
    </span>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[17px] w-[17px] shrink-0">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  )
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[17px] w-[17px] shrink-0">
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  )
}
