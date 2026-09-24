import React from 'react'

/**
 * jsdom has no Web Animations API and Jest cannot parse NumberFlow's ESM build,
 * so tests render the number as plain text; the rolling animation is visual only.
 */
export default function NumberFlow({ value }: { value: number }) {
  return <>{value}</>
}
