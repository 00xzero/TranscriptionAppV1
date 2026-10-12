import { formatClockTime, formatElapsedTime } from '@/lib/utils'

describe('shared clock formatting', () => {
  test.each([
    [0, '00:00:00'], [59, '00:00:59'], [60, '00:01:00'],
    [3600, '01:00:00'], [3661, '01:01:01'], [360000, '100:00:00'],
  ])('formats %s seconds with hours', (seconds, expected) => {
    expect(formatClockTime(seconds, 'always')).toBe(expected)
    expect(formatElapsedTime(seconds * 1000)).toBe(expected)
  })

  test.each([[-1], [NaN], [Infinity], [-Infinity]])('normalizes invalid time %s', (time) => {
    expect(formatClockTime(time, 'always')).toBe('00:00:00')
    expect(formatElapsedTime(time)).toBe('00:00:00')
  })

  test('floors milliseconds and preserves the distinct clock modes', () => {
    expect(formatElapsedTime(1500)).toBe('00:00:01')
    expect(formatElapsedTime(999)).toBe('00:00:00')
    expect(formatClockTime(3661)).toBe('1:01:01')
    expect(formatClockTime(3661, 'never')).toBe('61:01')
  })
})
