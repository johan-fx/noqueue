import '@testing-library/jest-dom/vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QueueSummary, StaffRole } from '@noqueue/contracts/staff'
import { Dashboard } from './Dashboard'
import { api, ApiError } from './api'

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
  errorMessage: String,
}))
afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})
const service: QueueSummary = {
  id: 'restaurant',
  name: 'Restaurante',
  venueId: 'hotel',
  capacity: 20,
  averageMinutes: 30,
  open: 0,
  serviceOpen: true,
  queueState: 'inactive',
  canJoin: false,
  version: 1,
  config: {
    name: 'Restaurante',
    type: 'restaurant',
    capacity: 20,
    averageMinutes: 30,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    spaces: [{ name: 'Interior', tables: 10 }],
    receptionServices: ['check_in'],
  },
}

it('refreshes a stale quick assignment without retrying or assigning the new head', async () => {
  const commands: unknown[] = []
  let conflicted = false
  vi.mocked(api).mockImplementation(async (path, _method, body) => {
    if (path.endsWith('/commands')) {
      commands.push(body)
      conflicted = true
      throw new ApiError(409, 'assignment_next_changed')
    }
    if (path.endsWith('/queues')) return [{ ...service, config: { ...service.config, type: 'reception', automaticAssignmentEnabled: true } }]
    if (path.includes('/automation')) return {
      configured: true,
      effective: true,
      activeCycles: 1,
      serverNow: Date.now(),
      nextEntry: { id: conflicted ? 'second' : 'first', version: 0 },
    }
    return [{ id: conflicted ? 'second' : 'first', code: 'Q1', partySize: 1, status: 'waiting', version: 0, sequence: 1, calledAt: null }]
  })
  render(<Dashboard venue={{ id: 'hotel', name: 'Hotel', organizationId: 'org', organizationName: 'Empresa', role: 'queue_staff' }} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  expect(await screen.findByText(/Si alguien no llega a tiempo, avisaremos al siguiente disponible/)).toBeVisible()
  fireEvent.click(await screen.findByRole('button', { name: 'Asignar próximo turno' }))
  await screen.findByRole('alert')
  expect(commands).toEqual([{ action: 'assign_next', expectedEntryId: 'first', expectedVersion: 0 }])
  await waitFor(() => expect(screen.getByRole('button', { name: 'Asignar próximo turno' })).toBeEnabled())
  expect(commands).toHaveLength(1)
})

it('uses the authoritative next entry even when it is outside the loaded page', async () => {
  const commands: unknown[] = []
  vi.mocked(api).mockImplementation(async (path, _method, body) => {
    if (path.endsWith('/commands')) {
      commands.push(body)
      return { ok: true }
    }
    if (path.endsWith('/queues'))
      return [
        {
          ...service,
          config: { ...service.config, type: 'reception', automaticAssignmentEnabled: true },
        },
      ]
    if (path.includes('/automation'))
      return {
        configured: true,
        effective: true,
        activeCycles: 0,
        serverNow: Date.now(),
        nextEntry: { id: 'outside-loaded-page', version: 7 },
      }
    if (path.endsWith('/entries')) return []
    return []
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  const assign = await screen.findByRole('button', { name: 'Asignar próximo turno' })
  expect(assign).toBeEnabled()
  fireEvent.click(assign)
  await waitFor(() =>
    expect(commands).toEqual([
      { action: 'assign_next', expectedEntryId: 'outside-loaded-page', expectedVersion: 7 },
    ]),
  )
})

it('announces an expiry from another cycle during a forced post-command refresh', async () => {
  let commandCommitted = false
  let automationReads = 0
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/queues'))
      return [
        {
          ...service,
          config: {
            ...service.config,
            type: 'reception',
            automaticAssignmentEnabled: true,
          },
        },
      ]
    if (path.endsWith('/entries')) return []
    if (path.includes('/automation')) {
      automationReads++
      return commandCommitted
        ? {
            configured: true,
            effective: true,
            activeCycles: 1,
            serverNow: Date.now(),
            cursor: 11,
            events: [
              {
                id: 11,
                cause: 'arrival_expiry',
                entry: { id: 'expired-entry', code: 'A1', displayName: 'Ana' },
                successor: { id: 'next-entry', code: 'B1', displayName: 'Luis' },
                cycleId: 'other-cycle',
                createdAt: Date.now(),
              },
            ],
          }
        : {
            configured: true,
            effective: true,
            activeCycles: 1,
            serverNow: Date.now(),
            cursor: 10,
            events: [],
            nextEntry: { id: 'next-entry', version: 0 },
          }
    }
    if (path.endsWith('/commands')) {
      commandCommitted = true
      return {
        ok: true,
        outcome: {
          operationId: 'call-next-operation',
          action: 'call',
          entry: { id: 'next-entry', code: 'B1', displayName: 'Luis' },
          automatic: true,
          cycleEnded: false,
          mode: 'called',
        },
      }
    }
    return []
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )
  await waitFor(() => expect(automationReads).toBe(1))
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  fireEvent.focus(window)
  await waitFor(() => expect(automationReads).toBe(2))
  fireEvent.click(await screen.findByRole('button', { name: 'Asignar próximo turno' }))
  expect(
    await screen.findByText(
      'El turno de Ana ha expirado. Se ha avisado a Luis.',
    ),
  ).toBeVisible()
  // The real modal drawer must not capture the toast in its layout or hide
  // its live region from assistive technology.
  const viewport = screen.getByRole('region', { name: 'Notifications' })
  expect(viewport).toHaveClass('fixed', 'pointer-events-none')
  expect(viewport.closest('[data-slot="drawer-popup"]')).toBeNull()
  expect(viewport.closest('[aria-hidden="true"], [inert]')).toBeNull()
  // Base UI nests portals in the modal portal, outside its transformed popup.
  expect(viewport.parentElement?.parentElement).toHaveAttribute('data-slot', 'drawer-portal')
  expect(document.querySelector('[data-queue-toast-anchor]')).toBeNull()

})

it('rebaselines the same queue on every open and only announces newly observed events once', async () => {
  const automationPaths: string[] = []
  let commandCommitted = false
  const historicalEvent = {
    id: 10,
    cause: 'arrival_expiry',
    entry: { id: 'old-entry', code: 'A0', displayName: 'Ana antigua' },
    successor: { id: 'old-next', code: 'B0', displayName: 'Luis antiguo' },
    cycleId: 'old-cycle',
    createdAt: Date.now(),
  }
  const liveEvent = {
    id: 11,
    cause: 'arrival_expiry',
    entry: { id: 'entry', code: 'A1', displayName: 'Ana' },
    successor: { id: 'next-entry', code: 'B1', displayName: 'Luis' },
    cycleId: 'other-cycle',
    createdAt: Date.now(),
  }
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/queues'))
      return [
        {
          ...service,
          config: {
            ...service.config,
            type: 'reception',
            automaticAssignmentEnabled: true,
          },
        },
      ]
    if (path.endsWith('/entries')) return []
    if (path.includes('/automation')) {
      automationPaths.push(path)
      return commandCommitted
        ? {
            configured: true,
            effective: true,
            activeCycles: 1,
            serverNow: Date.now(),
            cursor: 11,
            events: [liveEvent],
          }
        : {
            configured: true,
            effective: true,
            activeCycles: 1,
            serverNow: Date.now(),
            cursor: 10,
            events: [historicalEvent],
            nextEntry: { id: 'entry', version: 0 },
          }
    }
    if (path.endsWith('/commands')) {
      commandCommitted = true
      return {
        ok: true,
        outcome: {
          operationId: 'reopen-cycle-command',
          action: 'call',
          entry: { id: 'entry', code: 'Q1', displayName: 'María' },
          automatic: true,
          cycleEnded: false,
          mode: 'called',
        },
      }
    }
    return []
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )

  await waitFor(() => expect(automationPaths).toHaveLength(1))
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  const drawer = await screen.findByRole('dialog', { name: 'Gestionar lista' })
  fireEvent.focus(window)
  await waitFor(() => expect(automationPaths).toHaveLength(2))
  expect(screen.queryByText(/Ana antigua ha expirado/)).not.toBeInTheDocument()

  fireEvent.click(within(drawer).getByRole('button', { name: 'Volver' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Gestionar lista' })).toBeNull(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Ver lista' }))
  await screen.findByRole('dialog', { name: 'Gestionar lista' })
  fireEvent.focus(window)
  await waitFor(() => expect(automationPaths).toHaveLength(3))
  expect(screen.queryByText(/Ana antigua ha expirado/)).not.toBeInTheDocument()

  fireEvent.click(await screen.findByRole('button', { name: 'Asignar próximo turno' }))
  expect(
    await screen.findByText('El turno de Ana ha expirado. Se ha avisado a Luis.'),
  ).toBeVisible()
  expect(screen.getAllByText('El turno de Ana ha expirado. Se ha avisado a Luis.'))
    .toHaveLength(1)
  expect(automationPaths.at(-1)).toMatch(/\/queues\/restaurant\/automation\?after=10$/)
})

it('ignores an automation feed response that completes after the queue drawer closes', async () => {
  let resolveFirstFeed!: (value: unknown) => void
  let automationReads = 0
  const staleEvent = {
    id: 21,
    cause: 'arrival_expiry',
    entry: { id: 'expired', code: 'A1', displayName: 'Ana' },
    successor: { id: 'successor', code: 'B1', displayName: 'Luis' },
    cycleId: 'cycle',
    createdAt: Date.now(),
  }
  const automationPaths: string[] = []
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/queues'))
      return [
        {
          ...service,
          config: {
            ...service.config,
            type: 'reception',
            automaticAssignmentEnabled: true,
          },
        },
      ]
    if (path.endsWith('/entries')) return []
    if (path.includes('/automation')) {
      automationPaths.push(path)
      automationReads++
      if (automationReads === 2)
        return new Promise((resolve) => {
          resolveFirstFeed = resolve
        })
      return {
        configured: true,
        effective: true,
        activeCycles: 1,
        serverNow: Date.now(),
        cursor: 21,
        events: [staleEvent],
      }
    }
    return []
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )

  await waitFor(() => expect(automationReads).toBe(1))
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  const drawer = await screen.findByRole('dialog', { name: 'Gestionar lista' })
  fireEvent.focus(window)
  await waitFor(() => expect(automationReads).toBe(2))
  fireEvent.click(within(drawer).getByRole('button', { name: 'Volver' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Gestionar lista' })).toBeNull(),
  )
  expect(automationPaths).toHaveLength(2)

  await act(async () => {
    resolveFirstFeed({
      configured: true,
      effective: true,
      activeCycles: 1,
      serverNow: Date.now(),
      cursor: 21,
      events: [staleEvent],
    })
    await Promise.resolve()
  })
  expect(screen.queryByText('El turno de Ana ha expirado. Se ha avisado a Luis.'))
    .not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Ver lista' }))
  await screen.findByRole('dialog', { name: 'Gestionar lista' })
  fireEvent.focus(window)
  await waitFor(() => expect(automationReads).toBe(3))
  expect(automationPaths).toHaveLength(3)
  expect(screen.queryByText('El turno de Ana ha expirado. Se ha avisado a Luis.'))
    .not.toBeInTheDocument()
})

it('does not quick-assign retained manual-only entries but keeps their card action', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/queues'))
      return [
        {
          ...service,
          config: {
            ...service.config,
            type: 'reception',
            automaticAssignmentEnabled: true,
          },
        },
      ]
    if (path.includes('/automation'))
      return {
        configured: true,
        effective: true,
        activeCycles: 0,
        serverNow: Date.now(),
      }
    if (path.endsWith('/entries'))
      return [
        {
          id: 'retained',
          code: 'Q1',
          partySize: 1,
          status: 'waiting',
          version: 0,
          sequence: 1,
          calledAt: null,
          manualOnly: true,
          allowedActions: ['call', 'cancel'],
        },
      ]
    return []
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  expect(await screen.findByText('Pendiente de asignación manual')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Asignar próximo turno' }),
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Gestionar turno Q1' }))
  expect(screen.getByRole('button', { name: 'Asignar próximo turno' })).toBeVisible()
})

it('shows configured automation status to read-only viewers without exposing the CTA', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/queues'))
      return [
        {
          ...service,
          config: { ...service.config, automaticAssignmentEnabled: true },
        },
      ]
    if (path.includes('/automation'))
      return {
        configured: true,
        effective: true,
        activeCycles: 2,
        serverNow: Date.now(),
      }
    return []
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'viewer',
      }}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  expect(await screen.findByText('2 asignaciones activas.')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Asignar próximo turno' }),
  ).not.toBeInTheDocument()
})
describe('establishment list permissions', () => {
  it.each([
    ['owner', true, true],
    ['venue_manager', true, false],
    ['queue_staff', false, false],
    ['viewer', false, false],
  ] as const)(
    'shows appropriate actions for %s',
    async (role: StaffRole, configure, members) => {
      vi.mocked(api).mockImplementation(async (path) =>
        path.endsWith('/queues')
          ? [service]
          : path.endsWith('/location')
          ? {
              version: 1,
              confirmedAt: 1,
              location: {
                formatted: 'Calle Mayor 1, Madrid',
                attribution: [
                  { text: 'Geoapify', url: 'https://www.geoapify.com/' },
                ],
              },
            }
          : [],
      )
      render(
        <Dashboard
          venue={{
            id: 'hotel',
            name: 'Hotel',
            organizationId: 'org',
            organizationName: 'Empresa',
            role,
          }}
        />,
      )
      const list = screen.getByRole('region', {
        name: 'Listado de servicios',
      })
      expect(
        await within(list).findAllByRole('article', {
          name: 'Servicio Restaurante',
        }),
      ).toHaveLength(1)
      expect(
        within(
          within(list).getByRole('article', { name: 'Servicio Restaurante' }),
        ).getByRole('button', { name: 'Ver lista' }),
      ).toBeVisible()
      expect(
        screen.queryByRole('button', { name: 'Añadir servicio' }) !== null,
      ).toBe(configure)
      const gear = screen.queryByRole('button', {
        name: 'Opciones del servicio',
      })
      expect(gear !== null).toBe(role !== 'viewer')
      if (gear) {
        fireEvent.click(gear)
        expect(
          screen.queryByRole('menuitem', { name: 'Configurar servicio' }) !==
            null,
        ).toBe(configure)
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      }
      expect(screen.queryByRole('button', { name: 'Accesos' }) !== null).toBe(
        members,
      )
      expect(await screen.findByText('Calle Mayor 1, Madrid')).toBeVisible()
      expect(screen.getByRole('link', { name: 'Geoapify' })).toBeVisible()
      expect(
        screen.queryByRole('button', { name: 'Editar ubicación' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByLabelText('Dirección del establecimiento'),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Guardar ubicación' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(
        screen.queryByLabelText('Nombre del servicio'),
      ).not.toBeInTheDocument()
    },
  )
})

it('commercial management permits configuration and access but only reads queues', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues') ? [service] : [],
  )
  render(
    <Dashboard
      mode="commercial"
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
      }}
    />,
  )
  expect(await screen.findByRole('button', { name: 'Ver lista' })).toBeVisible()
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Opciones del servicio' }))
  expect(
    await screen.findByRole('menuitem', { name: 'Configurar servicio' }),
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Accesos' })).toBeVisible()
})

