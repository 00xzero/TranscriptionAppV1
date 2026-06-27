import React from 'react'
import { render } from '@testing-library/react'
import { useBeforeUnloadGuard } from '@/lib/recording/useBeforeUnloadGuard'

function Harness({ active }: { active: boolean }) {
  useBeforeUnloadGuard(active)
  return null
}

// Phase 3: the beforeunload guard is app-level (installed in
// RecordingSessionProvider via this hook) so it survives navigation away from
// /recording/new and stays through upload completion.
describe('useBeforeUnloadGuard', () => {
  test('installs a beforeunload listener while active', () => {
    const addSpy = jest.spyOn(window, 'addEventListener')
    render(<Harness active={true} />)
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
    addSpy.mockRestore()
  })

  test('does not install a listener while inactive', () => {
    const addSpy = jest.spyOn(window, 'addEventListener')
    render(<Harness active={false} />)
    expect(addSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function))
    addSpy.mockRestore()
  })

  test('removes the listener when activity ends', () => {
    const removeSpy = jest.spyOn(window, 'removeEventListener')
    const { rerender } = render(<Harness active={true} />)
    rerender(<Harness active={false} />)
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
    removeSpy.mockRestore()
  })
})
