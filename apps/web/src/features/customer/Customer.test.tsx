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
  fireEvent.change(
    screen.getByLabelText('Teléfono'),
    { target: { value: '+34600000000' } },
  )
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Más comensales' }))
  fireEvent.click(screen.getByRole('button', { name: 'Más comensales' }))
  expect(screen.getByRole('radio', { name: 'Barra' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
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
it('keeps the same progress ratio while the server phase controls its color', () => {
  const turn: Entry = {
    ...entry('waiting'),
    estimateQuality: 'estimated',
    etaMinutes: 10,
    initialEtaMinutes: 20,
    predictedAt: 601000,
  }
  const view = () => (
    <MemoryRouter>
      <TurnView
        entry={turn}
        locale="en"
        now={1000}
        updatedAt={1000}
        onAction={vi.fn()}
      />
    </MemoryRouter>
  )
  const { container, rerender } = render(view())
  const progressbar = screen.getByRole('progressbar')
  expect(progressbar).toHaveClass('text-black')
  const arc = () => container.querySelector('circle[stroke="currentColor"]')!
  const ratio = () => {
    const [length, circumference] = arc()
      .getAttribute('stroke-dasharray')!
      .split(' ')
      .map(Number)
    return length! / circumference!
  }
  expect(ratio()).toBeCloseTo(0.5)

  turn.customer!.phase = 'approaching'
  rerender(view())
  expect(screen.getByRole('progressbar')).toHaveClass('text-orange-500')
  expect(ratio()).toBeCloseTo(0.5)
})
it.each([
  ['called', 'text-red-700'],
  ['expired', 'text-red-700'],
  ['arrived', 'text-green-600'],
] as const)('preserves %s ring color', (phase, color) => {
  render(
    <MemoryRouter>
      <TurnView
        entry={entry(phase)}
        locale="en"
        now={1000}
        updatedAt={1000}
        onAction={vi.fn()}
      />
    </MemoryRouter>,
  )
  expect(screen.getByRole('progressbar')).toHaveClass(color)
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

it('offers a called-turn yield only when the projected action is allowed', () => {
  const turn = entry('called')
  turn.customer!.actions = ['cancel', 'yield']
  const onAction = vi.fn()
  render(
    <MemoryRouter>
      <TurnView
        entry={turn}
        locale="es"
        now={1000}
        updatedAt={1000}
        onAction={onAction}
      />
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Pasar turno' }))
  expect(onAction).toHaveBeenCalledWith('yield')
})

it('keeps reception waiting actions from showing both yield and edit', () => {
  const turn = entry('waiting')
  turn.customer!.service = { ...service, type: 'reception', name: 'Recepción' }
  turn.customer!.actions = ['cancel', 'update', 'yield']
  render(
    <MemoryRouter>
      <TurnView
        entry={turn}
        locale="es"
        now={1000}
        updatedAt={1000}
        onAction={vi.fn()}
      />
    </MemoryRouter>,
  )

  expect(screen.getByRole('button', { name: 'Pasar turno' })).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Modificar' }),
  ).not.toBeInTheDocument()
})
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

it.each(['reception', 'pool'] as const)(
  'offers direct yield and shared feedback for %s without modification',
  (type) => {
    const turn = entry('waiting')
    turn.customer!.service = { ...service, type, spaces: [] }
    turn.customer!.actions = ['cancel', 'yield']
    const action = vi.fn()
    const { rerender } = render(
      <MemoryRouter>
        <TurnView
          entry={turn}
          locale="es"
          now={1000}
          updatedAt={1000}
          yielded
          onAction={action}
        />
      </MemoryRouter>,
    )
    expect(
      screen.queryByRole('button', { name: 'Modificar' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pasar turno' }))
    expect(action).toHaveBeenCalledWith('yield')
    expect(screen.getByText('Has pasado turno')).toBeVisible()
    turn.customer!.phase = 'cancelled'
    rerender(
      <MemoryRouter>
        <TurnView
          entry={turn}
          locale="es"
          now={1000}
          updatedAt={1000}
          onAction={action}
        />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', {
        name: 'Ya no estás en la lista de espera',
      }),
    ).toBeVisible()
  },
)

it('uses one temporal baseline through waiting, delay, call and arrival', () => {
  const current: Entry = {
    ...entry('waiting'),
    etaMinutes: 50,
    estimateQuality: 'estimated',
    initialEtaMinutes: 50,
    predictedAt: 3001000,
  }
  const view = (now = 1000) => (
    <MemoryRouter>
      <TurnView
        entry={current}
        locale="en"
        now={now}
        updatedAt={1000}
        onAction={vi.fn()}
      />
    </MemoryRouter>
  )
  const { rerender, container } = render(view())
  const ring = () => screen.getByRole('progressbar')
  const arc = () => container.querySelector('circle[stroke="currentColor"]')
  expect(ring()).toHaveAccessibleName('Estimated wait: 50:00 (minutes:seconds)')
  expect(ring()).toHaveAttribute('aria-valuenow', '0')
  expect(arc()).toBeNull()
  for (const [remaining, percentage] of [
    [25, 50],
    [40, 20],
    [10, 80],
  ]) {
    current.etaMinutes = remaining!
    current.predictedAt = 1000 + remaining! * 60000
    current.customer!.phase = remaining === 10 ? 'approaching' : 'waiting'
    rerender(view())
    expect(ring()).toHaveAttribute('aria-valuenow', String(percentage))
    const [length, circumference] = arc()!
      .getAttribute('stroke-dasharray')!
      .split(' ')
      .map(Number)
    expect(length! / circumference!).toBeCloseTo(percentage! / 100)
    expect(screen.getByText(`${remaining}:00`, { exact: true })).toBeVisible()
  }
  expect(ring()).toHaveClass('text-orange-500')
  current.customer!.phase = 'called'
  current.customer!.calledAt = 1000
  current.customer!.arrivalDeadlineAt = 301000
  current.estimateQuality = 'unknown'
  for (const [now, percentage, countdown] of [
    [1000, 90, '5:00'],
    [181000, 96, '2:00'],
    [301000, 100, '0:00'],
  ] as const) {
    rerender(view(now))
    expect(ring()).toHaveAttribute('aria-valuenow', String(percentage))
    expect(ring()).toHaveClass('text-red-700')
    expect(screen.getByText(countdown as string, { exact: true })).toBeVisible()
  }
  expect(arc()).not.toHaveAttribute('stroke-dasharray')
  expect(
    screen.getByRole('heading', { name: 'It is your turn!' }),
  ).toBeVisible()
  current.customer!.phase = 'arrived'
  rerender(view())
  expect(ring()).toHaveAttribute('aria-valuenow', '100')
  expect(ring()).toHaveClass('text-green-600')
  expect(ring()).not.toHaveAttribute('aria-live')
})

it('keeps unknown progress track-only with no numeric ARIA value', () => {
  const { container } = render(
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
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
  expect(screen.getByRole('progressbar')).toHaveAttribute(
    'aria-valuetext',
    'Sin estimación disponible',
  )
  expect(container.querySelectorAll('circle')).toHaveLength(1)
})

it.each(['waiting', 'approaching'] as const)(
  'shows a continuous countdown during %s',
  (phase) => {
    const turn: Entry = {
      ...entry(phase),
      estimateQuality: 'estimated',
      etaMinutes: 30,
      initialEtaMinutes: 30,
      predictedAt: 1801000,
    }
    const view = (now: number) => (
      <MemoryRouter>
        <TurnView
          entry={turn}
          locale="es"
          now={now}
          updatedAt={1000}
          onAction={vi.fn()}
        />
      </MemoryRouter>
    )
    const { rerender, container } = render(view(1000))
    expect(screen.getByText('30:00')).toBeVisible()
    expect(screen.getByText(/minutos:segundos/)).toBeVisible()
    expect(screen.getByText(/aprox\./)).toBeVisible()
    rerender(view(2000))
    expect(screen.getByText('29:59')).toHaveClass(
      'tabular-nums',
      'whitespace-nowrap',
    )
    const arc = container.querySelector('circle[stroke="currentColor"]')!
    const [length, circumference] = arc
      .getAttribute('stroke-dasharray')!
      .split(' ')
      .map(Number)
    expect(length! / circumference!).toBeCloseTo(1 / 1800)
    expect(screen.getByRole('progressbar')).toHaveAccessibleName(
      'Espera aproximada: 29:59 (minutos:segundos)',
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Espera aproximada: 29:59 (minutos:segundos). Progreso de la espera: 0%',
    )
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-live')
    turn.predictedAt = 1000
    rerender(view(2000))
    expect(screen.getByText('0:00')).toBeVisible()
    expect(turn.customer!.phase).toBe(phase)
  },
)
it.each([
  [5406000, '90:05'],
  [60061000, '1001:00'],
] as const)(
  'formats total minutes for long forecast %i',
  (predictedAt, label) => {
    const turn: Entry = {
      ...entry('waiting'),
      estimateQuality: 'provisional',
      predictedAt,
      etaMinutes: 90,
    }
    render(
      <MemoryRouter>
        <TurnView
          entry={turn}
          locale="en"
          now={1000}
          updatedAt={1000}
          onAction={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText(label)).toHaveClass(
      'tabular-nums',
      'whitespace-nowrap',
    )
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      `Estimated wait: ${label} (minutes:seconds)`,
    )
  },
)
it.each([undefined, null, NaN, Infinity])(
  'preserves honest legacy minutes for timestamp %s',
  (predictedAt) => {
    const turn: Entry = {
      ...entry('waiting'),
      estimateQuality: 'estimated',
      predictedAt,
      etaMinutes: 25,
      initialEtaMinutes: 50,
    }
    render(
      <MemoryRouter>
        <TurnView
          entry={turn}
          locale="en"
          now={181000}
          updatedAt={1000}
          onAction={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('25', { exact: true })).toBeVisible()
    expect(screen.getByRole('progressbar')).toHaveAccessibleName(
      'Estimated wait: 25 min',
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '50',
    )
    expect(screen.queryByText('25:00')).not.toBeInTheDocument()
  },
)
it.each(['unknown', undefined] as const)(
  'does not show false zero for %s forecasts',
  (estimateQuality) => {
    const turn = { ...entry('waiting'), estimateQuality, predictedAt: 0 }
    render(
      <MemoryRouter>
        <TurnView
          entry={turn}
          locale="en"
          now={1000}
          updatedAt={1000}
          onAction={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('—')).toBeVisible()
    expect(screen.queryByText('0:00')).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
  },
)

it('keeps the zero countdown visible and arc indeterminate without a baseline', () => {
  const turn: Entry = {
    ...entry('waiting'),
    estimateQuality: 'estimated',
    etaMinutes: 0,
    predictedAt: 1000,
  }
  const { container } = render(
    <MemoryRouter>
      <TurnView
        entry={turn}
        locale="en"
        now={2000}
        updatedAt={1000}
        onAction={vi.fn()}
      />
    </MemoryRouter>,
  )
  expect(screen.getByText('0:00')).toBeVisible()
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
  expect(container.querySelector('circle[stroke="currentColor"]')).toBeNull()
})