it('does not advance a known but exhausted shadow queue', async () => {
  const known = {
    ...service,
    open: 1,
    config: {
      ...service.config,
      estimationMode: 'shadow' as const,
      resourceStateKnown: true,
    },
  }
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues')
      ? [known]
      : [
          {
            id: 'entry',
            code: 'A1',
            partySize: 4,
            status: 'waiting',
            version: 0,
            sequence: 1,
            calledAt: null,
            callable: false,
          },
        ],
  )
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  expect(
    screen.queryByRole('button', { name: 'Avanzar un turno' }),
  ).not.toBeInTheDocument()
})
it('allows assignment when legacy inventory says unavailable and asks for no priority reason', async () => {
  const invalidated = {
    ...service,
    config: {
      ...service.config,
      resourceStateKnown: false,
      estimationMode: 'shadow' as const,
    },
    readiness: {
      state: 'pending' as const,
      reasons: ['inventory_refresh_required' as const],
    },
  }
  const commands: { body: unknown; key: unknown }[] = []
  vi.mocked(api).mockImplementation(async (path, _method, body, key) => {
    if (path.endsWith('/queues')) return [invalidated]
    if (path.endsWith('/commands')) {
      commands.push({ body, key })
      return { ok: true }
    }
    return [
      {
        id: 'entry',
        code: 'A1',
        partySize: 4,
        status: 'waiting',
        sequence: 1,
        version: 0,
        calledAt: null,
        callable: false,
      },
    ]
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Gestionar turno A1' }))
  fireEvent.click(screen.getByRole('button', { name: 'Asignar próximo turno' }))
  const sheet = await screen.findByRole('dialog', { name: 'Asignar turno' })
  expect(within(sheet).queryByText(/confirmas que puedes atender/i)).not.toBeInTheDocument()
  expect(within(sheet).queryByLabelText(/motivo de prioridad/i)).not.toBeInTheDocument()
  expect(within(sheet).getByRole('button', { name: 'Asignar sin especificar mesa' })).toBeEnabled()
  fireEvent.click(within(sheet).getByRole('button', { name: 'Asignar sin especificar mesa' }))
  await waitFor(() => expect(commands).toHaveLength(1))
  expect(commands[0]?.body).toMatchObject({ entryId: 'entry', action: 'call' })
  expect(commands[0]?.body).not.toHaveProperty('overrideReason')
})

it.each(['pending', 'active'] as const)(
  'does not expose inventory readiness warnings for legacy %s summaries',
  async (state) => {
    const row: QueueSummary = {
      ...service,
      readiness: {
        state,
        reasons: ['configuration_missing'],
      },
    }
    vi.mocked(api).mockImplementation(async (path) =>
      path.endsWith('/queues') ? [row] : [],
    )
    render(
      <Dashboard
        venue={{
          id: 'hotel',
          name: 'Hotel',
          organizationId: 'org',
          organizationName: 'Empresa',
          role: 'queue_staff',
        }}
      />,
    )
    const card = await screen.findByRole('article', {
      name: 'Servicio Restaurante',
    })
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(card).queryByText(/inventario|ocupación|tipos de mesa/i)).not.toBeInTheDocument()
    await openCardAdvanced()
    expect(await screen.findByText('Gestión inteligente activa')).toBeVisible()
    expect(screen.queryByText('Gestión inteligente pendiente')).not.toBeInTheDocument()
    expect(screen.queryByText(/tipos de mesa|grupos de plazas|inventario|ocupación/i)).not.toBeInTheDocument()
  },
)
it.each([false, true])(
  'keeps schedule admission feedback independent of legacy inventory confirmation (%s)',
  async (confirmed) => {
    vi.mocked(api).mockImplementation(async (path) =>
      path.endsWith('/queues')
        ? [
            {
              ...service,
              open: 1,
              queueState: 'active',
              inventoryConfirmed: confirmed,
              outsideSchedule: true,
              serviceOpen: false,
              readiness: {
                state: confirmed ? 'active' : 'pending',
                reasons: confirmed ? [] : ['inventory_required'],
              },
            },
          ]
        : [],
    )
    render(
      <Dashboard
        venue={{
          id: 'hotel',
          name: 'Hotel',
          organizationId: 'org',
          organizationName: 'Empresa',
          role: 'queue_staff',
        }}
      />,
    )
    expect(await screen.findByText('Servicio cerrado')).toBeVisible()
    expect(screen.getByText('Lista activa')).toBeVisible()
    expect(screen.getByRole('switch', { name: 'Cerrar lista' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Confirmar ocupación' }),
    ).not.toBeInTheDocument()
    await openCardAdvanced()
    expect(await screen.findByText('Gestión inteligente activa')).toBeVisible()
    expect(screen.queryByText(/confirma la ocupación|inventario/i)).not.toBeInTheDocument()
  },
)
it('does not require table groups to operate and keeps configuration available', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues')
      ? [
          {
            ...service,
            open: 1,
            queueState: 'active',
            outsideSchedule: false,
            readiness: {
              state: 'pending',
              reasons: ['configuration_missing', 'inventory_required'],
            },
          },
        ]
      : [],
  )
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'owner',
      }}
    />,
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Opciones del servicio' }),
  )
  expect(
    await screen.findByRole('menuitem', { name: 'Configurar servicio' }),
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Confirmar ocupación' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByText(/inventario|ocupación pendiente/i)).not.toBeInTheDocument()
  expect(screen.queryByText('Fuera de horario')).not.toBeInTheDocument()
})
it('does not expose occupancy corrections for legacy inventory data', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues')
      ? [
          {
            ...service,
            open: 0,
            inventoryConfirmed: false,
            readiness: {
              state: 'pending',
              reasons: ['inventory_refresh_required', 'inventory_required'],
            },
          },
        ]
      : path.endsWith('opening-context')
      ? {
          open: false,
          version: 2,
          contextToken: 'token',
          pendingCount: 0,
          untrackedCount: 0,
          inventoryConfirmed: false,
          readiness: {
            state: 'pending',
            reasons: ['inventory_refresh_required'],
          },
          groups: [
            {
              spaceId: 'terrace',
              spaceName: 'Terraza',
              seats: 4,
              count: 2,
              allocated: 0,
              occupied: 1,
            },
          ],
        }
      : [],
  )
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )
  const manage = await screen.findByRole('button', { name: 'Ver lista' })
  expect(screen.getByText('Lista inactiva')).toBeVisible()
  fireEvent.click(manage)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Opciones de la lista' }),
  )
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Configuración avanzada' }),
  )
  expect(screen.queryByRole('button', { name: /desglose y correcciones de ocupación/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /actualizar ocupación|liberar uno/i })).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Confirmar ocupación' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('switch', { name: 'Abrir lista' }),
  ).not.toBeInTheDocument()
})
it.each(['queue_staff', 'viewer'] as const)(
  'shows persistent disabled policy and operational-only restore control (%s)',
  async (role) => {
    vi.mocked(api).mockImplementation(async (path) =>
      path.endsWith('/queues')
        ? [
            {
              ...service,
              config: { ...service.config, intelligencePolicy: 'disabled' },
              readiness: {
                state: 'disabled',
                reasons: ['inventory_required'],
              },
            },
          ]
        : [],
    )
    render(
      <Dashboard
        venue={{
          id: 'hotel',
          name: 'Hotel',
          organizationId: 'org',
          organizationName: 'Empresa',
          role,
        }}
      />,
    )
    expect(await screen.findByText('Servicio abierto')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ver lista' }))
    if (role === 'queue_staff') {
      fireEvent.click(
        await screen.findByRole('button', { name: 'Opciones de la lista' }),
      )
      expect(
        await screen.findByRole('menuitem', {
          name: 'Configuración avanzada',
        }),
      ).toBeVisible()
    } else
      expect(
        screen.queryByRole('button', { name: 'Opciones de la lista' }),
      ).not.toBeInTheDocument()
  },
)
it('keeps service actions minimal and removes physical-resource operations from the queue menu', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues')
      ? [
          {
            ...service,
            open: 1,
            queueState: 'active',
            inventoryConfirmed: true,
            readiness: { state: 'active', reasons: [] },
          },
        ]
      : [],
  )
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'owner',
      }}
    />,
  )
  const card = await screen.findByRole('article', {
    name: 'Servicio Restaurante',
  })
  expect(
    within(card).queryByRole('button', { name: 'Actualizar ocupación' }),
  ).not.toBeInTheDocument()
  expect(
    within(card).queryByRole('button', {
      name: 'Desactivar gestión inteligente',
    }),
  ).not.toBeInTheDocument()
  expect(card.querySelector('[data-slot="card-footer"]')?.textContent).toBe(
    'Cerrar listaVer lista',
  )
  fireEvent.click(within(card).getByRole('button', { name: 'Ver lista' }))
  const drawer = await screen.findByRole('dialog', {
    name: 'Gestionar lista',
  })
  expect(
    within(drawer).queryByRole('button', { name: 'Cerrar' }),
  ).not.toBeInTheDocument()
  fireEvent.click(
    within(drawer).getByRole('button', { name: 'Opciones de la lista' }),
  )
  expect(
    (await screen.findAllByRole('menuitem')).map((item) => item.textContent),
  ).toEqual(['Configuración avanzada'])
})
it('returns nested operation sheets to the queue menu trigger after cancel and save, then back closes only the drawer', async () => {
  let disabled = false
  vi.mocked(api).mockImplementation(async (path, method, body) => {
    if (path.endsWith('/queues'))
      return [
        {
          ...service,
          open: 1,
          queueState: 'active',
          inventoryConfirmed: true,
          config: {
            ...service.config,
            intelligencePolicy: disabled ? 'disabled' : 'automatic',
          },
          readiness: { state: disabled ? 'disabled' : 'active', reasons: [] },
        },
      ]
    if (path.endsWith('opening-context'))
      return {
        open: true,
        version: 1,
        contextToken: 'token',
        pendingCount: 0,
        untrackedCount: 0,
        inventoryConfirmed: true,
        readiness: { state: 'active', reasons: [] },
        groups: [],
      }
    if (method === 'POST') {
      disabled = (body as { action: string }).action === 'disable_intelligence'
      return { ok: true }
    }
    return []
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  const trigger = await screen.findByRole('button', {
    name: 'Opciones de la lista',
  })
  fireEvent.click(trigger)
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Configuración avanzada' }),
  )
  let policy = await screen.findByRole('button', {
    name: 'Desactivar gestión inteligente',
  })
  fireEvent.click(policy)
  let sheet = await screen.findByRole('dialog', {
    name: 'Desactivar gestión inteligente · Restaurante',
  })
  fireEvent.click(within(sheet).getByRole('button', { name: 'Volver' }))
  await waitFor(() => expect(policy).toHaveFocus())
  expect(
    screen.getByRole('dialog', { name: 'Configuración avanzada' }),
  ).toBeVisible()
  expect(
    vi.mocked(api).mock.calls.filter(([, method]) => method === 'POST'),
  ).toHaveLength(0)
  fireEvent.click(policy)
  sheet = await screen.findByRole('dialog', {
    name: 'Desactivar gestión inteligente · Restaurante',
  })
  const confirm = within(sheet).getByRole('button', {
    name: 'Desactivar gestión inteligente',
  })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
  policy = await screen.findByRole('button', {
    name: 'Volver a gestión automática',
  })
  await waitFor(() => expect(policy).toHaveFocus())
  fireEvent.click(screen.getByRole('button', { name: 'Atrás' }))
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(screen.getByRole('dialog', { name: 'Gestionar lista' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(
    vi.mocked(api).mock.calls.filter(([, method]) => method === 'POST'),
  ).toHaveLength(1)
})

it('keeps the members close button and omits operations and empty queue footer in commercial mode', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues')
      ? [service]
      : path.endsWith('/members')
      ? { members: [], invitations: [] }
      : [],
  )
  render(
    <Dashboard
      mode="commercial"
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
      }}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  const drawer = await screen.findByRole('dialog', { name: 'Ver lista' })
  expect(
    within(drawer).queryByRole('button', { name: 'Opciones de la lista' }),
  ).not.toBeInTheDocument()
  expect(drawer.querySelector('[data-slot="drawer-footer"]')).toBeNull()
  fireEvent.click(within(drawer).getByRole('button', { name: 'Volver' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Accesos' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Cerrar' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(
    vi
      .mocked(api)
      .mock.calls.every(([, method]) => !method || method === 'GET'),
  ).toBe(true)
})
it('does not show a legacy inventory CTA when intelligence is manually disabled', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues')
      ? [
          {
            ...service,
            open: 1,
            queueState: 'active',
            config: { ...service.config, intelligencePolicy: 'disabled' },
            readiness: { state: 'disabled', reasons: ['inventory_required'] },
          },
        ]
      : [],
  )
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )
  expect(await screen.findByText('Servicio abierto')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Confirmar ocupación' })).not.toBeInTheDocument()
  await openCardAdvanced()
  expect(await screen.findByRole('button', { name: 'Volver a gestión automática' })).toBeVisible()
  expect(screen.queryByRole('button', { name: /desglose y correcciones|actualizar ocupación/i })).not.toBeInTheDocument()
  expect(screen.getByText('Desactivada manualmente')).toBeVisible()
})
it('omits the restaurant global footer and assigns the selected group through the existing sheet', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues')
      ? [service]
      : [
          {
            id: 'entry',
            code: 'A1',
            partySize: 2,
            status: 'waiting',
            version: 0,
            sequence: 1,
            calledAt: null,
          },
        ],
  )
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  const drawer = await screen.findByRole('dialog', {
    name: 'Gestionar lista',
  })
  for (const tab of ['Completados', 'Cancelados']) {
    fireEvent.click(within(drawer).getByRole('tab', { name: tab }))
    expect(drawer.querySelector('[data-slot="drawer-footer"]')).toBeNull()
  }
  fireEvent.click(within(drawer).getByRole('tab', { name: 'Lista' }))
  expect(
    within(drawer).queryByRole('button', { name: 'Avanzar un turno' }),
  ).not.toBeInTheDocument()
  fireEvent.click(
    within(drawer).getByRole('button', { name: 'Gestionar turno A1' }),
  )
  const advance = screen.getByRole('button', {
    name: 'Asignar próximo turno',
  })
  await waitFor(() => expect(advance).toBeEnabled())
  fireEvent.click(advance)
  expect(
    within(
      await screen.findByRole('dialog', { name: 'Asignar turno' }),
    ).getByText('Turno A1'),
  ).toBeVisible()
})

