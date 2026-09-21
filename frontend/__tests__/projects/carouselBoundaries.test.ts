import { carouselBoundaries } from '@/components/Projects/RecentProjectsCarousel'

describe('carouselBoundaries', () => {
  test('reports a track that fits as both ends at once', () => {
    expect(carouselBoundaries({ scrollLeft: 0, clientWidth: 800, scrollWidth: 800 })).toEqual({
      fits: true,
      atStart: true,
      atEnd: true,
    })
  })

  test('reports the start of an overflowing track', () => {
    expect(carouselBoundaries({ scrollLeft: 0, clientWidth: 800, scrollWidth: 2000 })).toEqual({
      fits: false,
      atStart: true,
      atEnd: false,
    })
  })

  test('reports the middle of an overflowing track', () => {
    expect(carouselBoundaries({ scrollLeft: 600, clientWidth: 800, scrollWidth: 2000 })).toEqual({
      fits: false,
      atStart: false,
      atEnd: false,
    })
  })

  test('reports the end of an overflowing track', () => {
    expect(carouselBoundaries({ scrollLeft: 1200, clientWidth: 800, scrollWidth: 2000 })).toEqual({
      fits: false,
      atStart: false,
      atEnd: true,
    })
  })

  test('absorbs sub-pixel scroll offsets at either end', () => {
    expect(
      carouselBoundaries({ scrollLeft: 0.4, clientWidth: 800, scrollWidth: 2000 }).atStart
    ).toBe(true)
    expect(
      carouselBoundaries({ scrollLeft: 1199.6, clientWidth: 800, scrollWidth: 2000 }).atEnd
    ).toBe(true)
  })

  test('treats an unmeasured track as fitting rather than as an empty scroller', () => {
    expect(carouselBoundaries({ scrollLeft: 0, clientWidth: 0, scrollWidth: 0 }).fits).toBe(true)
  })
})
