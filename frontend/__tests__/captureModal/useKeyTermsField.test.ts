import type React from 'react'
import { act, renderHook } from '@testing-library/react'
import { MAX_KEY_TERMS } from '@/contracts/api'
import { useKeyTermsField } from '@/lib/capture/useKeyTermsField'

const termsAtLimit = Array.from({ length: MAX_KEY_TERMS }, (_, index) => `term-${index}`)

function keyDown(key: string) {
  return { key, preventDefault: jest.fn() } as unknown as React.KeyboardEvent<HTMLInputElement>
}

function renderField(keyTerms: string[]) {
  const onKeyTermsChange = jest.fn()
  const { result } = renderHook(() => useKeyTermsField({ keyTerms, onKeyTermsChange }))
  return { result, onKeyTermsChange }
}

describe('useKeyTermsField', () => {
  test('adds terms and clears the input when within the limit', () => {
    const { result, onKeyTermsChange } = renderField(['alpha'])

    act(() => result.current.setKeyTermInput('beta, gamma'))
    act(() => result.current.handleAddTermClick())

    expect(onKeyTermsChange).toHaveBeenCalledWith(['alpha', 'beta', 'gamma'])
    expect(result.current.keyTermInput).toBe('')
    expect(result.current.keyTermsError).toBeNull()
  })

  test('keeps rejected input for editing when the Add button would exceed the limit', () => {
    const { result, onKeyTermsChange } = renderField(termsAtLimit)

    act(() => result.current.setKeyTermInput('one-too-many'))
    act(() => result.current.handleAddTermClick())

    expect(onKeyTermsChange).not.toHaveBeenCalled()
    expect(result.current.keyTermInput).toBe('one-too-many')
    expect(result.current.keyTermsError).toMatch(`exceed the ${MAX_KEY_TERMS}-term limit`)
  })

  test('keeps rejected input for editing when Enter would exceed the limit', () => {
    const { result, onKeyTermsChange } = renderField(termsAtLimit)

    act(() => result.current.setKeyTermInput('one-too-many'))
    act(() => result.current.handleKeyTermKeyDown(keyDown('Enter')))

    expect(onKeyTermsChange).not.toHaveBeenCalled()
    expect(result.current.keyTermInput).toBe('one-too-many')
    expect(result.current.keyTermsError).not.toBeNull()
  })

  test('clears whitespace-only input without reporting an error', () => {
    const { result, onKeyTermsChange } = renderField([])

    act(() => result.current.setKeyTermInput('  ,  '))
    act(() => result.current.handleKeyTermKeyDown(keyDown(',')))

    expect(onKeyTermsChange).not.toHaveBeenCalled()
    expect(result.current.keyTermInput).toBe('')
    expect(result.current.keyTermsError).toBeNull()
  })
})