it('refreshes an entry after 409 and requires another confirmation using the fresh version and key', async () => {
  const entry = {
    id: 'one',
    code: 'T1',
    displayName: 'María',
    partySize: 2,
    status: 'called',
    version: 0,
    sequence: 1,
    calledAt: Date.now(),
  }
  let failed = false
  const commands: { body: unknown; key: unknown }[] = []
  vi.mocked(api).mockImplementation(async (path, _method, body, key) => {
    if (path.endsWith('/commands')) {
      commands.push({ body, key })
      if (!failed) {
        failed = true
        throw new ApiError(409, 'version_conflict')
      }
      return { ok: true }
    }
    return path.endsWith('/queues')
      ? [service]
      : [{ ...entry, version: failed ? 1 : 0 }]
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  fireEvent.click(
    await screen.findByRole('button', { name: 'Gestionar turno T1' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar llegada' }))
  await waitFor(() => expect(commands).toHaveLength(1))
  expect(
    screen.queryByRole('dialog', { name: 'Confirmar llegada' }),
  ).not.toBeInTheDocument()
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Gestionar turno T1' }),
    ).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Gestionar turno T1' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar llegada' }))
  await waitFor(() => expect(commands).toHaveLength(2))
  expect(commands[0]!.body).toMatchObject({ version: 0, action: 'complete' })
  expect(commands[1]!.body).toMatchObject({ version: 1, action: 'complete' })
  expect(commands[1]!.key).not.toBe(commands[0]!.key)
})

it('reuses the exact request after an unknown outcome when refreshed assignment data changes', async () => {
  let entryReads = 0
  const originalEntry = {
    id: 'retry-entry',
    code: 'R1',
    partySize: 2,
    status: 'waiting',
    version: 1,
    sequence: 1,
    calledAt: null,
    allowedActions: ['call'],
    assignment: {
      available: true,
      spaceName: 'Interior',
      priorityRequired: true,
      token: 'first-token',
    },
  }
  const refreshedEntry = {
    ...originalEntry,
    version: 2,
    assignment: {
      ...originalEntry.assignment,
      spaceName: 'Terraza',
      token: 'refreshed-token',
    },
  }
  const commands: { body: unknown; key: unknown }[] = []
  vi.mocked(api).mockImplementation(async (path, _method, body, key) => {
    if (path.endsWith('/commands')) {
      commands.push({ body, key })
      if (commands.length === 1) throw new TypeError('Failed to fetch')
      return { ok: true }
    }
    if (path.endsWith('/queues')) return [service]
    if (path.endsWith('/entries'))
      return ++entryReads === 1 ? [originalEntry] : [refreshedEntry]
    return []
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  await screen.findByRole('dialog', { name: 'Gestionar lista' })
  fireEvent.click(
    await screen.findByRole('button', { name: 'Gestionar turno R1' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Asignar próximo turno' }))
  const sheet = await screen.findByRole('dialog', { name: 'Asignar turno' })
  expect(within(sheet).queryByLabelText(/motivo de prioridad/i)).not.toBeInTheDocument()
  const confirm = within(sheet).getByRole('button', { name: 'Asignar sin especificar mesa' })
  fireEvent.click(confirm)
  await waitFor(() => expect(commands).toHaveLength(1))
  await waitFor(() => expect(entryReads).toBeGreaterThan(1))
  expect(within(sheet).queryByText(/Al asignar confirmas/)).not.toBeInTheDocument()
  expect(within(sheet).queryByText(/Terraza|Interior/)).not.toBeInTheDocument()
  await waitFor(() => expect(confirm).toBeEnabled())

  fireEvent.click(confirm)
  await waitFor(() => expect(commands).toHaveLength(2))
  expect(commands[0]!.body).toEqual({
    entryId: 'retry-entry',
    version: 1,
    action: 'call',
    arrivalMode: 'notify',
    assignmentToken: 'first-token',
    seating: { mode: 'unspecified' },
  })
  expect(commands[0]!.key).toEqual(expect.any(String))
  expect(commands[1]!.body).toEqual(commands[0]!.body)
  expect(commands[1]!.key).toBe(commands[0]!.key)
})

it.each([
  [undefined, undefined],
  [undefined, 'fastest'],
  ['shadow', undefined],
  ['shadow', 'fastest'],
] as const)(
  'lets the maître select the compatible group in mode %s with preference %s',
  async (estimationMode, preferredSpaceId) => {
    const strictEntry = {
      id: 'strict',
      code: 'STRICT',
      partySize: 2,
      status: 'waiting',
      version: 0,
      sequence: 1,
      calledAt: null,
      callable: false,
      preferredSpaceId: 'terrace',
    }
    const eligibleEntry = {
      ...strictEntry,
      id: 'eligible',
      code: 'ELIGIBLE',
      sequence: 2,
      preferredSpaceId,
    }
    vi.mocked(api).mockImplementation(async (path) =>
      path.endsWith('/queues')
        ? [
            {
              ...service,
              config: {
                ...service.config,
                estimationMode,
                resourceStateKnown: false,
              },
            },
          ]
        : [strictEntry, eligibleEntry],
    )
    render(
      <Dashboard
        venue={{
          id: 'hotel',
          name: 'Hotel',
          organizationId: 'org',
          organizationName: 'Empresa',
          role: 'queue_staff',
        }}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Gestionar turno ELIGIBLE',
      }),
    )
    const advance = screen.getByRole('button', { name: 'Asignar próximo turno' })
    await waitFor(() => expect(advance).toBeEnabled())
    fireEvent.click(advance)
    const sheet = await screen.findByRole('dialog', { name: 'Asignar turno' })
    expect(within(sheet).getByText('Turno ELIGIBLE')).toBeVisible()
    expect(within(sheet).queryByText('Turno STRICT')).not.toBeInTheDocument()
  },
)
it.each([false, true])(
  'revalidates restaurant compatibility in the selected sheet (available=%s)',
  async (available) => {
    vi.mocked(api).mockImplementation(async (path) =>
      path.endsWith('/queues')
        ? [service]
        : [
            {
              id: 'strict',
              code: 'STRICT',
              partySize: 2,
              status: 'waiting',
              version: 0,
              sequence: 1,
              calledAt: null,
              assignment: {
                available,
                spaceName: 'Terraza',
                priorityRequired: false,
                token: 'snapshot',
              },
            },
          ],
    )
    render(
      <Dashboard
        venue={{
          id: 'hotel',
          name: 'Hotel',
          organizationId: 'org',
          organizationName: 'Empresa',
          role: 'queue_staff',
        }}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Gestionar turno STRICT',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Asignar próximo turno' }))
    const sheet = await screen.findByRole('dialog', { name: 'Asignar turno' })
    expect(within(sheet).queryByRole('group', { name: 'Cliente' })).not.toBeInTheDocument()
    const submit = within(sheet).getByRole('button', { name: 'Asignar sin especificar mesa' })
    if (available) {
      expect(submit).toBeEnabled()
      fireEvent.click(submit)
      await waitFor(() =>
        expect(api).toHaveBeenCalledWith(
          '/queues/restaurant/commands',
          'POST',
          expect.objectContaining({ action: 'call', arrivalMode: 'notify' }),
          expect.any(String),
        ),
      )
    } else expect(submit).toBeDisabled()
  },
)

it('uses refreshed assignment availability, version, and token in an open confirmation sheet', async () => {
  let poll: (() => void) | undefined
  const schedule = window.setTimeout.bind(window)
  vi.spyOn(window, 'setTimeout').mockImplementation((callback, delay) => {
    if (delay === 5000) {
      poll = callback as () => void
      return 1
    }
    return schedule(callback, delay)
  })
  const unavailable = {
    id: 'fresh-entry',
    code: 'FRESH',
    partySize: 2,
    status: 'waiting',
    version: 1,
    sequence: 1,
    calledAt: null,
    assignment: {
      available: false,
      spaceName: 'Terraza',
      priorityRequired: false,
      token: 'stale-token',
    },
  }
  const available = {
    ...unavailable,
    version: 2,
    assignment: {
      available: true,
      spaceName: 'Terraza',
      priorityRequired: false,
      token: 'fresh-token',
    },
  }
  const commands: { body: unknown; key: unknown }[] = []
  let entryReads = 0
  vi.mocked(api).mockImplementation(async (path, _method, body, key) => {
    if (path.endsWith('/commands')) {
      commands.push({ body, key })
      return { ok: true }
    }
    if (path.endsWith('/queues')) return [service]
    if (path.endsWith('/entries'))
      return ++entryReads === 1 ? [unavailable] : [available]
    return []
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  await screen.findByRole('dialog', { name: 'Gestionar lista' })
  fireEvent.click(
    await screen.findByRole('button', { name: 'Gestionar turno FRESH' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Asignar próximo turno' }))
  const sheet = await screen.findByRole('dialog', { name: 'Asignar turno' })
  const confirm = within(sheet).getByRole('button', { name: 'Asignar sin especificar mesa' })
  expect(confirm).toBeDisabled()

  expect(poll).toBeDefined()
  await act(async () => {
    poll?.()
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(entryReads).toBeGreaterThan(1)
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
  await waitFor(() => expect(commands).toHaveLength(1))
  expect(commands[0]?.body).toEqual({
    entryId: 'fresh-entry',
    version: 2,
    action: 'call',
    arrivalMode: 'notify',
    assignmentToken: 'fresh-token',
    seating: { mode: 'unspecified' },
  })
  expect(commands[0]?.key).toEqual(expect.any(String))
})

it.each(['removed', 'disallowed'] as const)(
  'blocks an open confirmation when its refreshed entry is %s',
  async (change) => {
    let poll: (() => void) | undefined
    const schedule = window.setTimeout.bind(window)
    vi.spyOn(window, 'setTimeout').mockImplementation((callback, delay) => {
      if (delay === 5000) {
        poll = callback as () => void
        return 1
      }
      return schedule(callback, delay)
    })
    const entry = {
      id: 'changed-entry',
      code: 'CHANGED',
      partySize: 2,
      status: 'waiting',
      version: 1,
      sequence: 1,
      calledAt: null,
      allowedActions: ['call'],
      assignment: {
        available: true,
        spaceName: 'Terraza',
        priorityRequired: false,
        token: 'assignment-token',
      },
    }
    let entryReads = 0
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith('/queues')) return [service]
      if (path.endsWith('/entries')) {
        entryReads++
        if (entryReads === 1) return [entry]
        return change === 'removed' ? [] : [{ ...entry, allowedActions: [] }]
      }
      return []
    })
    render(
      <Dashboard
        venue={{
          id: 'hotel',
          name: 'Hotel',
          organizationId: 'org',
          organizationName: 'Empresa',
          role: 'queue_staff',
        }}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Gestionar turno CHANGED',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Asignar próximo turno' }))
    const sheet = await screen.findByRole('dialog', { name: 'Asignar turno' })
    const confirm = within(sheet).getByRole('button', { name: 'Asignar sin especificar mesa' })
    expect(confirm).toBeEnabled()

    await act(async () => {
      poll?.()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(confirm).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'El turno ya no permite esta acción.',
    )
  },
)

it('does not commit a late entry refresh for a queue that is no longer selected', async () => {
  let poll: (() => void) | undefined
  const schedule = window.setTimeout.bind(window)
  vi.spyOn(window, 'setTimeout').mockImplementation((callback, delay) => {
    if (delay === 5000) {
      poll = callback as () => void
      return 1
    }
    return schedule(callback, delay)
  })
  const first = { ...service, id: 'first', name: 'First service' }
  const second = { ...service, id: 'second', name: 'Second service' }
  const firstEntry = {
    id: 'first-entry',
    code: 'FIRST',
    status: 'waiting',
    version: 0,
    sequence: 1,
    calledAt: null,
  }
  const lateFirstEntry = { ...firstEntry, id: 'late-first', code: 'LATE' }
  const secondEntry = {
    ...firstEntry,
    id: 'second-entry',
    code: 'SECOND',
  }
  let firstReads = 0
  let resolveFirstRefresh!: (rows: unknown[]) => void
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/venues/hotel/queues')) return [first, second]
    if (path.endsWith('/queues/first/entries')) {
      if (++firstReads === 1) return [firstEntry]
      if (firstReads === 2)
        return new Promise((resolve) => {
          resolveFirstRefresh = resolve
        })
      return [firstEntry]
    }
    if (path.endsWith('/queues/second/entries')) return [secondEntry]
    return []
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )
  const viewButtons = await screen.findAllByRole('button', { name: 'Ver lista' })
  fireEvent.click(viewButtons[0]!)
  const firstDrawer = await screen.findByRole('dialog', {
    name: 'Gestionar lista',
  })
  expect(poll).toBeTypeOf('function')
  await act(async () => poll!())
  await waitFor(() => expect(firstReads).toBe(2))

  fireEvent.click(within(firstDrawer).getByRole('button', { name: 'Volver' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Gestionar lista' })).toBeNull(),
  )
  fireEvent.click(screen.getAllByRole('button', { name: 'Ver lista' })[1]!)
  const secondDrawer = await screen.findByRole('dialog', {
    name: 'Gestionar lista',
  })
  await expect(
    within(secondDrawer).getByRole('button', {
      name: 'Gestionar turno SECOND',
    }),
  ).toBeVisible()
  await act(async () => {
    resolveFirstRefresh([lateFirstEntry])
    await Promise.resolve()
    await Promise.resolve()
  })

  await expect(
    within(secondDrawer).getByRole('button', {
      name: 'Gestionar turno SECOND',
    }),
  ).toBeVisible()
  expect(
    within(secondDrawer).queryByRole('button', {
      name: 'Gestionar turno LATE',
    }),
  ).not.toBeInTheDocument()
})

it('returns cancellation close focus to the persistent management card', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues')
      ? [service]
      : path.endsWith('/entries')
      ? [
          {
            id: 'focus-entry',
            code: 'F1',
            status: 'waiting',
            displayName: 'Focus Guest',
            partySize: 2,
            sequence: 1,
            version: 0,
            calledAt: null,
          },
        ]
      : [],
  )
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'owner',
      }}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  const trigger = await screen.findByRole('button', {
    name: 'Gestionar turno F1',
  })
  fireEvent.click(trigger)
  const manager = await screen.findByRole('dialog', { name: 'Gestionar turno' })
  fireEvent.click(within(manager).getByRole('button', {
    name: 'Cancelar turno',
  }))
  const confirmation = await screen.findByRole('dialog', {
    name: '¿Confirmas que quieres cancelar el turno?',
  })
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Cerrar' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '¿Confirmas que quieres cancelar el turno?' })).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
})

it('returns a successfully called turn to its persistent management card', async () => {
  let status = 'waiting'
  const calledOutcome = {
    ok: true,
    outcome: {
      operationId: 'focus-call-operation',
      action: 'call',
      entry: { id: 'focus-entry', code: 'F1', displayName: 'Focus Guest' },
      automatic: false,
      cycleEnded: false,
      mode: 'called',
    },
  }
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/queues')) return [service]
    if (path.endsWith('/entries'))
      return [
        {
          id: 'focus-entry',
          code: 'F1',
          status,
          displayName: 'Focus Guest',
          partySize: 2,
          sequence: 1,
          version: status === 'called' ? 1 : 0,
          calledAt: status === 'called' ? Date.now() : null,
          arrivalDeadlineAt: null,
        },
      ]
    if (path.endsWith('/commands')) {
      status = 'called'
      return calledOutcome
    }
    return []
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'owner',
      }}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  const trigger = await screen.findByRole('button', { name: 'Gestionar turno F1' })
  fireEvent.click(trigger)
  const manager = await screen.findByRole('dialog', { name: 'Gestionar turno' })
  fireEvent.click(within(manager).getByRole('button', { name: 'Asignar próximo turno' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Asignar sin especificar mesa' }))
  await waitFor(() => expect(trigger).toHaveFocus())
})

it('commercial management can edit location independently of membership service permissions', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues')
      ? [service]
      : path.endsWith('/location')
      ? { version: 1, confirmedAt: null, location: null }
      : [],
  )
  render(
    <Dashboard
      mode="commercial"
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
      }}
    />,
  )
  expect(
    await screen.findByRole('button', { name: 'Editar ubicación' }),
  ).toBeVisible()
})
it('incomplete staff location is read-only and does not invite unauthorized completion', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues')
      ? [service]
      : path.endsWith('/location')
      ? { version: 1, confirmedAt: null, location: null }
      : [],
  )
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'owner',
      }}
    />,
  )
  expect(
    await screen.findByText(
      'Ubicación pendiente de confirmación por administración.',
    ),
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Editar ubicación' }),
  ).not.toBeInTheDocument()
})
it('keeps everyday restaurant operation simple and hides advanced occupancy fields', async () => {
  const current = {
    ...service,
    serviceOpen: true,
    queueState: 'inactive' as const,
    canJoin: false,
    readiness: { state: 'pending' as const, reasons: [] },
    config: {
      ...service.config,
      spaces: [
        {
          id: 'main',
          name: 'Interior',
          tables: 1,
          tableTypes: [{ seats: 4, count: 1 }],
        },
      ],
    },
  }
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues') ? [current] : [],
  )
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Company',
        role: 'owner',
      }}
    />,
  )
  expect(
    await screen.findByRole('switch', { name: 'Activar lista' }),
  ).toBeVisible()
  expect(
    screen.queryByRole('switch', { name: 'Abrir lista' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText('Desactivar gestión inteligente'),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
})

it('renders the Figma list footer and real waiting-turn count without the public marker', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues')
      ? [
          {
            ...service,
            queueState: 'active',
            initialWaitingMarker: true,
            waitingPeople: 0,
          },
        ]
      : [],
  )
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'owner',
      }}
    />,
  )
  const card = await screen.findByRole('article', {
    name: 'Servicio Restaurante',
  })
  expect(
    within(card).getByRole('switch', { name: 'Cerrar lista' }),
  ).toBeChecked()
  await waitFor(() =>
    expect(
      within(card).getByText('Turnos en lista de espera').nextElementSibling,
    ).toHaveTextContent('0'),
  )
  expect(within(card).getByText('Servicio abierto')).toHaveClass(
    'bg-green-100',
    'text-green-600',
  )
  expect(within(card).getByText('Lista activa')).toHaveClass(
    'bg-green-100',
    'text-green-600',
  )
  expect(within(card).getByRole('button', { name: 'Ver lista' })).toBeVisible()
  expect(
    within(card).queryByRole('button', { name: 'Configuración avanzada' }),
  ).not.toBeInTheDocument()
  expect(
    within(card).getByRole('button', { name: 'Opciones del servicio' }),
  ).toBeVisible()
})
it('uses a non-destructive closing AlertDialog and cancelling makes no lifecycle request', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues') ? [{ ...service, queueState: 'active' }] : [],
  )
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'owner',
      }}
    />,
  )
  const control = await screen.findByRole('switch', { name: 'Cerrar lista' })
  fireEvent.click(control)
  const confirm = await screen.findByRole('alertdialog', {
    name: 'Vas a cerrar la lista',
  })
  expect(
    within(confirm).getByText(
      'Se deshabilitará la opción de añadir nuevos turnos y los clientes no podrán inscribirse. Los turnos existentes se conservarán y podrán seguir atendiéndose.',
    ),
  ).toBeVisible()
  expect(
    screen.queryByText('Esta acción no se puede deshacer'),
  ).not.toBeInTheDocument()
  fireEvent.click(within(confirm).getByRole('button', { name: 'Cancelar' }))
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
  )
  expect(control).toBeChecked()
  expect(
    vi.mocked(api).mock.calls.some(([, method]) => method === 'POST'),
  ).toBe(false)
})

