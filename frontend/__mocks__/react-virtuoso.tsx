import React from 'react'

/**
 * Test mock for react-virtuoso. Renders all items directly without virtualization
 * so JSDOM tests can find segment-card elements.
 */
export const Virtuoso = React.forwardRef(function VirtuosoMock(
  { data, itemContent, ...rest }: any,
  ref: any
) {
  React.useImperativeHandle(ref, () => ({
    scrollToIndex: () => {},
    scrollTo: () => {},
  }))

  return (
    <div data-testid="virtuoso-mock">
      {data?.map((item: any, index: number) => (
        <div key={index}>{itemContent(index, item)}</div>
      ))}
    </div>
  )
})

export type VirtuosoHandle = {
  scrollToIndex: (args: any) => void
  scrollTo: (args: any) => void
}

export type ListRange = {
  startIndex: number
  endIndex: number
}
