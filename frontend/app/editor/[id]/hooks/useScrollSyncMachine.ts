import { useCallback, useReducer, useRef } from 'react'
import { PROGRAMMATIC_SCROLL_RESET_MS, SEEK_LOCK_MS } from '../utils'
import {
  createInitialScrollSyncState,
  deriveScrollSyncFlags,
  type ScrollSyncCommand,
  type ScrollSyncEvent,
  type ScrollSyncState,
  transitionScrollSyncState,
} from './scrollSyncMachine'

const replaceReducer = (_state: ScrollSyncState, nextState: ScrollSyncState) => nextState

export function useScrollSyncMachine({
  onScrollToActive,
  onEnsureActiveVisible,
  onScrollToTop,
}: {
  onScrollToActive: (state: ScrollSyncState, behavior: ScrollBehavior) => void
  onEnsureActiveVisible: (state: ScrollSyncState) => void
  onScrollToTop: (state: ScrollSyncState, behavior: ScrollBehavior) => void
}) {
  const [state, replaceState] = useReducer(replaceReducer, undefined, createInitialScrollSyncState)
  const stateRef = useRef(state)
  const executeCommandsRef = useRef<(nextState: ScrollSyncState, commands: ScrollSyncCommand[]) => void>(() => undefined)

  stateRef.current = state

  const send = useCallback((event: ScrollSyncEvent) => {
    const { state: nextState, commands } = transitionScrollSyncState(stateRef.current, event)
    stateRef.current = nextState
    replaceState(nextState)
    executeCommandsRef.current(nextState, commands)
    return nextState
  }, [])

  const markProgrammaticScroll = useCallback(() => {
    const now = Date.now()
    send({
      type: 'PROGRAMMATIC_SCROLL_STARTED',
      now,
      until: now + PROGRAMMATIC_SCROLL_RESET_MS,
    })
  }, [send])

  const executeCommands = useCallback((nextState: ScrollSyncState, commands: ScrollSyncCommand[]) => {
    for (const command of commands) {
      switch (command.type) {
        case 'SCROLL_TO_ACTIVE':
          markProgrammaticScroll()
          onScrollToActive(nextState, command.behavior)
          break
        case 'ENSURE_ACTIVE_VISIBLE':
          markProgrammaticScroll()
          onEnsureActiveVisible(nextState)
          break
        case 'SCROLL_TO_TOP':
          markProgrammaticScroll()
          onScrollToTop(nextState, command.behavior)
          break
        case 'CLEAR_USER_SCROLLED':
          break
      }
    }
  }, [markProgrammaticScroll, onEnsureActiveVisible, onScrollToActive, onScrollToTop])

  executeCommandsRef.current = executeCommands

  const isProgrammaticScrollActive = useCallback(() => {
    const until = stateRef.current.programmaticScrollUntil
    return until !== null && Date.now() < until
  }, [])

  const flags = deriveScrollSyncFlags(state)

  const resumeFollow = useCallback(() => send({ type: 'FOLLOW_REQUESTED', now: Date.now() }), [send])
  const suspendFollow = useCallback((reason?: 'search' | 'ui') => {
    return send({ type: 'FOLLOW_SUSPENDED', now: Date.now(), reason })
  }, [send])
  const startSeek = useCallback(() => send({ type: 'SEEK_STARTED', now: Date.now() }), [send])
  const previewSeek = useCallback((segId?: string) => {
    return send({ type: 'SEEK_PREVIEW', now: Date.now(), segId })
  }, [send])
  const commitSeek = useCallback((segId?: string, opts?: { lockSeek?: boolean }) => {
    const now = Date.now()
    return send({
      type: 'SEEK_COMMITTED',
      now,
      segId,
      lockSeekUntil: opts?.lockSeek === false ? null : now + SEEK_LOCK_MS,
    })
  }, [send])
  const onWordSeek = useCallback((segId: string) => {
    const now = Date.now()
    return send({
      type: 'WORD_SEEK',
      now,
      segId,
      lockSeekUntil: now + SEEK_LOCK_MS,
    })
  }, [send])
  const onSegmentSeek = useCallback((segId: string) => {
    const now = Date.now()
    return send({
      type: 'SEGMENT_SEEK',
      now,
      segId,
      lockSeekUntil: now + SEEK_LOCK_MS,
    })
  }, [send])
  const handleReturnToTop = useCallback(() => send({ type: 'RETURN_TO_TOP', now: Date.now() }), [send])

  return {
    state,
    stateRef,
    flags,
    send,
    markProgrammaticScroll,
    isProgrammaticScrollActive,
    resumeFollow,
    suspendFollow,
    startSeek,
    previewSeek,
    commitSeek,
    onWordSeek,
    onSegmentSeek,
    handleReturnToTop,
  }
}
