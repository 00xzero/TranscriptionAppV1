import React from 'react'
import { render } from '@testing-library/react'

let identityValue: { userId: string | null; ready: boolean } = {
  userId: null,
  ready: false,
}

jest.mock('@/lib/supabase/hooks', () => ({
  useAuthIdentity: () => identityValue,
}))

// Create the spy inside the factory (avoids a TDZ error when the import below
// triggers the factory before a top-level const would be initialized).
jest.mock('@/lib/recording/session', () => ({
  ...jest.requireActual('@/lib/recording/session'),
  runRecoveryProbe: jest.fn(async () => false),
}))

import { RecordingSessionProvider } from '@/lib/recording/RecordingSessionContext'
import { runRecoveryProbe } from '@/lib/recording/session'

const mockRunRecoveryProbe = jest.mocked(runRecoveryProbe)

describe('RecordingSessionProvider recovery probe gating', () => {
  beforeEach(() => {
    mockRunRecoveryProbe.mockClear()
    identityValue = { userId: null, ready: false }
  })

  test('probes once userId resolves, even after a ready/null transient (cold start)', () => {
    const { rerender } = render(<RecordingSessionProvider>x</RecordingSessionProvider>)
    expect(mockRunRecoveryProbe).not.toHaveBeenCalled()

    // Cold-start step 1: auth becomes ready but the user id is not known yet.
    identityValue = { userId: null, ready: true }
    rerender(<RecordingSessionProvider>x</RecordingSessionProvider>)
    expect(mockRunRecoveryProbe).not.toHaveBeenCalled()

    // Cold-start step 2: the user id arrives a tick later — the probe must still run.
    identityValue = { userId: 'u1', ready: true }
    rerender(<RecordingSessionProvider>x</RecordingSessionProvider>)
    expect(mockRunRecoveryProbe).toHaveBeenCalledTimes(1)
  })

  test('warm refresh (userId ready immediately) probes once', () => {
    identityValue = { userId: 'u1', ready: true }
    render(<RecordingSessionProvider>x</RecordingSessionProvider>)
    expect(mockRunRecoveryProbe).toHaveBeenCalledTimes(1)
  })

  test('signed-out (ready, no user) never probes', () => {
    identityValue = { userId: null, ready: true }
    const { rerender } = render(<RecordingSessionProvider>x</RecordingSessionProvider>)
    rerender(<RecordingSessionProvider>x</RecordingSessionProvider>)
    expect(mockRunRecoveryProbe).not.toHaveBeenCalled()
  })
})