async function openCardAdvanced() {
  fireEvent.click(
    await screen.findByRole('button', { name: 'Opciones del servicio' }),
  )
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Configuración avanzada' }),
  )
}

it('does not invent an initial count or allow an older poll to overwrite a confirmed admission refresh', async () => {
  let release!: (rows: unknown[]) => void
  let reads = 0,
    active = false
  vi.mocked(api).mockImplementation(async (path, method) => {
    if (path.endsWith('opening-context'))
      return {
        contextToken: 'new',
        readiness: { state: 'pending', reasons: [] },
      }
    if (method === 'POST') {
      active = true
      return { ok: true }
    }
    if (path.endsWith('/queues'))
      return [
        {
          ...service,
          queueState: active ? 'active' : 'inactive',
          ...(active ? { waitingCount: 1 } : {}),
        },
      ]
    if (path.endsWith('/entries'))
      return ++reads === 1
        ? new Promise((resolve) => {
            release = resolve
          })
        : [{ id: 'real', status: 'waiting' }]
    return []
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'owner',
      }}
    />,
  )
  const card = await screen.findByRole('article', {
    name: 'Servicio Restaurante',
  })
  expect(
    within(card).getByText('Turnos en lista de espera').nextElementSibling,
  ).toHaveTextContent('—')
  await waitFor(() => expect(reads).toBe(1))
  fireEvent.click(within(card).getByRole('switch', { name: 'Activar lista' }))
  await waitFor(() =>
    expect(
      within(card).getByText('Turnos en lista de espera').nextElementSibling,
    ).toHaveTextContent('1'),
  )
  release([])
  await waitFor(() =>
    expect(
      within(card).getByRole('switch', { name: 'Cerrar lista' }),
    ).toBeEnabled(),
  )
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(
    within(card).getByText('Turnos en lista de espera').nextElementSibling,
  ).toHaveTextContent('1')
})

