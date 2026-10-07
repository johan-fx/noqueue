import '@testing-library/jest-dom/vitest'
import {
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
  cleanup()
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
it('blocks advance and explains how to resurvey invalidated managed inventory', async () => {
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
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/queues')
      ? [invalidated]
      : [
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
  await openCardAdvanced()
  expect(await screen.findByText(/La distribución ha cambiado/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Atrás' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
  expect(
    screen.queryByRole('button', { name: 'Avanzar un turno' }),
  ).not.toBeInTheDocument()
})

it.each(['pending', 'active'] as const)(
  'presents %s readiness without confusing the shared pending Alert with active status',
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
    expect(
      within(card).queryByText('Gestión inteligente pendiente'),
    ).not.toBeInTheDocument()
    await openCardAdvanced()
    expect(
      await screen.findByText(
        state === 'pending'
          ? 'Gestión inteligente pendiente'
          : 'Gestión inteligente activa',
      ),
    ).toBeVisible()
    expect(
      screen.getByText(
        'Falta configurar los tipos de mesa o grupos de plazas.',
      ),
    ).toBeVisible()
  },
)
it.each([false, true])(
  'prioritizes the initial inventory task and uses server schedule feedback (confirmed %s)',
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
    expect(
      await screen.findByText(
        confirmed ? 'Gestión inteligente activa' : 'Confirma la ocupación',
      ),
    ).toBeVisible()
  },
)
it('offers configuration instead of inventory confirmation when table groups are missing', async () => {
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
  expect(screen.queryByText('Fuera de horario')).not.toBeInTheDocument()
})
it('keeps corrections reachable for retained external occupancy in a closed invalidated queue', async () => {
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
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Desglose y correcciones de ocupación',
    }),
  )
  expect(
    await screen.findByRole('dialog', {
      name: 'Actualizar ocupación · Restaurante',
    }),
  ).toBeVisible()
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
it('keeps service Card actions minimal and moves operations into the queue header menu', async () => {
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
  ).toEqual(['Configuración avanzada', 'Mesa libre'])
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
  fireEvent.click(within(sheet).getByRole('button', { name: 'Cancelar' }))
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
it('keeps the initial occupancy CTA visible even when intelligence is manually disabled', async () => {
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
  expect(
    screen.queryByRole('button', { name: 'Confirmar ocupación' }),
  ).not.toBeInTheDocument()
  await openCardAdvanced()
  expect(
    await screen.findByRole('button', {
      name: 'Desglose y correcciones de ocupación',
    }),
  ).toBeVisible()
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
    within(drawer).getByRole('button', { name: 'Acciones del turno A1' }),
  )
  const advance = within(drawer).getByRole('button', {
    name: 'Asignar turno',
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
    await screen.findByRole('button', { name: 'Acciones del turno T1' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar llegada' }))
  await waitFor(() => expect(commands).toHaveLength(1))
  expect(
    screen.queryByRole('dialog', { name: 'Confirmar llegada' }),
  ).not.toBeInTheDocument()
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Acciones del turno T1' }),
    ).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Acciones del turno T1' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar llegada' }))
  await waitFor(() => expect(commands).toHaveLength(2))
  expect(commands[0]!.body).toMatchObject({ version: 0, action: 'complete' })
  expect(commands[1]!.body).toMatchObject({ version: 1, action: 'complete' })
  expect(commands[1]!.key).not.toBe(commands[0]!.key)
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
        name: 'Acciones del turno ELIGIBLE',
      }),
    )
    const advance = screen.getByRole('button', { name: 'Asignar turno' })
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
        name: 'Acciones del turno STRICT',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Asignar turno' }))
    const sheet = await screen.findByRole('dialog', { name: 'Asignar turno' })
    expect(
      within(sheet).getByRole('checkbox', { name: 'Cliente ya presente' }),
    ).not.toBeChecked()
    expect(
      within(sheet).getByRole('checkbox', { name: 'Cliente ya presente' }),
    ).toHaveAttribute('data-slot', 'checkbox')
    const submit = within(sheet).getByRole('button', { name: 'Confirmar' })
    const present = within(sheet).getByRole('checkbox', {
      name: 'Cliente ya presente',
    })
    fireEvent.click(present)
    expect(present).toBeChecked()
    fireEvent.click(present)
    expect(present).not.toBeChecked()
    if (available) {
      expect(submit).toBeEnabled()
      fireEvent.click(present)
      fireEvent.click(submit)
      await waitFor(() =>
        expect(api).toHaveBeenCalledWith(
          '/queues/restaurant/commands',
          'POST',
          expect.objectContaining({ action: 'call', arrivalMode: 'present' }),
          expect.any(String),
        ),
      )
    } else expect(submit).toBeDisabled()
  },
)

it('returns cancelled entry confirmation focus to its persistent action trigger', async () => {
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
    name: 'Acciones del turno F1',
  })
  fireEvent.click(trigger)
  const cancel = screen.getByRole('button', {
    name: 'Cancelar turno',
  })
  cancel.focus()
  fireEvent.click(cancel)
  const dialog = await screen.findByRole('dialog', {
    name: '¿Estás seguro de que quieres cancelar el turno?',
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'No cancelar' }))
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
      return [{ ...service, queueState: active ? 'active' : 'inactive' }]
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
    expect(commands).toEqual([{ action: 'assign_next' }])
    expect(
      screen.queryByRole('dialog', { name: 'Asignar turno' }),
    ).not.toBeInTheDocument()
    resolve()
    await waitFor(() => expect(next).toBeEnabled())
  },
)
