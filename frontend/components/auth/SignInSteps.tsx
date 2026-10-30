import type { FormEvent, ReactNode, Ref } from 'react'
import { CircleAlert, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CodeField } from '@/components/ui/code-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordField } from '@/components/ui/password-field'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { Message, Mode, PendingCode } from './sign-in-types'

type FormAction = (formData: FormData) => void

type StepProps = {
  top: ReactNode
  below: ReactNode
  busy: boolean
}

type FieldProps = {
  fieldError?: string
  fieldRef: Ref<HTMLInputElement>
  shakeRef: Ref<HTMLDivElement>
}

function invalidField(error?: string) {
  return error ? { 'aria-invalid': true as const, 'aria-describedby': FIELD_ERROR_ID } : {}
}

export function StartStep({
  mode, email, next, top, below, busy, googleWaiting, microsoftWaiting,
  fieldError, fieldRef, shakeRef, emailAction, onOAuthSubmit, onSwitchMode,
}: StepProps & FieldProps & {
  mode: Mode
  email: string
  next: string
  googleWaiting: boolean
  microsoftWaiting: boolean
  emailAction: FormAction
  onOAuthSubmit: (event: FormEvent<HTMLFormElement>) => void
  onSwitchMode: (mode: Mode) => void
}) {
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
          waiting={googleWaiting}
          mark={<GoogleMark />}
          onSubmit={onOAuthSubmit}
        >
          Continue with Google
        </OAuthButton>
        <OAuthButton
          provider="microsoft"
          next={next}
          disabled={busy}
          waiting={microsoftWaiting}
          mark={<MicrosoftMark />}
          onSubmit={onOAuthSubmit}
        >
          Continue with Microsoft
        </OAuthButton>
      </div>
      <div className="flex items-center gap-3 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
        or
      </div>
      <form action={emailAction} noValidate className="flex flex-col gap-3">
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
            {...invalidField(fieldError)}
          />
        </Field>
        <Button type="submit" variant="ink" size="lg" disabled={busy}>
          Continue with email
        </Button>
      </form>
      {below}
      <Footer>
        {signingUpNow ? 'Already have an account? ' : 'New to olivetti? '}
        <TextButton onClick={() => onSwitchMode(signingUpNow ? 'sign-in' : 'sign-up')}>
          {signingUpNow ? 'Sign in' : 'Create an account'}
        </TextButton>
      </Footer>
    </Column>
  )
}

export function PasswordStep({
  mode, email, next, top, below, busy, pending, fieldError, fieldRef, shakeRef,
  action, onChangeEmail, onForgotPassword,
}: StepProps & FieldProps & {
  mode: Mode
  email: string
  next: string
  pending: boolean
  action: FormAction
  onChangeEmail: () => void
  onForgotPassword: () => void
}) {
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
      <form action={action} className="flex flex-col gap-3">
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-sm border border-border px-3 py-2 text-[15px]">
          <span className="truncate">{email}</span>
          <TextButton onClick={onChangeEmail}>Change</TextButton>
        </div>
        {/* For password managers: the account this password belongs to. */}
        <input type="email" name="email" value={email} autoComplete="username" readOnly hidden />
        <input type="hidden" name="next" value={next} />
        <Field
          id="password"
          label="Password"
          error={fieldError}
          controlRef={shakeRef}
          aside={
            signingUpNow ? undefined : <TextButton onClick={onForgotPassword}>Forgot password?</TextButton>
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
            {...invalidField(fieldError)}
          />
        </Field>
        <SubmitButton waiting={pending} disabled={busy}>
          {signingUpNow ? 'Create account' : 'Sign in'}
        </SubmitButton>
      </form>
      {below}
    </Column>
  )
}

export function CodeStep({
  code, top, below, busy, verifying, resending, fieldError, shakeRef,
  verifyAction, resendAction, onStartAgain, onChangeEmail,
}: StepProps & Pick<FieldProps, 'fieldError' | 'shakeRef'> & {
  code: PendingCode
  verifying: boolean
  resending: boolean
  verifyAction: FormAction
  resendAction: FormAction
  onStartAgain: () => void
  onChangeEmail: () => void
}) {
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
          {fieldError && <FieldError className="justify-center text-center">{fieldError}</FieldError>}
        </div>
        <SubmitButton waiting={verifying} disabled={busy}>
          Continue
        </SubmitButton>
      </form>
      {below}
      <div className="flex items-center justify-center gap-4 text-sm">
        {radar ? (
          <TextButton onClick={onStartAgain}>Start again</TextButton>
        ) : (
          <form action={resendAction}>
            <input type="hidden" name="attempt" value={code.attempt} />
            <TextButton type="submit" disabled={busy} aria-busy={resending || undefined}>
              <WithSpinner on={resending} className="h-3 w-3">
                Send a new code
              </WithSpinner>
            </TextButton>
          </form>
        )}
        <TextButton onClick={onChangeEmail}>Use a different email</TextButton>
      </div>
    </Column>
  )
}

export function ForgotStep({
  email, top, below, busy, pending, action, onBack,
}: StepProps & {
  email: string
  pending: boolean
  action: FormAction
  onBack: () => void
}) {
  return (
    <Column title="Reset your password." lede="We'll email you a link to choose a new one.">
      {top}
      <form action={action} className="flex flex-col gap-3">
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
        <SubmitButton waiting={pending} disabled={busy}>
          Send reset link
        </SubmitButton>
      </form>
      {below}
      <Footer>
        <TextButton onClick={onBack}>Back to sign in</TextButton>
      </Footer>
    </Column>
  )
}

export function ResetStep({
  resetToken, next, top, below, busy, pending, fieldError, fieldRef, shakeRef,
  action, onNewLink, onBack,
}: StepProps & FieldProps & {
  resetToken: string
  next: string
  pending: boolean
  action: FormAction
  onNewLink: () => void
  onBack: () => void
}) {
  return (
    <Column title="Choose a new password." lede="At least 10 characters.">
      {top}
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="token" value={resetToken} />
        <input type="hidden" name="next" value={next} />
        <Field id="new-password" label="New password" error={fieldError} controlRef={shakeRef}>
          <PasswordField
            ref={fieldRef}
            id="new-password"
            name="password"
            autoComplete="new-password"
            required
            autoFocus
            className="h-10 text-[15px]"
            {...invalidField(fieldError)}
          />
        </Field>
        <SubmitButton waiting={pending} disabled={busy}>
          Save and sign in
        </SubmitButton>
      </form>
      {below}
      <Footer>
        <TextButton onClick={onNewLink}>Send a new link</TextButton>
        {' · '}
        <TextButton onClick={onBack}>Back to sign in</TextButton>
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

export function MessageLine({
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
