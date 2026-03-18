import {
  createInitialScrollSyncState,
  transitionScrollSyncState,
} from '@/app/editor/[id]/hooks/scrollSyncMachine'

describe('scrollSyncMachine', () => {
  it('moves from following to userScrolling on user scroll', () => {
    const { state } = transitionScrollSyncState(createInitialScrollSyncState(), {
      type: 'USER_SCROLL',
      now: 100,
    })

    expect(state.mode).toBe('userScrolling')
    expect(state.hasUserScrolled).toBe(true)
  })

  it('stores the previous mode when seeking starts from following', () => {
    const { state } = transitionScrollSyncState(createInitialScrollSyncState(), {
      type: 'SEEK_STARTED',
      now: 100,
    })

    expect(state.mode).toBe('seeking')
    expect(state.resumeModeAfterSeek).toBe('following')
  })

  it('stores idle as the previous mode when seeking starts from idle', () => {
    const suspended = transitionScrollSyncState(createInitialScrollSyncState(), {
      type: 'FOLLOW_SUSPENDED',
      now: 100,
    }).state

    const { state } = transitionScrollSyncState(suspended, {
      type: 'SEEK_STARTED',
      now: 120,
    })

    expect(state.mode).toBe('seeking')
    expect(state.resumeModeAfterSeek).toBe('idle')
  })

  it('returns to the previous mode when a seek commits', () => {
    const seeking = transitionScrollSyncState(createInitialScrollSyncState(), {
      type: 'SEEK_STARTED',
      now: 100,
    }).state

    const { state, commands } = transitionScrollSyncState(seeking, {
      type: 'SEEK_COMMITTED',
      now: 150,
      segId: 's1',
      lockSeekUntil: 3150,
    })

    expect(state.mode).toBe('following')
    expect(state.activeSegId).toBe('s1')
    expect(commands).toContainEqual({ type: 'ENSURE_ACTIVE_VISIBLE' })
  })

  it('suspends follow without counting as user scroll', () => {
    const { state } = transitionScrollSyncState(createInitialScrollSyncState(), {
      type: 'FOLLOW_SUSPENDED',
      now: 100,
      reason: 'search',
    })

    expect(state.mode).toBe('idle')
    expect(state.hasUserScrolled).toBe(false)
  })

  it('preserves prior manual-scroll state when follow is suspended for search', () => {
    const scrolled = transitionScrollSyncState(createInitialScrollSyncState(), {
      type: 'USER_SCROLL',
      now: 100,
    }).state

    const { state } = transitionScrollSyncState(scrolled, {
      type: 'FOLLOW_SUSPENDED',
      now: 150,
      reason: 'search',
    })

    expect(state.mode).toBe('idle')
    expect(state.hasUserScrolled).toBe(true)
  })

  it('does not resume follow after a seek commits if follow was suspended mid-seek', () => {
    const seeking = transitionScrollSyncState(createInitialScrollSyncState(), {
      type: 'SEEK_STARTED',
      now: 100,
    }).state

    const suspended = transitionScrollSyncState(seeking, {
      type: 'FOLLOW_SUSPENDED',
      now: 120,
      reason: 'search',
    }).state

    const { state, commands } = transitionScrollSyncState(suspended, {
      type: 'SEEK_COMMITTED',
      now: 150,
      segId: 's1',
      lockSeekUntil: 3150,
    })

    expect(state.mode).toBe('idle')
    expect(commands).not.toContainEqual({ type: 'ENSURE_ACTIVE_VISIBLE' })
  })

  it('returns to idle and emits scroll-to-top on return to top', () => {
    const { state, commands } = transitionScrollSyncState(createInitialScrollSyncState(), {
      type: 'RETURN_TO_TOP',
      now: 100,
    })

    expect(state.mode).toBe('idle')
    expect(commands).toContainEqual({ type: 'SCROLL_TO_TOP', behavior: 'auto' })
  })

  it('suppresses audio tick updates while seek lock is active', () => {
    const locked = transitionScrollSyncState(createInitialScrollSyncState(), {
      type: 'SEGMENT_SEEK',
      now: 100,
      segId: 's1',
      lockSeekUntil: 3100,
    }).state

    const { state } = transitionScrollSyncState(locked, {
      type: 'AUDIO_TICK',
      now: 500,
      segId: 's2',
    })

    expect(state.activeSegId).toBe('s1')
  })

  it('clears an existing seek lock when a committed seek requests lockSeek=false', () => {
    const locked = transitionScrollSyncState(createInitialScrollSyncState(), {
      type: 'SEGMENT_SEEK',
      now: 100,
      segId: 's1',
      lockSeekUntil: 3100,
    }).state

    const { state } = transitionScrollSyncState(locked, {
      type: 'SEEK_COMMITTED',
      now: 150,
      segId: 's2',
      lockSeekUntil: null,
    })

    expect(state.seekLockUntil).toBeNull()
    expect(state.activeSegId).toBe('s2')
  })

  it('does not auto-resume follow mode when edit blocking ends', () => {
    const blocked = transitionScrollSyncState(createInitialScrollSyncState(), {
      type: 'EDIT_BLOCKED',
      now: 100,
    }).state

    expect(blocked.mode).toBe('idle')

    const { state } = transitionScrollSyncState(blocked, {
      type: 'EDIT_UNBLOCKED',
      now: 200,
    })

    expect(state.mode).toBe('idle')
    expect(state.editBlocked).toBe(false)
  })

  it('does not auto-resume follow mode when popover blocking ends', () => {
    const blocked = transitionScrollSyncState(createInitialScrollSyncState(), {
      type: 'POPOVER_BLOCKED',
      now: 100,
    }).state

    expect(blocked.mode).toBe('idle')

    const { state } = transitionScrollSyncState(blocked, {
      type: 'POPOVER_UNBLOCKED',
      now: 200,
    })

    expect(state.mode).toBe('idle')
    expect(state.popoverBlocked).toBe(false)
  })

  it('clears expired programmatic scroll suppression timestamps during later events', () => {
    const suppressed = transitionScrollSyncState(createInitialScrollSyncState(), {
      type: 'PROGRAMMATIC_SCROLL_STARTED',
      now: 100,
      until: 350,
    }).state

    const { state } = transitionScrollSyncState(suppressed, {
      type: 'USER_SCROLL',
      now: 400,
    })

    expect(state.programmaticScrollUntil).toBeNull()
    expect(state.mode).toBe('userScrolling')
  })
})
