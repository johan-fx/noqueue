import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { RestaurantForm } from './RestaurantForm'
import { TurnView } from './TurnView'
import type { Entry, PublicService } from '@noqueue/contracts/queue'
const service: PublicService = {
  id: 'restaurant',
  name: 'Restaurante',
  venueId: 'venue',
  venueName: 'Hotel',
  type: 'restaurant',
  open: 1,
  receptionServices: [],
  spaces: [
    { id: 'bar', name: 'Barra', maxPartySize: 2 },
    { id: 'terrace', name: 'Terraza', maxPartySize: 8 },
  ],
}
afterEach(cleanup)
it('requires a name and shares compatible group/space selection for editing', async () => {
  const submit = vi.fn().mockRejectedValue(new Error('No se pudo guardar'))
  render(<RestaurantForm service={service} locale="es" onSubmit={submit} />)
  fireEvent.change(screen.getByLabelText('Nombre'), {
    target: { value: 'María' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Más comensales' }))
  fireEvent.click(screen.getByRole('button', { name: 'Más comensales' }))
  expect(screen.getByRole('radio', { name: 'Barra' })).toBeDisabled()
  fireEvent.click(screen.getByRole('radio', { name: 'Terraza' }))
  fireEvent.click(screen.getByRole('button', { name: 'Ponerme en lista' }))
  await waitFor(() => expect(submit).toHaveBeenCalled())
  expect(submit.mock.calls[0]![0]).toMatchObject({
    displayName: 'María',
    partySize: 3,
    preferredSpaceId: 'terrace',
    locale: 'es',
  })
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No se pudo guardar',
  )
  expect(screen.getByLabelText('Nombre')).toHaveValue('María')
})
function entry(phase: NonNullable<Entry['customer']>['phase']): Entry {
  return {
    code: 'XP03',
    position: 6,
    etaMinutes: 0,
    estimateQuality: 'unknown',
    status: phase === 'arrived' ? 'served' : 'waiting',
    notification: 'disabled',
    customer: {
      service,
      displayName: 'María',
      partySize: 4,
      preferredSpaceId: 'terrace',
      locale: 'es',
      version: 0,
      serverNow: 1000,
      createdAt: 100,
      calledAt: null,
      arrivalDeadlineAt: null,
      arrivedAt: phase === 'arrived' ? 500 : null,
      phase,
      actions: ['cancel', 'update'],
    },
  }
}
it('shows unknown estimates honestly and renders a noninteractive stepper', () => {
  render(
    <MemoryRouter>
      <TurnView
        entry={entry('waiting')}
        locale="es"
        now={1000}
        updatedAt={1000}
        onAction={vi.fn()}
      />
    </MemoryRouter>,
  )
  expect(screen.getByText('Espera pendiente de datos')).toBeVisible()
  expect(screen.getByText('5 turnos')).toBeVisible()
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
})
it('retains confirmed arrival for a served turn', () => {
  render(
    <MemoryRouter>
      <TurnView
        entry={entry('arrived')}
        locale="es"
        now={1000}
        updatedAt={1000}
        onAction={vi.fn()}
      />
    </MemoryRouter>,
  )
  expect(screen.getByText('Se ha confirmado tu llegada')).toBeVisible()
  expect(screen.getByText(/Hora de llegada/)).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Confirmar llegada' }),
  ).not.toBeInTheDocument()
})
