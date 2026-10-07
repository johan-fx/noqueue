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
  expect(screen.getByText('Sin estimación')).toBeVisible()
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

it.each(['reception', 'pool'] as const)(
  'uses %s arrival copy and only projected customer actions',
  (type) => {
    const turn = entry('called')
    turn.customer!.service = { ...service, type, name: 'Atención' }
    turn.customer!.actions = []
    turn.customer!.arrivalDeadlineAt = 121000
    const view = render(
      <TurnView
        entry={turn}
        locale="es"
        now={1000}
        updatedAt={1000}
        onAction={vi.fn()}
      />,
    )
    expect(
      screen.getByText(
        'Acércate a Atención. El personal confirmará tu llegada.',
      ),
    ).toBeVisible()
    expect(screen.getByText('2:00')).toBeVisible()
    turn.customer!.phase = 'arrived'
    view.rerender(
      <TurnView
        entry={turn}
        locale="es"
        now={1000}
        updatedAt={1000}
        onAction={vi.fn()}
      />,
    )
    expect(screen.queryByText('Mesa asignada')).not.toBeInTheDocument()
    turn.customer!.phase = 'approaching'
    view.rerender(
      <TurnView
        entry={turn}
        locale="es"
        now={1000}
        updatedAt={1000}
        onAction={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Puedes pasar turno o abandonar la lista.'),
    ).not.toBeInTheDocument()
  },
)
it.each(['es', 'en'] as const)('explains automatic service cancellation without blaming the customer (%s)', (locale) => {
  const turn = entry('cancelled')
  turn.status = 'cancelled'
  Object.assign(turn.customer!, { cancellationReason: 'service_ended', actions: [] })
  render(<MemoryRouter><TurnView entry={turn} locale={locale} now={1000} updatedAt={1000} onAction={vi.fn()} /></MemoryRouter>)
  expect(screen.getByText(locale === 'es' ? 'El servicio ha finalizado' : 'Service has ended')).toBeVisible()
  expect(screen.queryByText(locale === 'es' ? 'Has abandonado la lista' : 'You have left the waiting list')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: locale === 'es' ? 'Seleccionar lista de espera' : 'Choose a waiting list' })).toBeVisible()
})

it.each(['es', 'en'] as const)(
  'renders the voluntary restaurant exit without turn details (%s)',
  (locale) => {
    const turn = entry('cancelled')
    turn.status = 'cancelled'
    turn.customer!.actions = []
    render(
      <MemoryRouter>
        <TurnView
          entry={turn}
          locale={locale}
          now={1000}
          updatedAt={1000}
          onAction={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', {
        name:
          locale === 'es'
            ? 'Ya no estás en la lista de espera'
            : 'You are no longer on the waiting list',
      }),
    ).toBeVisible()
    expect(screen.queryByText('XP03')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Última actualización|Last update/),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  },
)

it.each(['es', 'en'] as const)(
  'keeps authoritative phase and yield feedback above the footer (%s)',
  (locale) => {
    const turn = entry('approaching')
    render(
      <MemoryRouter>
        <TurnView
          entry={turn}
          locale={locale}
          now={1000}
          updatedAt={1000}
          {...{ yielded: true }}
          onAction={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(
      screen.getByText(
        locale === 'es' ? 'Has pasado turno' : 'You have yielded your turn',
      ),
    ).toBeVisible()
    expect(
      screen.getByText(
        locale === 'es' ? 'Ya casi es tu turno' : 'It is almost your turn',
      ),
    ).toBeVisible()
  },
)
it.each(['called', 'arrived', 'expired', 'cancelled'] as const)(
  'suppresses previous yield feedback in %s',
  (phase) => {
    render(
      <MemoryRouter>
        <TurnView
          entry={entry(phase)}
          locale="es"
          now={1000}
          updatedAt={1000}
          {...{ yielded: true }}
          onAction={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByText('Has pasado turno')).not.toBeInTheDocument()
  },
)
