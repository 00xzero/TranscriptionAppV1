import React from 'react'
import { render, screen } from '@testing-library/react'
import { PopoverFrozenWhileClosed } from '@/components/ui/popover'

test('closing keeps the last content, reopening shows the new content', () => {
  const { rerender } = render(<PopoverFrozenWhileClosed open><p>Speaker 1</p></PopoverFrozenWhileClosed>)
  rerender(<PopoverFrozenWhileClosed open={false}><p>Unknown speaker</p></PopoverFrozenWhileClosed>)
  expect(screen.getByText('Speaker 1')).toBeInTheDocument()
  rerender(<PopoverFrozenWhileClosed open><p>Speaker 2</p></PopoverFrozenWhileClosed>)
  expect(screen.getByText('Speaker 2')).toBeInTheDocument()
})
