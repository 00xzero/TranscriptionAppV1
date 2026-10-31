import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { SignInForm } from '@/components/auth/SignInForm'
import { requestPasswordReset, resetPassword, signIn, signUp, verifyCode } from '@/app/auth/actions'

jest.mock('@/app/auth/actions', () => ({
  signIn: jest.fn(),
  signUp: jest.fn(),
  verifyCode: jest.fn(),
  resendCode: jest.fn(),
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
}))

const mockGetToken = jest.fn<Promise<string>, []>()
jest.mock('@workos/radar-signals/react', () => ({
  RadarSignalsProvider: ({ children }: { children: ReactNode }) => children,
  useRadarToken: () => ({ getToken: mockGetToken, tokenReady: true }),
}))

const signInMock = signIn as jest.Mock
const verifyMock = verifyCode as jest.Mock
const resetMock = resetPassword as jest.Mock
const forgotMock = requestPasswordReset as jest.Mock

const ATTEMPT_A = 'mabc1234-0123456789abcdef01234567'
const ATTEMPT_B = 'mabc1235-89abcdef0123456701234567'
const query = () => Object.fromEntries(new URLSearchParams(window.location.search))

async function submitPassword() {
  const user = userEvent.setup()
  render(<SignInForm next="/editor/abc" clientId="client_test" />)
  await user.type(screen.getByLabelText('Email'), 'ada@example.com')
  await user.click(screen.getByRole('button', { name: 'Continue with email' }))
  // Found by its label: the password box must keep the id its <label> names.
  await user.type(screen.getByLabelText('Password'), 'not my password')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('SignInForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.history.replaceState(null, '', '/auth?next=%2Feditor%2Fabc')
    signInMock.mockResolvedValue({ kind: 'error', error: 'invalid_credentials' })
  })

  test('a parent prop update preserves the password input and its unsubmitted value within the same step', async () => {
    const user = userEvent.setup()
    const view = render(<SignInForm next="/editor/abc" />)
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue with email' }))
    const password = screen.getByLabelText('Password')
    await user.type(password, 'my unsubmitted password')

    view.rerender(<SignInForm next="/projects" />)

    expect(screen.getByLabelText('Password')).toBe(password)
    expect(password).toHaveValue('my unsubmitted password')
    expect(password.closest('form')).toHaveFormValues({ email: 'ada@example.com', next: '/projects' })
    expect(signInMock).not.toHaveBeenCalled()
  })

  test('password to forgot and back preserves the email, focuses each field and clears the old password', async () => {
    const user = userEvent.setup()
    render(<SignInForm next="/editor/abc" />)
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue with email' }))
    const password = screen.getByLabelText('Password')
    expect(password).toHaveFocus()
    await user.type(password, 'do not retain this password')

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    const email = screen.getByLabelText('Email')
    expect(email).toHaveFocus()
    expect(email).toHaveValue('ada@example.com')

    await user.click(screen.getByRole('button', { name: 'Back to sign in' }))
    const nextPassword = screen.getByLabelText('Password')
    expect(nextPassword).toHaveFocus()
    expect(nextPassword).toHaveValue('')
    expect(nextPassword).not.toBe(password)
    expect(nextPassword.closest('form')).toHaveFormValues({ email: 'ada@example.com', next: '/editor/abc' })
  })

  test('sends Radar’s token with the sign-in, and shows the answer', async () => {
    mockGetToken.mockResolvedValue('radar-token')

    await submitPassword()

    expect(await screen.findByRole('alert')).toHaveTextContent("That email and password don't match.")
    const formData = signInMock.mock.calls[0][1] as FormData
    expect(formData.get('signalsId')).toBe('radar-token')
    expect(formData.get('email')).toBe('ada@example.com')
    expect(formData.get('next')).toBe('/editor/abc')
  })

  test('a Radar token that never comes still lets the sign-in go, after a short wait', async () => {
    mockGetToken.mockReturnValue(new Promise(() => {}))

    await submitPassword()

    await waitFor(() => expect(signInMock).toHaveBeenCalled(), { timeout: 3000 })
    expect((signInMock.mock.calls[0][1] as FormData).get('signalsId')).toBe('')
  })

  test('a failing Radar script still lets the sign-in go', async () => {
    mockGetToken.mockRejectedValue(new Error('script blocked'))

    await submitPassword()

    await waitFor(() => expect(signInMock).toHaveBeenCalled())
    expect((signInMock.mock.calls[0][1] as FormData).get('signalsId')).toBe('')
  })

  test('no answer from the server keeps the step, says so, and the next try goes through', async () => {
    mockGetToken.mockResolvedValue('radar-token')
    signInMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await submitPassword()

    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't reach the server.")
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Password'), 'not my password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("That email and password don't match."))
    expect((signInMock.mock.calls[1][1] as FormData).get('email')).toBe('ada@example.com')
  })

  test('a Radar code step offers to start again rather than a resend', () => {
    render(
      <SignInForm
        next="/"
        pendingCode={{ attempt: 'mabc1234-0123456789abcdef01234567', challenge: 'radar', email: 'ada@example.com' }}
      />
    )

    expect(screen.getByRole('heading', { name: "Confirm it's you." })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send a new code' })).not.toBeInTheDocument()
  })

  test('Back from Google restores the page with its buttons working again', async () => {
    mockGetToken.mockResolvedValue('radar-token')
    // jsdom can't navigate; the form leaving for the provider is enough.
    const submit = jest.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<SignInForm next="/" clientId="client_test" />)

    await user.click(screen.getByRole('button', { name: 'Continue with Google' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Continue with Microsoft' })).toBeDisabled()

    // A page shown afresh is not a restore: nothing changes.
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
    })
    expect(screen.getByRole('button', { name: 'Continue with Microsoft' })).toBeDisabled()

    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Continue with email' })).toBeEnabled()
    submit.mockRestore()
  })

  test('the email box offers saved logins when signing in, and email addresses when creating an account', async () => {
    const user = userEvent.setup()
    render(<SignInForm next="/" />)
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username')

    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email')
  })

  describe('the button that was pressed spins until its answer comes', () => {
    beforeEach(() => mockGetToken.mockResolvedValue('radar-token'))
    const spins = (name: string) => {
      const button = screen.getByRole('button', { name })
      return button.getAttribute('aria-busy') === 'true' && button.querySelector('svg.animate-spin') !== null
    }
    const later = <T,>() => {
      let settle!: (value: T) => void
      const promise = new Promise<T>((resolve) => (settle = resolve))
      return { promise, settle }
    }

    test('Sign in spins while WorkOS answers, and stops once it has', async () => {
      const answer = later<unknown>()
      signInMock.mockReturnValueOnce(answer.promise)

      await submitPassword()

      await waitFor(() => expect(spins('Sign in')).toBe(true))
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
      await act(async () => answer.settle({ kind: 'error', error: 'invalid_credentials' }))
      await screen.findByRole('alert')
      await waitFor(() => expect(spins('Sign in')).toBe(false))
    })

    test('a finished sign-in keeps spinning until the next page has loaded', async () => {
      signInMock.mockResolvedValue({ kind: 'finish', url: 'http://localhost/auth/finish?to=%2F' })
      const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})

      await submitPassword()

      await waitFor(() => expect(signInMock).toHaveBeenCalled())
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(spins('Sign in')).toBe(true)
      quiet.mockRestore()
    })

    test('Google spins from the press, while Radar’s token is still coming; Microsoft is only disabled', async () => {
      mockGetToken.mockReturnValueOnce(new Promise(() => {}))
      const submit = jest.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
      const user = userEvent.setup()
      render(<SignInForm next="/" clientId="client_test" />)

      await user.click(screen.getByRole('button', { name: 'Continue with Google' }))

      expect(spins('Continue with Google')).toBe(true)
      expect(spins('Continue with Microsoft')).toBe(false)
      expect(screen.getByRole('button', { name: 'Continue with Microsoft' })).toBeDisabled()
      expect(submit).not.toHaveBeenCalled()
      submit.mockRestore()
    })

    test('a code being checked spins Continue', async () => {
      const answer = later<unknown>()
      verifyMock.mockReturnValueOnce(answer.promise)
      const user = userEvent.setup()
      render(<SignInForm next="/" pendingCode={{ attempt: ATTEMPT_A, challenge: 'email-verification', email: 'ada@example.com' }} />)

      await user.click(screen.getByRole('button', { name: 'Continue' }))

      await waitFor(() => expect(spins('Continue')).toBe(true))
      expect(spins('Send a new code')).toBe(false)
      // Let the check finish, so nothing is left waiting into the next test.
      await act(async () => answer.settle({ kind: 'error', error: 'invalid_code' }))
      await waitFor(() => expect(spins('Continue')).toBe(false))
    })

    test('continuing with an email asks nothing of the server, so it never spins', async () => {
      const user = userEvent.setup()
      render(<SignInForm next="/" />)
      await user.type(screen.getByLabelText('Email'), 'ada@example.com')
      await user.click(screen.getByRole('button', { name: 'Continue with email' }))

      expect(screen.getByRole('button', { name: 'Sign in' })).not.toHaveAttribute('aria-busy')
    })
  })

  // Where messages show, so nothing above them moves, and a shake for "that's not it".
  describe('where messages show, and what shakes', () => {
    const isAfter = (node: Element, reference: Element) =>
      Boolean(reference.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
    const animate = jest.fn()
    const setMotion = (reduce: boolean) =>
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({ matches: reduce && query.includes('reduce'), media: query }),
      })
    // The element each shake ran on.
    const shaken = () => animate.mock.contexts as HTMLElement[]

    beforeEach(() => {
      mockGetToken.mockResolvedValue('radar-token')
      animate.mockClear()
      HTMLElement.prototype.animate = animate
      setMotion(false)
    })
    afterEach(() => {
      delete (HTMLElement.prototype as Partial<HTMLElement>).animate
      delete (window as Partial<Window>).matchMedia
    })

    test('a wrong password shows under the password box, which is marked, emptied, focused and shaken each time', async () => {
      const user = userEvent.setup()
      await submitPassword()

      const alert = await screen.findByRole('alert')
      const password = screen.getByLabelText('Password')
      expect(alert).toHaveTextContent("That email and password don't match.")
      expect(isAfter(alert, password)).toBe(true)
      expect(isAfter(screen.getByRole('button', { name: 'Sign in' }), alert)).toBe(true)
      expect(password).toHaveAttribute('aria-invalid', 'true')
      expect(password).toHaveAccessibleDescription("That email and password don't match.")
      expect(password).toHaveValue('')
      await waitFor(() => expect(password).toHaveFocus())
      // Radix would give the show/hide eye the box's id too.
      expect(document.querySelectorAll('#password')).toHaveLength(1)
      // The box shakes, eye and all, but not the message.
      await waitFor(() => expect(shaken()).toHaveLength(1))
      expect(shaken()[0]).toContainElement(password)
      expect(shaken()[0]).toContainElement(screen.getByRole('button', { name: 'Show password' }))
      expect(shaken()[0]).not.toContainElement(alert)

      await user.type(password, 'still not it')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))
      await waitFor(() => expect(shaken()).toHaveLength(2))
    })

    test('an answer about the whole attempt shows under the button, leaving the fields unmarked and still', async () => {
      signInMock.mockResolvedValue({ kind: 'error', error: 'service' })

      await submitPassword()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Something went wrong on our side.')
      expect(isAfter(alert, screen.getByRole('button', { name: 'Sign in' }))).toBe(true)
      expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid')
      expect(animate).not.toHaveBeenCalled()
    })

    test('"we\'ve sent a link" shows under the Send button', async () => {
      const user = userEvent.setup()
      forgotMock.mockResolvedValue({ kind: 'notice', notice: 'reset_sent' })
      render(<SignInForm next="/" initialError="reset_link" />)
      // The message the step opened with is at the top.
      expect(isAfter(screen.getByLabelText('Email'), screen.getByRole('alert'))).toBe(true)

      await user.type(screen.getByLabelText('Email'), 'ada@example.com')
      await user.click(screen.getByRole('button', { name: 'Send reset link' }))

      const status = await screen.findByRole('status')
      expect(isAfter(status, screen.getByRole('button', { name: 'Send reset link' }))).toBe(true)
    })

    test('a wrong code shows under the code boxes, which are marked and shaken', async () => {
      const user = userEvent.setup()
      verifyMock.mockResolvedValue({ kind: 'error', error: 'invalid_code' })
      render(<SignInForm next="/" pendingCode={{ attempt: ATTEMPT_A, challenge: 'email-verification', email: 'ada@example.com' }} />)

      await user.click(screen.getByRole('button', { name: 'Continue' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent("That code isn't right.")
      expect(isAfter(screen.getByRole('button', { name: 'Continue' }), alert)).toBe(true)
      await waitFor(() => expect(shaken()).toHaveLength(1))
      for (const box of screen.getAllByRole('textbox')) {
        expect(box).toHaveAttribute('aria-invalid', 'true')
        expect(shaken()[0]).toContainElement(box)
      }
    })

    test('after a wrong code the boxes are emptied and the caret is back in the first one', async () => {
      const user = userEvent.setup()
      verifyMock.mockResolvedValue({ kind: 'error', error: 'invalid_code' })
      render(<SignInForm next="/" pendingCode={{ attempt: ATTEMPT_A, challenge: 'email-verification', email: 'ada@example.com' }} />)

      const boxes = screen.getAllByRole('textbox')
      await user.click(boxes[0])
      await user.keyboard('123456')
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      await screen.findByRole('alert')
      await waitFor(() => expect(boxes[0]).toHaveFocus())
      for (const box of boxes) expect(box).toHaveValue('')
      expect((verifyMock.mock.calls[0][1] as FormData).get('code')).toBe('123456')
    })

    test('every message has the same look: an icon and a line, no box', async () => {
      signInMock.mockResolvedValue({ kind: 'error', error: 'blocked' })
      await submitPassword()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent("We couldn't sign you in right now.")
      expect(alert.querySelector('svg')).toBeInTheDocument()
      expect(alert.className).not.toMatch(/\bbg-/)
    })

    test('an invalid email shows under the email box, which shakes', async () => {
      const user = userEvent.setup()
      render(<SignInForm next="/" />)

      await user.type(screen.getByLabelText('Email'), 'not an email')
      await user.click(screen.getByRole('button', { name: 'Continue with email' }))

      const email = screen.getByLabelText('Email')
      expect(email).toHaveAccessibleDescription('Enter a valid email address.')
      expect(email).toHaveValue('not an email')
      expect(email).toHaveFocus()
      expect(isAfter(screen.getByRole('button', { name: 'Continue with email' }), screen.getByRole('alert'))).toBe(true)
      expect(shaken()).toHaveLength(1)
      expect(shaken()[0]).toContainElement(email)
    })

    test('a weak password shakes its box', async () => {
      const user = userEvent.setup()
      render(<SignInForm next="/" initialMode="sign-up" clientId="client_test" />)
      ;(signUp as jest.Mock).mockResolvedValue({ kind: 'error', error: 'weak_password', detail: 'Add more words.' })
      await user.type(screen.getByLabelText('Email'), 'ada@example.com')
      await user.click(screen.getByRole('button', { name: 'Continue with email' }))
      await user.type(screen.getByLabelText('Password'), 'short')
      await user.click(screen.getByRole('button', { name: 'Create account' }))

      await waitFor(() => expect(shaken()).toHaveLength(1))
      expect(shaken()[0]).toContainElement(screen.getByLabelText('Password'))
    })

    test('no shake for anyone who asked for less motion', async () => {
      setMotion(true)
      await submitPassword()
      await screen.findByRole('alert')

      expect(animate).not.toHaveBeenCalled()
    })
  })

  describe('the code step and the address bar', () => {
    beforeEach(() => mockGetToken.mockResolvedValue('radar-token'))

    test('reaching the code step puts only its attempt and destination in the URL, so a refresh reopens it', async () => {
      signInMock.mockResolvedValue({ kind: 'code', attempt: ATTEMPT_A, challenge: 'email-verification', email: 'ada@example.com' })

      await submitPassword()

      expect(await screen.findByRole('heading', { name: 'Check your email.' })).toBeInTheDocument()
      expect(window.location.pathname).toBe('/auth')
      expect(query()).toEqual({ next: '/editor/abc', attempt: ATTEMPT_A })
      expect(window.location.href).not.toContain('not my password')
    })

    test('a wrong code keeps the step and its URL; the right one goes on', async () => {
      const user = userEvent.setup()
      verifyMock
        .mockResolvedValueOnce({ kind: 'error', error: 'invalid_code' })
        .mockResolvedValueOnce({ kind: 'finish', url: 'http://localhost/auth/finish?to=%2Feditor%2Fabc' })
      render(<SignInForm next="/editor/abc" pendingCode={{ attempt: ATTEMPT_A, challenge: 'email-verification', email: 'ada@example.com' }} />)

      await user.click(screen.getByRole('button', { name: 'Continue' }))
      expect(await screen.findByRole('alert')).toHaveTextContent("That code isn't right.")
      expect(query()).toEqual({ next: '/editor/abc', attempt: ATTEMPT_A })

      await user.click(screen.getByRole('button', { name: 'Continue' }))
      await waitFor(() => expect(verifyMock).toHaveBeenCalledTimes(2))
      expect((verifyMock.mock.calls[1][1] as FormData).get('attempt')).toBe(ATTEMPT_A)
    })

    test('a further challenge moves the URL to the new attempt', async () => {
      const user = userEvent.setup()
      verifyMock.mockResolvedValue({ kind: 'code', attempt: ATTEMPT_B, challenge: 'radar', email: 'ada@example.com' })
      render(<SignInForm next="/editor/abc" pendingCode={{ attempt: ATTEMPT_A, challenge: 'email-verification', email: 'ada@example.com' }} />)

      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(await screen.findByRole('heading', { name: "Confirm it's you." })).toBeInTheDocument()
      expect(query()).toEqual({ next: '/editor/abc', attempt: ATTEMPT_B })
    })

    test('an expired or spent attempt offers a fresh sign-in, keeping the destination and dropping the attempt', async () => {
      const user = userEvent.setup()
      verifyMock.mockResolvedValue({ kind: 'error', error: 'code_expired' })
      render(<SignInForm next="/editor/abc" pendingCode={{ attempt: ATTEMPT_A, challenge: 'email-verification', email: 'ada@example.com' }} />)

      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('That code has expired. Sign in again.')
      expect(screen.getByRole('button', { name: 'Continue with email' })).toBeInTheDocument()
      expect(query()).toEqual({ next: '/editor/abc' })
    })

    test('a refreshed page whose attempt is gone takes the attempt out of the URL', () => {
      window.history.replaceState(null, '', `/auth?next=%2Feditor%2Fabc&attempt=${ATTEMPT_A}`)

      render(<SignInForm next="/editor/abc" initialError="code_expired" />)

      expect(screen.getByRole('alert')).toHaveTextContent('That code has expired.')
      expect(query()).toEqual({ next: '/editor/abc' })
    })

    test('abandoning the step ("Use a different email") takes the attempt out too', async () => {
      const user = userEvent.setup()
      window.history.replaceState(null, '', `/auth?next=%2Feditor%2Fabc&attempt=${ATTEMPT_A}`)
      render(<SignInForm next="/editor/abc" pendingCode={{ attempt: ATTEMPT_A, challenge: 'email-verification', email: 'ada@example.com' }} />)

      await user.click(screen.getByRole('button', { name: 'Use a different email' }))

      expect(query()).toEqual({ next: '/editor/abc' })
    })
  })

  describe('reset links', () => {
    beforeEach(() => mockGetToken.mockResolvedValue('radar-token'))

    test('a used or expired link turns into asking for a new one, and that works', async () => {
      const user = userEvent.setup()
      resetMock.mockResolvedValue({ kind: 'error', error: 'reset_link' })
      forgotMock.mockResolvedValue({ kind: 'notice', notice: 'reset_sent' })
      render(<SignInForm next="/" resetToken="used-token" />)

      await user.type(screen.getByLabelText('New password'), 'a brand new passphrase')
      await user.click(screen.getByRole('button', { name: 'Save and sign in' }))

      expect(await screen.findByRole('heading', { name: 'Reset your password.' })).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('This reset link has expired or was already used.')
      await user.type(screen.getByLabelText('Email'), 'ada@example.com')
      await user.click(screen.getByRole('button', { name: 'Send reset link' }))

      expect(await screen.findByRole('status')).toHaveTextContent("we've sent a link to reset the password")
      expect((forgotMock.mock.calls[0][1] as FormData).get('email')).toBe('ada@example.com')
    })

    test('the reset page without a token opens on asking for a link, with a way back to sign in', async () => {
      const user = userEvent.setup()
      render(<SignInForm next="/" initialError="reset_link" />)

      expect(screen.getByRole('heading', { name: 'Reset your password.' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Back to sign in' }))
      expect(screen.getByRole('button', { name: 'Continue with email' })).toBeInTheDocument()
    })

    test('the new-password step can be left: a new link, or back to sign in', async () => {
      const user = userEvent.setup()
      render(<SignInForm next="/" resetToken="reset-token" />)

      await user.click(screen.getByRole('button', { name: 'Send a new link' }))
      expect(screen.getByRole('heading', { name: 'Reset your password.' })).toBeInTheDocument()
    })

    test('a weak new password keeps the step and its link, and a stronger one goes through', async () => {
      const user = userEvent.setup()
      resetMock
        .mockResolvedValueOnce({ kind: 'error', error: 'weak_password', detail: 'Please try a password with 10 or more characters.' })
        .mockResolvedValueOnce({ kind: 'notice', notice: 'password_updated' })
      render(<SignInForm next="/" resetToken="reset-token" />)

      await user.type(screen.getByLabelText('New password'), 'short')
      await user.click(screen.getByRole('button', { name: 'Save and sign in' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Please try a password with 10 or more characters.')
      await user.type(screen.getByLabelText('New password'), 'a brand new passphrase')
      await user.click(screen.getByRole('button', { name: 'Save and sign in' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Password updated.')
      expect((resetMock.mock.calls[1][1] as FormData).get('token')).toBe('reset-token')
    })

    test('a reset that worked but whose sign-in failed says the password changed', async () => {
      const user = userEvent.setup()
      resetMock.mockResolvedValue({ kind: 'notice', notice: 'password_updated' })
      render(<SignInForm next="/" resetToken="reset-token" />)

      await user.type(screen.getByLabelText('New password'), 'a brand new passphrase')
      await user.click(screen.getByRole('button', { name: 'Save and sign in' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Password updated. Sign in with your new password.')
      expect(screen.getByRole('button', { name: 'Continue with email' })).toBeInTheDocument()
    })
  })
})
