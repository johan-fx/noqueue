import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import {
  defaultAssignmentSeating,
  type ServiceInput,
  type StaffEntry,
} from '@noqueue/contracts/staff'
import { AssignmentOptions } from './AssignmentOptions'
afterEach(cleanup)
const config = {
  type: 'restaurant',
  spaces: [
    {
      id: 'room',
      name: 'Interior',
      tables: 2,
      tableTypes: [
        { seats: 3, count: 1 },
        { seats: 4, count: 1 },
      ],
    },
    {
      id: 'terrace',
      name: 'Terraza',
      tables: 1,
      tableTypes: [{ seats: 4, count: 1 }],
    },
    {
      id: 'bar',
      name: 'Barra',
      tables: 1,
      tableTypes: [{ seats: 1, count: 1 }],
    },
  ],
} as ServiceInput
function Harness({
  party = { partySize: 2, preferredSpaceId: 'room' },
  service = config,
}: {
  party?: Pick<StaffEntry, 'partySize' | 'preferredSpaceId'>
  service?: ServiceInput
}) {
  const [seating, setSeating] = useState(() =>
    defaultAssignmentSeating(service, party),
  )
  return (
    <AssignmentOptions
      config={service}
      party={party}
      seating={seating}
      onChange={setSeating}
      disabled={false}
    />
  )
}
it('uses single-choice accessible buttons and separates table size from party size', () => {
  render(<Harness />)
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Interior' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const four = screen.getByRole('button', { name: 'Mesa para 4 personas' })
  expect(
    screen.getByRole('button', { name: 'Mesa para 3 personas' }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(
    screen.queryByRole('button', { name: 'Barra' }),
  ).not.toBeInTheDocument()
  fireEvent.click(four)
  expect(four).toHaveAttribute('aria-pressed', 'true')
  expect(
    screen.getByRole('button', { name: 'Mesa para 3 personas' }),
  ).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(screen.getByRole('button', { name: 'Terraza' }))
  expect(screen.queryByRole('group', { name: 'Mesa para' })).not.toBeInTheDocument()
  expect(screen.getByText('Mesa para 4')).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent(
    'El cliente pidió Interior',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Interior' }))
  expect(
    screen.getByRole('button', { name: 'Mesa para 4 personas' }),
  ).toHaveAttribute('aria-pressed', 'true')
})
it('starts with the best fit and still allows an explicit space change outside the warning', () => {
  render(<Harness party={{ partySize: 2 }} />)
  expect(
    screen.getByRole('button', { name: 'Interior' }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(
    screen.getByRole('button', { name: 'Mesa para 3 personas' }),
  ).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Terraza' }))
  expect(screen.queryByRole('group', { name: 'Mesa para' })).not.toBeInTheDocument()
  expect(screen.getByText('Mesa para 4')).toBeVisible()
})
it('does not silently replace an invalidated selection or save while viewing options', () => {
  const onChange = vi.fn()
  render(
    <AssignmentOptions
      config={config}
      party={{ partySize: 4 }}
      seating={{ mode: 'confirmed', spaceId: 'room', seats: 3 }}
      onChange={onChange}
      disabled={false}
    />,
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Las opciones han cambiado',
  )
  expect(screen.queryByRole('button', { name: 'Mesa para 4 personas' })).not.toBeInTheDocument()
  expect(screen.queryByText('Mesa para 4')).not.toBeInTheDocument()
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Revisar asignación' }))
  expect(onChange).toHaveBeenCalledWith({ mode: 'confirmed', spaceId: 'room', seats: 4 })
})

it('summarizes a unique compatible space and capacity without selection controls', () => {
  render(<Harness service={{ ...config, spaces: [config.spaces[1]!, config.spaces[2]!] }} />)
  expect(screen.getByText('Terraza · Mesa para 4')).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.queryByRole('group')).not.toBeInTheDocument()
})
it('shows a unique space as text while keeping multiple capacities selectable', () => {
  render(<Harness service={{ ...config, spaces: [config.spaces[0]!] }} />)
  expect(screen.getByText('Interior')).toBeVisible()
  expect(screen.queryByRole('group', { name: 'Espacio' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('button')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Mesa para 4 personas' }))
  expect(screen.getByRole('button', { name: 'Mesa para 4 personas' })).toHaveAttribute('aria-pressed', 'true')
})
it('requires explicit review if the selected space disappears leaving a single combination', () => {
  const onChange = vi.fn()
  const props = {
    config: { ...config, spaces: [config.spaces[1]!] },
    party: { partySize: 2 },
    seating: { mode: 'confirmed' as const, spaceId: 'room', seats: 3 },
    onChange,
    disabled: true,
  }
  const { rerender } = render(<AssignmentOptions {...props} />)
  expect(screen.getByRole('alert')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Revisar asignación' })).toBeDisabled()
  expect(onChange).not.toHaveBeenCalled()
  rerender(<AssignmentOptions {...props} disabled={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Revisar asignación' }))
  expect(onChange).toHaveBeenCalledWith({ mode: 'confirmed', spaceId: 'terrace', seats: 4 })
})
it('keeps the exception informative when no compatible table is configured', () => {
  render(<Harness party={{ partySize: 5 }} />)
  expect(screen.getByText(/No hay tipos de mesa configurados/)).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('can review an unselected space when a catalogue refresh leaves only one option', () => {
  const onChange = vi.fn()
  render(
    <AssignmentOptions
      config={{ ...config, spaces: [config.spaces[1]!] }}
      party={{ partySize: 2 }}
      seating={null}
      onChange={onChange}
      disabled={false}
    />,
  )
  expect(screen.queryByText('Elige el espacio para ver las capacidades.')).not.toBeInTheDocument()
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Revisar asignación' }))
  expect(onChange).toHaveBeenCalledWith({
    mode: 'confirmed',
    spaceId: 'terrace',
    seats: 4,
  })
})
