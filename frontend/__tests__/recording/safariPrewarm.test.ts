import { isSafariBrowser } from '@/lib/recording/safariPrewarm'

describe('Safari microphone prewarm detection', () => {
  test('matches Safari with an Apple vendor', () => {
    expect(
      isSafariBrowser(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
        'Apple Computer, Inc.'
      )
    ).toBe(true)
  })

  test('does not match Chrome-family browsers', () => {
    expect(
      isSafariBrowser(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Google Inc.'
      )
    ).toBe(false)
  })
})