it.each(['reception', 'pool'] as const)(
  'assigns next %s once without a sheet or an individual waiting action',
  async (type) => {
    const commands: unknown[] = []
    let resolve!: () => void
    vi.mocked(api).mockImplementation(async (path, _method, body) => {
      if (path.endsWith('/commands')) {
        commands.push(body)
        await new Promise<void>((r) => {
          resolve = r
        })
        return { ok: true }
      }
      return path.endsWith('/queues')
        ? [{ ...service, config: { ...service.config, type } }]
        : path.includes('/automation')
        ? {
            configured: false,
            effective: false,
            activeCycles: 0,
            serverNow: Date.now(),
            cursor: 0,
            events: [],
            nextEntry: { id: 'entry', version: 0 },
          }
        : [
            {
              id: 'entry',
              code: 'Q1',
              partySize: 1,
              status: 'waiting',
              version: 0,
              sequence: 1,
              calledAt: null,
            },
          ]
    })
    render(
      <Dashboard
        venue={{
          id: 'hotel',
          name: 'Hotel',
          organizationId: 'org',
          organizationName: 'Empresa',
          role: 'queue_staff',
        }}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
    const next = await screen.findByRole('button', {
      name: 'Asignar próximo turno',
    })
    fireEvent.click(next)
    fireEvent.click(next)
    expect(commands).toEqual([{ action: 'assign_next', expectedEntryId: 'entry', expectedVersion: 0 }])
    expect(
      screen.queryByRole('dialog', { name: 'Asignar turno' }),
    ).not.toBeInTheDocument()
    resolve()
    await waitFor(() => expect(next).toBeEnabled())
  },
)

it('publishes a slow poll and never fetches nonselected entries', async () => {
  vi.useFakeTimers()
  let finish!: (rows: unknown[]) => void
  const second = { ...service, id: 'other', name: 'Other', waitingCount: 701 }
  let reads = 0
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/queues'))
      return [{ ...service, waitingCount: 0 }, second]
    if (path === '/queues/restaurant/entries') {
      reads++
      if (reads === 1)
        return new Promise((resolve) => {
          finish = resolve
        })
    }
    return []
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Org',
        role: 'viewer',
      }}
    />,
  )
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(reads).toBe(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000)
  })
  await act(async () => finish([]))
  expect(reads).toBe(1)
  expect(
    vi
      .mocked(api)
      .mock.calls.some(([path]) => path === '/queues/other/entries'),
  ).toBe(false)
  expect(screen.getByText(/701/)).toBeVisible()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(reads).toBe(2)
  vi.useRealTimers()
})

