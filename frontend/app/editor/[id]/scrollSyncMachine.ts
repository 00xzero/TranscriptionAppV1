export type ScrollSyncMode = 'following' | 'userScrolling' | 'seeking' | 'idle'

export type ScrollSyncCommand =
  | { type: 'SCROLL_TO_ACTIVE'; behavior: ScrollBehavior }
  | { type: 'ENSURE_ACTIVE_VISIBLE' }
  | { type: 'SCROLL_TO_TOP'; behavior: ScrollBehavior }
  | { type: 'CLEAR_USER_SCROLLED' }

export type ScrollSyncState = {
  mode: ScrollSyncMode
  activeSegId?: string
  hasUserScrolled: boolean
  resumeModeAfterSeek: ScrollSyncMode | null
  seekLockUntil: number | null
  programmaticScrollUntil: number | null
  editBlocked: boolean
  popoverBlocked: boolean
}

export type ScrollSyncEvent =
  | { type: 'AUDIO_TICK'; now: number; segId?: string }
  | { type: 'USER_SCROLL'; now: number }
  | { type: 'PROGRAMMATIC_SCROLL_STARTED'; now: number; until: number }
  | { type: 'SEEK_STARTED'; now: number }
  | { type: 'SEEK_PREVIEW'; now: number; segId?: string }
  | { type: 'SEEK_COMMITTED'; now: number; segId?: string; lockSeekUntil?: number | null }
  | { type: 'SEGMENT_SEEK'; now: number; segId: string; lockSeekUntil: number }
  | { type: 'WORD_SEEK'; now: number; segId: string; lockSeekUntil: number }
  | { type: 'FOLLOW_REQUESTED'; now: number }
  | { type: 'FOLLOW_SUSPENDED'; now: number; reason?: 'search' | 'ui' }
  | { type: 'EDIT_BLOCKED'; now: number }
  | { type: 'EDIT_UNBLOCKED'; now: number }
  | { type: 'POPOVER_BLOCKED'; now: number }
  | { type: 'POPOVER_UNBLOCKED'; now: number }
  | { type: 'RETURN_TO_TOP'; now: number }

export const createInitialScrollSyncState = (): ScrollSyncState => ({
  mode: 'following',
  activeSegId: undefined,
  hasUserScrolled: false,
  resumeModeAfterSeek: null,
  seekLockUntil: null,
  programmaticScrollUntil: null,
  editBlocked: false,
  popoverBlocked: false,
})

const clearExpiredLocks = (state: ScrollSyncState, now: number): ScrollSyncState => ({
  ...state,
  seekLockUntil: state.seekLockUntil !== null && state.seekLockUntil <= now ? null : state.seekLockUntil,
  programmaticScrollUntil:
    state.programmaticScrollUntil !== null && state.programmaticScrollUntil <= now
      ? null
      : state.programmaticScrollUntil,
})

export const isBlocked = (state: ScrollSyncState) => state.editBlocked || state.popoverBlocked

export const deriveScrollSyncFlags = (state: ScrollSyncState) => ({
  isFollowMode: state.mode === 'following' && !isBlocked(state),
  isSeeking: state.mode === 'seeking',
})

