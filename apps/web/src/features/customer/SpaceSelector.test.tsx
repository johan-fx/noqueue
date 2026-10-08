import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PublicService } from '@noqueue/contracts/queue'
import { SpaceSelector } from './SpaceSelector'

afterEach(cleanup)

it('uses an accessible radio group and disables spaces that cannot fit the party', () => {
  const onChange = vi.fn()
  const service = {
    id: 'restaurant',
    name: 'Restaurant',
    venueName: 'Hotel',
    type: 'restaurant',
    open: 1,
    receptionServices: [],
    spaces: [
      { id: 'terrace', name: 'Terrace', maxPartySize: 4 },
      { id: 'vip', name: 'VIP', maxPartySize: 2 },
    ],
  } as PublicService

  render(
    <SpaceSelector
      service={service}
      locale="en"
      size={3}
      value="terrace"
      onChange={onChange}
    />,
  )

  const group = screen.getByRole('radiogroup', {
    name: 'Where would you like your table?',
  })
  expect(group).toHaveAttribute('data-slot', 'radio-group')
  expect(screen.getByRole('radio', { name: 'Terrace' })).toBeChecked()
  const vip = screen.getByRole('radio', { name: 'VIP' })
  expect(vip).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('radio', { name: 'Fastest option' })).toBeEnabled()

  fireEvent.click(vip)
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('radio', { name: 'Fastest option' }))
  expect(onChange).toHaveBeenCalledWith('fastest')
})