it('times out at 15 seconds, preserves valid rows, aborts and recovers on the next completion-driven retry', async () => {
  vi.useFakeTimers()
  let reads = 0,
    pendingSignal: AbortSignal | undefined
  const row = (code: string) => ({
    id: code,
    code,
    partySize: 1,
    status: 'waiting',
    version: 0,
    sequence: 1,
    calledAt: null,
  })
  vi.mocked(api).mockImplementation(
    async (path, _method, _body, _key, signal) => {
      if (path.endsWith('/queues')) return [{ ...service, waitingCount: 1 }]
      if (path.endsWith('/entries')) {
        reads++
        if (reads === 2) {
          pendingSignal = signal
          return new Promise(() => undefined)
        }
        return [row(reads === 1 ? 'VALID' : 'RECOVERED')]
      }
      return []
    },
  )
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Org',
        role: 'viewer',
      }}
    />,
  )
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  fireEvent.click(screen.getByRole('button', { name: 'Ver lista' }))
  expect(screen.getByText('VALID')).toBeVisible()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000)
  })
  expect(pendingSignal?.aborted).toBe(true)
  expect(screen.getByText('VALID')).toBeVisible()
  expect(
    screen
      .getAllByText(/Servicio temporalmente no disponible/)
      .every((element) => element.textContent?.includes('temporalmente')),
  ).toBe(true)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(screen.getByText('RECOVERED')).toBeVisible()
  expect(
    screen.queryByText(/Servicio temporalmente no disponible/),
  ).not.toBeInTheDocument()
  vi.useRealTimers()
})
it('invalidates and aborts stale selection results before they can publish', async () => {
  vi.useFakeTimers()
  let finish!: (rows: unknown[]) => void, oldSignal: AbortSignal | undefined
  const other = { ...service, id: 'other', name: 'Other', waitingCount: 0 }
  vi.mocked(api).mockImplementation(
    async (path, _method, _body, _key, signal) => {
      if (path.endsWith('/queues')) return [service, other]
      if (path === '/queues/restaurant/entries') {
        oldSignal = signal
        return new Promise((resolve) => {
          finish = resolve
        })
      }
      return []
    },
  )
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Org',
        role: 'viewer',
      }}
    />,
  )
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  fireEvent.click(
    within(screen.getByRole('article', { name: 'Servicio Other' })).getByRole(
      'button',
      { name: 'Ver lista' },
    ),
  )
  await act(async () =>
    finish([{ id: 'old', code: 'STALE', status: 'waiting', partySize: 1 }]),
  )
  expect(oldSignal?.aborted).toBe(true)
  expect(screen.queryByText('STALE')).not.toBeInTheDocument()
  expect(
    vi
      .mocked(api)
      .mock.calls.filter(([path]) => path === '/queues/other/entries'),
  ).toHaveLength(1)
  vi.useRealTimers()
})
it('keeps a missing legacy summary count unknown instead of inventing zero for an unselected queue', async () => {
  vi.useFakeTimers()
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues')
      ? [service, { ...service, id: 'other', name: 'Other' }]
      : [],
  )
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Org',
        role: 'viewer',
      }}
    />,
  )
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  const card = screen.getByRole('article', { name: 'Servicio Other' })
  expect(
    within(card).getByText('Turnos en lista de espera').nextElementSibling,
  ).toHaveTextContent('—')
  vi.useRealTimers()
})