export function transitionScrollSyncState(
  currentState: ScrollSyncState,
  event: ScrollSyncEvent,
): { state: ScrollSyncState; commands: ScrollSyncCommand[] } {
  const state = clearExpiredLocks(currentState, event.now)
  const commands: ScrollSyncCommand[] = []

  switch (event.type) {
    case 'AUDIO_TICK': {
      if (state.mode === 'seeking') {
        return { state, commands }
      }
      if (state.seekLockUntil !== null && event.now < state.seekLockUntil) {
        return { state, commands }
      }
      if (!event.segId || event.segId === state.activeSegId) {
        return { state, commands }
      }
      const nextState = { ...state, activeSegId: event.segId }
      if (state.mode === 'following' && !isBlocked(nextState)) {
        commands.push({ type: 'SCROLL_TO_ACTIVE', behavior: 'smooth' })
      }
      return { state: nextState, commands }
    }

    case 'USER_SCROLL':
      return {
        state: {
          ...state,
          mode: 'userScrolling',
          hasUserScrolled: true,
          resumeModeAfterSeek: state.mode === 'seeking' ? 'userScrolling' : state.resumeModeAfterSeek,
        },
        commands,
      }

    case 'PROGRAMMATIC_SCROLL_STARTED':
      return {
        state: {
          ...state,
          programmaticScrollUntil: event.until,
        },
        commands,
      }

    case 'SEEK_STARTED':
      return {
        state: {
          ...state,
          mode: 'seeking',
          resumeModeAfterSeek: isBlocked(state) ? 'idle' : state.mode,
          seekLockUntil: null,
        },
        commands,
      }

    case 'SEEK_PREVIEW': {
      const nextState = event.segId && event.segId !== state.activeSegId
        ? { ...state, activeSegId: event.segId }
        : state
      if (
        event.segId &&
        event.segId !== state.activeSegId &&
        state.resumeModeAfterSeek === 'following' &&
        !isBlocked(nextState)
      ) {
        commands.push({ type: 'ENSURE_ACTIVE_VISIBLE' })
      }
      return { state: nextState, commands }
    }

    case 'SEEK_COMMITTED': {
      const nextState = {
        ...state,
        activeSegId: event.segId ?? state.activeSegId,
        mode: state.resumeModeAfterSeek ?? 'idle',
        resumeModeAfterSeek: null,
        seekLockUntil: event.lockSeekUntil === undefined ? state.seekLockUntil : event.lockSeekUntil,
      }
      if (nextState.mode === 'following' && nextState.activeSegId && !isBlocked(nextState)) {
        commands.push({ type: 'ENSURE_ACTIVE_VISIBLE' })
      }
      return { state: nextState, commands }
    }

    case 'SEGMENT_SEEK': {
      const nextState = {
        ...state,
        activeSegId: event.segId,
        seekLockUntil: event.lockSeekUntil,
      }
      if (state.mode === 'following' && !isBlocked(nextState)) {
        commands.push({ type: 'SCROLL_TO_ACTIVE', behavior: 'smooth' })
      }
      return { state: nextState, commands }
    }

    case 'WORD_SEEK': {
      const nextState = {
        ...state,
        activeSegId: event.segId,
        seekLockUntil: event.lockSeekUntil,
      }
      return {
        state: nextState,
        commands,
      }
    }

    case 'FOLLOW_REQUESTED': {
      const nextState: ScrollSyncState = {
        ...state,
        mode: isBlocked(state) ? 'idle' : 'following',
        hasUserScrolled: false,
        resumeModeAfterSeek: null,
      }
      commands.push({ type: 'CLEAR_USER_SCROLLED' })
      if (!isBlocked(nextState)) {
        if (nextState.activeSegId) commands.push({ type: 'SCROLL_TO_ACTIVE', behavior: 'auto' })
        else commands.push({ type: 'SCROLL_TO_TOP', behavior: 'auto' })
      }
      return { state: nextState, commands }
    }

    case 'FOLLOW_SUSPENDED':
      return {
        state: {
          ...state,
          mode: 'idle',
          resumeModeAfterSeek: state.mode === 'seeking' ? 'idle' : null,
        },
        commands,
      }

    case 'EDIT_BLOCKED': {
      const nextState = {
        ...state,
        editBlocked: true,
      }
      if (nextState.mode === 'following') nextState.mode = 'idle'
      if (nextState.mode === 'seeking' && nextState.resumeModeAfterSeek === 'following') {
        nextState.resumeModeAfterSeek = 'idle'
      }
      return { state: nextState, commands }
    }

    case 'EDIT_UNBLOCKED':
      return {
        state: {
          ...state,
          editBlocked: false,
        },
        commands,
      }

    case 'POPOVER_BLOCKED': {
      const nextState = {
        ...state,
        popoverBlocked: true,
      }
      if (nextState.mode === 'following') nextState.mode = 'idle'
      if (nextState.mode === 'seeking' && nextState.resumeModeAfterSeek === 'following') {
        nextState.resumeModeAfterSeek = 'idle'
      }
      return { state: nextState, commands }
    }

    case 'POPOVER_UNBLOCKED':
      return {
        state: {
          ...state,
          popoverBlocked: false,
        },
        commands,
      }

    case 'RETURN_TO_TOP':
      commands.push({ type: 'CLEAR_USER_SCROLLED' }, { type: 'SCROLL_TO_TOP', behavior: 'auto' })
      return {
        state: {
          ...state,
          mode: 'idle',
          hasUserScrolled: false,
        },
        commands,
      }
  }
}
