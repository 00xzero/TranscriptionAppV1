import {
  AUTO_STOP_HEADROOM_FRACTION,
  shouldAutoStop,
} from '@/lib/recording/sizeBudget'

describe('recording size budget', () => {
  test('auto-stops before the hard upload limit to preserve final-chunk headroom', () => {
    const maxBytes = 10_000
    const threshold = maxBytes * AUTO_STOP_HEADROOM_FRACTION

    expect(shouldAutoStop(threshold - 1, maxBytes)).toBe(false)
    expect(shouldAutoStop(threshold, maxBytes)).toBe(true)
    expect(threshold).toBeLessThan(maxBytes)
  })
})