const seatingService: QueueSummary = {
  ...service,
  config: {
    ...service.config,
    spaces: [
      {
        id: 'inside',
        name: 'Interior',
        tables: 2,
        tableTypes: [
          { seats: 3, count: 1 },
          { seats: 4, count: 1 },
        ],
      },
      {
        id: 'outside',
        name: 'Terraza',
        tables: 1,
        tableTypes: [{ seats: 4, count: 1 }],
      },
    ],
  },
}
const seatingEntry = {
  id: 'seating',
  code: 'SEAT',
  partySize: 2,
  status: 'waiting',
  sequence: 1,
  version: 0,
  calledAt: null,
  preferredSpaceId: 'inside',
}
async function openSeatingDashboard() {
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Empresa',
        role: 'queue_staff',
      }}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  fireEvent.click(
    await screen.findByRole('button', { name: 'Gestionar turno SEAT' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Asignar próximo turno' }))
  return screen.findByRole('dialog', { name: 'Asignar turno' })
}
it('keeps assignment compact without automatic-cycle explanatory copy', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/queues'))
      return [
        {
          ...seatingService,
          config: {
            ...seatingService.config,
            automaticAssignmentEnabled: true,
          },
        },
      ]
    if (path.includes('/automation'))
      return {
        configured: true,
        effective: true,
        activeCycles: 0,
        serverNow: Date.now(),
      }
    return [seatingEntry]
  })
  const sheet = await openSeatingDashboard()
  expect(within(sheet).queryByText(/Si vence el plazo/)).not.toBeInTheDocument()
  expect(within(sheet).queryByText(/Confirmar la llegada o cancelar manualmente pausa/)).not.toBeInTheDocument()
  expect(
    within(sheet).queryByText(/te avisaremos aquí para que elijas/),
  ).not.toBeInTheDocument()
})
it('confirms a larger table and changed space through buttons, and resets on reopening', async () => {
  const commands: unknown[] = []
  vi.mocked(api).mockImplementation(async (path, _method, body) => {
    if (path.endsWith('/queues')) return [seatingService]
    if (path.endsWith('/commands')) {
      commands.push(body)
      return { ok: true }
    }
    return [seatingEntry]
  })
  let sheet = await openSeatingDashboard()
  expect(within(sheet).getByLabelText('2 personas')).toBeVisible()
  expect(
    within(sheet).getByRole('button', { name: 'Mesa para 3 personas' }),
  ).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(
    within(sheet).getByRole('button', { name: 'Mesa para 4 personas' }),
  )
  fireEvent.click(within(sheet).getByRole('button', { name: 'Terraza' }))
  expect(within(sheet).getByRole('status')).toHaveTextContent(
    'El cliente pidió Interior',
  )
  expect(commands).toHaveLength(0)
  fireEvent.click(within(sheet).getByRole('button', { name: 'Asignar turno' }))
  await waitFor(() =>
    expect(commands).toEqual([
      expect.objectContaining({
        arrivalMode: 'notify',
        seating: { mode: 'confirmed', spaceId: 'outside', seats: 4 },
      }),
    ]),
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Asignar turno' }),
    ).not.toBeInTheDocument(),
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Gestionar turno SEAT' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Asignar próximo turno' }))
  sheet = await screen.findByRole('dialog', { name: 'Asignar turno' })
  expect(
    within(sheet).getByRole('button', { name: 'Interior' }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(
    within(sheet).getByRole('button', { name: 'Mesa para 3 personas' }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(
    within(sheet).queryByRole('button', { name: 'Avisar al cliente' }),
  ).not.toBeInTheDocument()
})
it('requires a space choice for an ambiguous no-preference party', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues')
      ? [seatingService]
      : [{ ...seatingEntry, preferredSpaceId: 'fastest' }],
  )
  const sheet = await openSeatingDashboard()
  const submit = within(sheet).getByRole('button', { name: 'Asignar turno' })
  expect(submit).toBeDisabled()
  fireEvent.click(within(sheet).getByRole('button', { name: 'Terraza' }))
  expect(submit).toBeEnabled()
})
it('freezes and retries the exact confirmed selection after an uncertain result even if the catalogue changes', async () => {
  let updated = false
  const commands: { body: unknown; key: unknown }[] = []
  vi.mocked(api).mockImplementation(async (path, _method, body, key) => {
    if (path.endsWith('/queues'))
      return [
        updated
          ? {
              ...seatingService,
              config: { ...seatingService.config, spaces: [] },
            }
          : seatingService,
      ]
    if (path.endsWith('/commands')) {
      commands.push({ body, key })
      if (commands.length === 1) {
        updated = true
        throw new Error('Network lost')
      }
      return { ok: true }
    }
    return [{ ...seatingEntry, version: updated ? 1 : 0 }]
  })
  const sheet = await openSeatingDashboard()
  fireEvent.click(
    within(sheet).getByRole('button', { name: 'Mesa para 4 personas' }),
  )
  const submit = within(sheet).getByRole('button', { name: 'Asignar turno' })
  fireEvent.click(submit)
  await within(sheet).findByText(/Reintenta la misma acción/)
  await waitFor(() => expect(submit).toBeEnabled())
  expect(
    within(sheet).queryByRole('button', { name: 'Ya está presente' }),
  ).not.toBeInTheDocument()
  fireEvent.click(submit)
  await waitFor(() => expect(commands).toHaveLength(2))
  expect(commands[1]).toEqual(commands[0])
  expect(commands[0]?.body).toMatchObject({
    version: 0,
    seating: { mode: 'confirmed', spaceId: 'inside', seats: 4 },
  })
})
it('asks for review after a definitive conflict without silently choosing a replacement', async () => {
  let updated = false
  const commands: unknown[] = []
  vi.mocked(api).mockImplementation(async (path, _method, body) => {
    if (path.endsWith('/queues'))
      return [
        updated
          ? {
              ...seatingService,
              config: {
                ...seatingService.config,
                spaces: [
                  {
                    id: 'inside',
                    name: 'Interior',
                    tables: 1,
                    tableTypes: [{ seats: 4, count: 1 }],
                  },
                ],
              },
            }
          : seatingService,
      ]
    if (path.endsWith('/commands')) {
      commands.push(body)
      if (commands.length === 1) {
        updated = true
        throw new ApiError(409, 'assignment_seating_changed')
      }
      return { ok: true }
    }
    return [seatingEntry]
  })
  const sheet = await openSeatingDashboard()
  const submit = within(sheet).getByRole('button', { name: 'Asignar turno' })
  fireEvent.click(submit)
  await within(sheet).findByText(/Datos actualizados/)
  expect(submit).toBeDisabled()
  expect(
    within(sheet).queryByRole('button', { name: 'Mesa para 4 personas' }),
  ).not.toBeInTheDocument()
  fireEvent.click(
    within(sheet).getByRole('button', { name: 'Revisar asignación' }),
  )
  expect(within(sheet).getByText('Interior · Mesa para 4')).toBeVisible()
  expect(submit).toBeEnabled()
  fireEvent.click(submit)
  await waitFor(() => expect(commands).toHaveLength(2))
  expect(commands[1]).toMatchObject({
    seating: { mode: 'confirmed', spaceId: 'inside', seats: 4 },
  })
})

it('removes a revoked open queue and discovers assignments again from an empty catalogue', async () => {
  vi.useFakeTimers()
  let visible: QueueSummary[] = [service]
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/queues')) return visible
    if (path.endsWith('/entries'))
      return [
        {
          id: 'private',
          code: 'PRIVATE-TURN',
          partySize: 1,
          status: 'waiting',
          version: 0,
          sequence: 1,
          calledAt: null,
        },
      ]
    return []
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Org',
        role: 'queue_staff',
      }}
    />,
  )
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  fireEvent.click(screen.getByRole('button', { name: 'Ver lista' }))
  expect(screen.getByText('PRIVATE-TURN')).toBeVisible()
  visible = []
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(screen.queryByText('PRIVATE-TURN')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByText('No tienes servicios asignados')).toBeVisible()
  visible = [{ ...service, id: 'new', name: 'Nuevo servicio' }]
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(
    screen.getByRole('article', { name: 'Servicio Nuevo servicio' }),
  ).toBeVisible()
  expect(
    screen.queryByText('No tienes servicios asignados'),
  ).not.toBeInTheDocument()
})

it('drops rows on a direct access denial and refreshes assignments on focus', async () => {
  let visible = [service],
    deny = false
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/queues')) return visible
    if (path.endsWith('/entries')) {
      if (deny) throw new ApiError(404, 'not_found')
      return [
        {
          id: 'private',
          code: 'REVOKED-TURN',
          partySize: 1,
          status: 'waiting',
          version: 0,
          sequence: 1,
          calledAt: null,
        },
      ]
    }
    return []
  })
  render(
    <Dashboard
      venue={{
        id: 'hotel',
        name: 'Hotel',
        organizationId: 'org',
        organizationName: 'Org',
        role: 'queue_staff',
      }}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  expect(await screen.findByText('REVOKED-TURN')).toBeVisible()
  deny = true
  fireEvent.focus(window)
  await waitFor(() =>
    expect(screen.queryByText('REVOKED-TURN')).not.toBeInTheDocument(),
  )
  visible = [{ ...service, id: 'other', name: 'Otro servicio' }]
  deny = false
  fireEvent.focus(window)
  expect(
    await screen.findByRole('article', { name: 'Servicio Otro servicio' }),
  ).toBeVisible()
})

