import React from 'react'

export const scrollToIndexMock = jest.fn()
export const scrollToMock = jest.fn()
export const rangeChangedMock = jest.fn()

/**
 * Test mock for react-virtuoso. Renders all items directly without virtualization
 * so JSDOM tests can find segment-card elements.
 */
export function Virtuoso(
  { ref, data, itemContent, rangeChanged, ...rest }: any
) {
  React.useEffect(() => {
    const defaultRange = { startIndex: 0, endIndex: Math.max(0, (data?.length ?? 1) - 1) }
    rangeChangedMock(defaultRange)
    rangeChanged?.(defaultRange)
  }, [data, rangeChanged])

  React.useImperativeHandle(ref, () => ({
    scrollToIndex: scrollToIndexMock,
    scrollTo: scrollToMock,
  }))

  return (
    <div data-testid="virtuoso-mock">
      {data?.map((item: any, index: number) => (
        <div key={index}>{itemContent(index, item)}</div>
      ))}
    </div>
  )
}

export type VirtuosoHandle = {
  scrollToIndex: (args: any) => void
  scrollTo: (args: any) => void
}

export type ListRange = {
  startIndex: number
  endIndex: number
}
