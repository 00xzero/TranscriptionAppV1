import { act, renderHook } from '@testing-library/react'
import type { KeyboardEvent } from 'react'
import { useListboxKeys } from '@/lib/hooks/useListboxKeys'

const press = (keys: { onKeyDown: (event: KeyboardEvent<HTMLElement>) => void }, key: string) =>
  act(() => keys.onKeyDown({ key, preventDefault: () => {} } as KeyboardEvent<HTMLElement>))

const render = (options: string[]) => {
  const onChoose = jest.fn()
  const hook = renderHook(({ list }) => useListboxKeys(list, onChoose), { initialProps: { list: options } })
  return { ...hook, onChoose }
}

test('after the list shrinks under the highlight, Arrow Up moves from the last option at once', () => {
  const { result, rerender } = render(['a', 'b', 'c', 'd', 'e'])
  for (let i = 0; i < 4; i++) press(result.current, 'ArrowDown')
  expect(result.current.highlighted).toBe('e')

  rerender({ list: ['a', 'b', 'c'] })
  expect(result.current.highlighted).toBe('c')
  press(result.current, 'ArrowUp')
  expect(result.current.highlighted).toBe('b')
})

test('arrows on an empty list leave the first option highlighted once options come', () => {
  const { result, rerender, onChoose } = render([])
  press(result.current, 'ArrowDown')
  rerender({ list: ['a', 'b'] })
  expect(result.current.highlighted).toBe('a')
  press(result.current, 'Enter')
  expect(onChoose).toHaveBeenCalledWith('a')
})