it('does not open a stale configuration form while its baseline is loading or failed', async () => {
  let rejectBaseline!: (error: Error) => void
  const failedBaseline = new Promise<never>((_, reject) => { rejectBaseline = reject })
  let retry = false
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/queues')) return [service]
    if (path.endsWith('/configuration-context')) return retry
      ? { ...service, version: 2, config: { ...service.config, name: 'Prepared configuration' } }
      : failedBaseline
    return []
  })
  render(
    <Dashboard venue={{
      id: 'hotel', name: 'Hotel', organizationId: 'org',
      organizationName: 'Empresa', role: 'owner',
    }} />,
  )
  const open = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Opciones del servicio' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Configurar servicio' }))
  }
  await open()
  await waitFor(() => expect(api).toHaveBeenCalledWith('/queues/restaurant/configuration-context'))
  expect(screen.queryByRole('dialog', { name: 'Configuración restaurante' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Opciones del servicio' })).toBeDisabled()
  await act(async () => { rejectBaseline(new Error('Unavailable')) })
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la configuración')
  expect(screen.queryByRole('dialog', { name: 'Configuración restaurante' })).not.toBeInTheDocument()
  retry = true
  await open()
  const drawer = await screen.findByRole('dialog', { name: 'Configuración restaurante' })
  expect(within(drawer).getByLabelText('Nombre del servicio')).toHaveValue('Prepared configuration')
})


it('opens the automatic conflict sheet when direct arrival loses to expiry', async () => {
  const commands: unknown[] = []
  vi.mocked(api).mockImplementation(async (path, _method, body) => {
    if (path.endsWith('/queues')) return [service]
    if (path.endsWith('/commands')) {
      commands.push(body)
      throw new ApiError(409, 'Already processed', 0, 'turn_automatically_processed')
    }
    if (path.includes('/automation')) return { configured: true, effective: true, activeCycles: 1, serverNow: Date.now() }
    return [{ id: 'called', code: 'C1', status: 'called', partySize: 2, sequence: 1, version: 1, calledAt: Date.now(),
      automationCycle: { id: 'cycle', state: 'active', reason: null, capacity: 2, receptionService: null },
    }]
  })
  render(<Dashboard venue={{ id: 'hotel', name: 'Hotel', organizationId: 'org', organizationName: 'Empresa', role: 'queue_staff' }} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Gestionar turno C1' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Gestionar turno' })).getByRole('button', { name: 'Confirmar llegada' }))
  const conflict = await screen.findByRole('dialog', { name: 'Turno ya procesado' })
  expect(within(conflict).getByText('El sistema ya ha asignado este turno y ha avisado al siguiente cliente. La cola se actualizará automáticamente.')).toBeVisible()
  expect(within(conflict).queryByText(/Confirmar la llegada completará/)).not.toBeInTheDocument()
  expect(within(conflict).queryByRole('group', { name: 'Cliente' })).not.toBeInTheDocument()
  expect(commands).toEqual([{ action: 'complete', entryId: 'called', version: 1 }])
  fireEvent.click(within(conflict).getByRole('button', { name: 'Entendido' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Turno ya procesado' })).not.toBeInTheDocument())
  expect(commands).toHaveLength(1)
})

it('keeps confirmed table capacity in turn details rather than the compact card', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/queues')) return [service]
    if (path.includes('/automation')) return { configured: true, effective: true, activeCycles: 1, serverNow: Date.now() }
    return [{ id: 'called', code: 'C1', status: 'called', partySize: 2, sequence: 1, version: 1, calledAt: Date.now(),
      assignedSeating: { spaceId: 'inside', spaceName: 'Interior', seats: 4 },
    }]
  })
  render(<Dashboard venue={{ id: 'hotel', name: 'Hotel', organizationId: 'org', organizationName: 'Empresa', role: 'queue_staff' }} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  const manage = await screen.findByRole('button', { name: 'Gestionar turno C1' })
  expect(screen.queryByText(/Mesa para 4/)).not.toBeInTheDocument()
  fireEvent.click(manage)
  expect(within(await screen.findByRole('dialog', { name: 'Gestionar turno' })).getByText('Mesa para 4')).toHaveClass('sr-only')
})

it.each(['queue_staff', 'viewer'] as const)('lets %s read a paused historical cycle without reopening actions', async (role) => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/queues')) return [service]
    if (path.includes('/automation')) return { configured: true, effective: true, activeCycles: 1, serverNow: Date.now() }
    return [{ id: 'completed', code: 'C1', status: 'completed', partySize: 2, sequence: 1, version: 1, calledAt: Date.now(),
      automationCycle: { id: 'cycle', state: 'stopped', reason: 'arrived', capacity: 4, receptionService: null },
    }]
  })
  render(<Dashboard venue={{ id: 'hotel', name: 'Hotel', organizationId: 'org', organizationName: 'Empresa', role }} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Completados' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle del turno C1' }))
  const detail = await screen.findByRole('dialog', { name: 'Detalle del turno' })
  expect(within(detail).getByText('Ciclo pausado')).toBeVisible()
  expect(within(detail).getByText('Se confirmó la llegada de este turno.')).toBeVisible()
  expect(within(detail).queryByRole('button', { name: 'Asignar próximo turno' })).not.toBeInTheDocument()
  expect(within(detail).queryByRole('button', { name: 'Cancelar turno' })).not.toBeInTheDocument()
})

it.each(['restaurant', 'pool', 'reception'] as const)('renders the correct manual footer container for %s', async type => {
  vi.mocked(api).mockImplementation(async path => {
    if (path.endsWith('/queues')) return [{ ...service, config: { ...service.config, type, automaticAssignmentEnabled: false } }]
    if (path.includes('/automation')) return { configured: false, effective: false, activeCycles: 0, serverNow: Date.now(), nextEntry: { id: 'waiting', version: 0 } }
    return [{ id: 'waiting', code: 'W1', status: 'waiting', partySize: 2, sequence: 1, version: 0, calledAt: null }]
  })
  render(<Dashboard venue={{ id: 'hotel', name: 'Hotel', organizationId: 'org', organizationName: 'Empresa', role: 'queue_staff' }} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  await screen.findByRole('button', { name: 'Gestionar turno W1' })
  const footer = document.querySelector('[data-queue-automation-footer]')
  if (type === 'restaurant') {
    expect(footer).not.toBeInTheDocument()
  } else {
    expect(footer).toBeInTheDocument()
    expect(within(footer as HTMLElement).getByRole('button', { name: 'Asignar próximo turno' })).toBeEnabled()
    expect(within(footer as HTMLElement).queryByRole('status')).not.toBeInTheDocument()
  }
})

describe('direct assignment from quick-service management', () => {
  const guest = { id: 'managed-guest', code: 'DIRECT', displayName: 'Cliente directo', status: 'waiting', partySize: 1, version: 2, sequence: 3, calledAt: null, manualOnly: true, assignment: { available: true, spaceName: null, priorityRequired: false, token: 'original-token' } }
  async function openManager() {
    render(<Dashboard venue={{ id: 'hotel', name: 'Hotel', organizationId: 'org', organizationName: 'Empresa', role: 'queue_staff' }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
    const trigger = await screen.findByRole('button', { name: 'Gestionar turno DIRECT' })
    fireEvent.click(trigger)
    const manager = await screen.findByRole('dialog', { name: 'Gestionar turno' })
    return { trigger, button: within(manager).getByRole('button', { name: 'Asignar próximo turno' }) }
  }
  function setup(type: 'pool' | 'reception', automatic: boolean, send: (body: unknown, key: unknown) => Promise<unknown>, current = () => guest) {
    vi.mocked(api).mockImplementation(async (path, _method, body, key) => {
      if (path.endsWith('/queues')) return [{ ...service, config: { ...service.config, type, automaticAssignmentEnabled: automatic } }]
      if (path.includes('/automation')) return { configured: automatic, effective: automatic, activeCycles: 0, serverNow: Date.now(), nextEntry: { id: 'different-head', version: 0 } }
      if (path.endsWith('/commands')) return send(body, key)
      if (path.endsWith('/entries')) return [current()]
      return []
    })
  }
  it.each([['pool', false], ['pool', true], ['reception', false], ['reception', true]] as const)('calls the selected %s entry directly (automatic=%s), not assign_next', async (type, automatic) => {
    const sends: unknown[] = []
    let finish!: (value: unknown) => void
    setup(type, automatic, async body => { sends.push(body); return new Promise(resolve => { finish = resolve }) })
    const { trigger, button } = await openManager()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(screen.queryByRole('dialog', { name: 'Asignar turno' })).not.toBeInTheDocument()
    expect(sends).toEqual([{ action: 'call', entryId: guest.id, version: 2, arrivalMode: 'notify', assignmentToken: 'original-token' }])
    await act(async () => finish({ ok: true }))
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('dialog', { name: 'Asignar turno' })).not.toBeInTheDocument()
    expect(sends).toHaveLength(1)
  })
  it('opens recovery only on uncertain result and retries the identical body and key after a refresh', async () => {
    let updated = false
    const requests: { body: unknown; key: unknown }[] = []
    setup('reception', true, async (body, key) => {
      requests.push({ body, key })
      if (requests.length === 1) { updated = true; throw new TypeError('Network lost') }
      return { ok: true }
    }, () => updated ? { ...guest, version: 3, assignment: { ...guest.assignment, token: 'new-token' } } : guest)
    const { button } = await openManager()
    fireEvent.click(button)
    const recovery = await screen.findByRole('dialog', { name: 'Asignar turno' })
    await within(recovery).findByText(/Reintenta la misma acción/)
    const retry = within(recovery).getByRole('button', { name: 'Asignar turno' })
    await waitFor(() => expect(retry).toBeEnabled())
    fireEvent.click(retry)
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toEqual(requests[0])
    expect(requests[0]?.body).toMatchObject({ version: 2, assignmentToken: 'original-token' })
  })
  it('requires explicit confirmation with fresh version/token/key after a definitive conflict', async () => {
    let updated = false
    const requests: { body: unknown; key: unknown }[] = []
    setup('pool', false, async (body, key) => {
      requests.push({ body, key })
      if (requests.length === 1) { updated = true; throw new ApiError(409, 'version_conflict') }
      return { ok: true }
    }, () => updated ? { ...guest, version: 3, assignment: { ...guest.assignment, token: 'new-token' } } : guest)
    fireEvent.click((await openManager()).button)
    const recovery = await screen.findByRole('dialog', { name: 'Asignar turno' })
    await within(recovery).findByText(/Datos actualizados/)
    expect(requests).toHaveLength(1)
    fireEvent.click(within(recovery).getByRole('button', { name: 'Asignar turno' }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]?.body).toMatchObject({ action: 'call', entryId: guest.id, version: 3, assignmentToken: 'new-token' })
    expect(requests[1]?.key).not.toBe(requests[0]?.key)
  })
  it('shows automatic-conflict feedback instead of retrying an already assigned entry', async () => {
    const sends: unknown[] = []
    setup('reception', true, async body => { sends.push(body); throw new ApiError(409, 'Already assigned', 0, 'turn_automatically_assigned') })
    fireEvent.click((await openManager()).button)
    const conflict = await screen.findByRole('dialog', { name: 'Turno ya procesado' })
    expect(within(conflict).queryByRole('button', { name: 'Asignar turno' })).not.toBeInTheDocument()
    fireEvent.click(within(conflict).getByRole('button', { name: 'Entendido' }))
    expect(sends).toHaveLength(1)
  })
})
