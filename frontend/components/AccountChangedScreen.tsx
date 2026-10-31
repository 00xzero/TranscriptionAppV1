"use client"

import { useEffect, useState, type ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth/AuthProvider'
import { readAccountMarker } from '@/lib/auth/account-marker'
import { accountChangeFromMarker, type AccountChange } from '@/lib/auth/auth-policy'
import { unsavedEditorTexts } from '@/lib/editor/leaveGuard'
import { copyText } from '@/lib/editor/unsavedToasts'
import { useRecordingActions, useRecordingSession } from '@/lib/recording/RecordingSessionContext'
import { getFinalizedRecordingFile } from '@/lib/recording/session'

/** What the browser's session now is, for a stopped page: `back` is its own account again. */
type SessionNow = AccountChange | 'back'

const TEXT: Record<SessionNow, { heading: string; description: string }> = {
  switched: {
    heading: "You've signed in to another account",
    description: 'This tab still belongs to the account you used before. Reload to continue as the new one.',
  },
  'signed-out': {
    heading: "You've signed out in another tab",
    description: 'Sign in again to carry on.',
  },
  'sign-in-again': {
    heading: 'Please sign in again',
    description: 'Your session needs a fresh sign-in.',
  },
  back: {
    heading: 'This tab needs a reload',
    description: 'Reload to carry on.',
  },
}

/** How often a stopped page re-reads the account cookie, so its words and button follow other tabs. */
const COOKIE_CHECK_MS = 1_000

/**
 * What the browser's session is now, from the account cookie: other tabs may
 * have signed in or out since this page stopped. The page itself never takes
 * on another account; only what this screen says and does follows.
 */
function sessionNow(pageUserId: string | null, stoppedAs: AccountChange): SessionNow {
  if (!pageUserId) return stoppedAs
  return accountChangeFromMarker(pageUserId, readAccountMarker(document.cookie)) ?? 'back'
}

/**
 * The app, only while its account is still the browser's session. Once that
 * changes, everything inside unmounts in one go, so no page, live update,
 * timer or focus listener keeps working for the old account, and its data
 * leaves the page.
 */
export function CurrentAccountOnly({ children }: { children: ReactNode }) {
  const { accountChange } = useAuth()
  return accountChange ? null : children
}

/**
 * Shown on a page whose account is no longer the browser's session (another
 * tab signed out or signed in as someone else; see AuthProvider). The page
 * has stopped for good and its content is gone (CurrentAccountOnly), so this
 * never closes: it offers what can still be kept from this tab (the
 * editor's unsaved text, read before the editor unmounts and still guarded
 * against leaving; a recording in progress, or its audio as a file when the
 * device can't keep it) before reloading or signing in.
 */
export default function AccountChangedScreen() {
  const { accountChange } = useAuth()
  if (!accountChange) return null
  return <Covered change={accountChange} />
}

function Covered({ change }: { change: AccountChange }) {
  const { userId, signOut } = useAuth()
  const recording = useRecordingSession()
  const { stopAndFinalize } = useRecordingActions()
  const [unsaved] = useState(unsavedEditorTexts)
  const [copied, setCopied] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [now, setNow] = useState(() => sessionNow(userId, change))
  const recordingLive = recording.state === 'recording' || recording.state === 'paused'
  // A device that can't keep recordings holds the stopped one only in memory.
  const memoryOnly = recording.durable ? null : getFinalizedRecordingFile()
  const text = TEXT[now]
  const signsIn = now === 'signed-out' || now === 'sign-in-again'

  useEffect(() => {
    const check = () => setNow(sessionNow(userId, change))
    const timer = setInterval(check, COOKIE_CHECK_MS)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [userId, change])

  // The editor's own warning left with it: leaving still asks while its text is held here.
  useEffect(() => {
    if (unsaved.length === 0) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  const copy = async () => setCopied(await copyText(unsaved))
  const stop = async () => {
    setStopping(true)
    try {
      await stopAndFinalize()
    } finally {
      setStopping(false)
    }
  }
  const download = () => {
    if (!memoryOnly) return
    const url = URL.createObjectURL(memoryOnly)
    const link = document.createElement('a')
    link.href = url
    link.download = memoryOnly.name
    link.click()
    // Long enough for the browser to start saving it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    setDownloaded(true)
  }
  // Decided from the session as it is at the click: a button left over from
  // an earlier state must never sign out an account that signed in since.
  const carryOn = () => {
    const current = sessionNow(userId, change)
    setNow(current)
    // A session from before the account cookie: end it, then sign in.
    if (current === 'sign-in-again') return void signOut()
    if (current === 'signed-out') {
      // A full page load, not the router: nothing of this stopped page may carry on.
      const signIn = new URL('/auth', window.location.origin)
      signIn.searchParams.set('next', `${window.location.pathname}${window.location.search}`)
      window.location.assign(signIn.href)
      return
    }
    window.location.reload()
  }

  return (
    // Always open: Escape, clicks outside and every button leave it in place.
    <AlertDialog open>
      <AlertDialogContent
        overlayClassName="z-[200] bg-background backdrop-blur-none"
        className="z-[200] overflow-hidden p-0"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <div className="px-6 pt-6 pb-5">
          <AlertDialogTitle className="mb-2 font-sans text-sm font-semibold not-italic text-foreground">
            {text.heading}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-relaxed text-muted">
            {text.description}
            {recordingLive && (recording.durable
              ? ' A recording in this tab is still going. Stop it to keep it on this device.'
              : ' A recording in this tab is still going, and this browser can’t keep it on this device. Stop it, then download it.')}
            {!recordingLive && memoryOnly && ' This browser couldn’t keep your recording on this device. Download it before you leave.'}
          </AlertDialogDescription>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-subtle px-6 py-4">
          {unsaved.length > 0 && (
            <Button type="button" variant="ghost" className="mr-auto" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy unsaved text'}
            </Button>
          )}
          {recordingLive && (
            <Button type="button" variant="ghost" disabled={stopping} onClick={() => void stop()}>
              Stop recording
            </Button>
          )}
          {!recordingLive && memoryOnly && (
            <Button type="button" variant="ghost" onClick={download}>
              {downloaded ? 'Downloaded' : 'Download recording'}
            </Button>
          )}
          <Button type="button" variant="transcribe" onClick={carryOn}>
            {signsIn ? 'Sign in' : 'Reload'}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
