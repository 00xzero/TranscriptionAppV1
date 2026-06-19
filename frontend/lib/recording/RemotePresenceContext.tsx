"use client"

import { createContext, useContext } from 'react'
import {
  isRemoteRecordingBlocking,
  type RemotePresenceStatus,
} from './useRemotePresence'

/**
 * Shares the single derived remote-presence status computed once in
 * `RecordingSessionProvider`, so the pill, the recording page, and the capture
 * modal all read the same value (one subscription, one owner-loss side effect)
 * instead of each running `useRemotePresence` independently.
 */
const RemotePresenceContext = createContext<RemotePresenceStatus>({ kind: 'none' })

export const RemotePresenceProvider = RemotePresenceContext.Provider

export function useRemotePresenceStatus(): RemotePresenceStatus {
  return useContext(RemotePresenceContext)
}

export { isRemoteRecordingBlocking }
export type { RemotePresenceStatus }
