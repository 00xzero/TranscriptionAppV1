import {
  clearIntervalIfRunning,
  setTickObserver,
  startIntervalIfNeeded,
} from '@/lib/recording/sessionStore'

describe('recording sessionStore tick observers', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    clearIntervalIfRunning()
  })

  afterEach(() => {
    clearIntervalIfRunning()
    jest.useRealTimers()
  })

  test('keyed tick observers replace prior registrations for the same key', () => {
    const first = jest.fn()
    const second = jest.fn()
    const removeFirst = setTickObserver('hmr-watchdog', first)
    const removeSecond = setTickObserver('hmr-watchdog', second)

    startIntervalIfNeeded()
    jest.advanceTimersByTime(1_000)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)

    removeFirst()
    jest.advanceTimersByTime(1_000)
    expect(second).toHaveBeenCalledTimes(2)

    removeSecond()
  })
})
