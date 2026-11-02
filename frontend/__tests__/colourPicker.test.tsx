import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ColourPicker } from '@/components/ColourPicker'

const DENIM = '#4F638C'
const TEAL = '#0D9488'

test('follows the current colour when it changes while open, and can choose the old one again', async () => {
  const user = userEvent.setup()
  const onChoose = jest.fn().mockResolvedValue(undefined)
  const { rerender } = render(<ColourPicker current={DENIM} onChoose={onChoose} />)
  expect(screen.getByRole('radio', { name: 'Denim' })).toBeChecked()

  // Changed elsewhere: a reload brings the new colour in.
  rerender(<ColourPicker current={TEAL} onChoose={onChoose} />)
  expect(screen.getByRole('radio', { name: 'Teal' })).toBeChecked()
  await user.click(screen.getByRole('radio', { name: 'Denim' }))
  expect(onChoose).toHaveBeenCalledWith(DENIM)
})

test('a refused choice goes back to the current colour and says why', async () => {
  const user = userEvent.setup()
  const onChoose = jest.fn().mockRejectedValue(new Error('nope'))
  render(<ColourPicker current={DENIM} onChoose={onChoose} describeError={() => 'Couldn’t change the colour.'} />)
  await user.click(screen.getByRole('radio', { name: 'Teal' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t change the colour.')
  await waitFor(() => expect(screen.getByRole('radio', { name: 'Denim' })).toBeChecked())
})
