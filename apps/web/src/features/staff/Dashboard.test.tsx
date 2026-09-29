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
import { api } from './api'

vi.mock('./api', () => ({ api: vi.fn(), errorMessage: String }))
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
        path.endsWith('/queues') ? [service] : [],
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
        ).getByRole('button', { name: 'Gestionar cola' }),
      ).toBeVisible()
      expect(
        screen.queryByRole('button', { name: 'Añadir servicio' }) !== null,
      ).toBe(configure)
      expect(
        within(
          within(list).getByRole('article', { name: 'Servicio Restaurante' }),
        ).queryByRole('button', { name: 'Configurar servicio' }) !== null,
      ).toBe(configure)
      expect(screen.queryByRole('button', { name: 'Accesos' }) !== null).toBe(
        members,
      )
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
  expect(
    await screen.findByRole('button', { name: 'Ver cola' }),
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Gestionar cola' }),
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Configurar servicio' }),
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
  fireEvent.click(
    await screen.findByRole('button', { name: 'Gestionar cola' }),
  )
  expect(
    await screen.findByRole('button', { name: 'Avanzar un turno' }),
  ).toBeDisabled()
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
  expect(await screen.findByText(/La distribución ha cambiado/)).toBeVisible()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Gestionar cola' }),
  )
  expect(
    await screen.findByRole('button', { name: 'Avanzar un turno' }),
  ).toBeDisabled()
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
    if (state === 'pending') {
      const alert = within(card).getByRole('alert')
      expect(alert).toHaveAttribute('data-slot', 'alert')
      expect(
        within(alert).getByText('Gestión inteligente pendiente'),
      ).toHaveAttribute('data-slot', 'alert-title')
      const description = alert.querySelector(
        '[data-slot="alert-description"]',
      )
      expect(description).toHaveTextContent(
        'Falta configurar los tipos de mesa o grupos de plazas.',
      )
    } else {
      expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
      expect(
        within(card).getByText('Gestión inteligente activa'),
      ).toBeVisible()
      expect(
        within(card).queryByText('Gestión inteligente pendiente'),
      ).not.toBeInTheDocument()
    }
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
              inventoryConfirmed: confirmed,
              outsideSchedule: true,
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
    expect(await screen.findByText('Cola habilitada')).toBeVisible()
    expect(screen.getByText('Fuera de horario')).toBeVisible()
    if (!confirmed)
      expect(
        within(screen.getByRole('alert')).getByRole('button', {
          name: 'Confirmar ocupación',
        }),
      ).toBeVisible()
    else
      expect(
        screen.queryByRole('button', { name: 'Actualizar ocupación' }),
      ).not.toBeInTheDocument()
    expect(
      screen.getByText(
        confirmed
          ? 'Gestión inteligente activa'
          : 'La cola está abierta, pero todavía no sabemos cuántas mesas están ocupadas.',
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
  expect(
    await screen.findByRole('button', { name: 'Configurar servicio' }),
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
  const manage = await screen.findByRole('button', { name: 'Gestionar cola' })
  const toggle = screen.getByRole('switch', { name: 'Abrir cola' })
  fireEvent.click(manage)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Opciones de la cola' }),
  )
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Actualizar ocupación' }),
  )
  expect(
    await screen.findByRole('dialog', {
      name: 'Actualizar ocupación · Restaurante',
    }),
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Confirmar ocupación' }),
  ).not.toBeInTheDocument()
  expect(toggle).not.toBeChecked()
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
    expect(await screen.findByText('Desactivada manualmente')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Gestionar cola' }))
    if (role === 'queue_staff') {
      fireEvent.click(
        await screen.findByRole('button', { name: 'Opciones de la cola' }),
      )
      expect(
        await screen.findByRole('menuitem', {
          name: 'Volver a gestión automática',
        }),
      ).toBeVisible()
    } else
      expect(
        screen.queryByRole('button', { name: 'Opciones de la cola' }),
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
    'Gestionar colaConfigurar servicio',
  )
  fireEvent.click(
    within(card).getByRole('button', { name: 'Gestionar cola' }),
  )
  const drawer = await screen.findByRole('dialog', { name: 'Gestionar cola' })
  expect(
    within(drawer).queryByRole('button', { name: 'Cerrar' }),
  ).not.toBeInTheDocument()
  fireEvent.click(
    within(drawer).getByRole('button', { name: 'Opciones de la cola' }),
  )
  expect(
    (await screen.findAllByRole('menuitem')).map((item) => item.textContent),
  ).toEqual(['Actualizar ocupación', 'Desactivar gestión inteligente'])
})
it('returns nested operation sheets to the queue menu trigger after cancel and save, then back closes only the drawer', async () => {
  let disabled = false
  vi.mocked(api).mockImplementation(async (path, method, body) => {
    if (path.endsWith('/queues'))
      return [
        {
          ...service,
          open: 1,
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
      disabled =
        (body as { action: string }).action === 'disable_intelligence'
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
  fireEvent.click(
    await screen.findByRole('button', { name: 'Gestionar cola' }),
  )
  const trigger = await screen.findByRole('button', {
    name: 'Opciones de la cola',
  })
  fireEvent.click(trigger)
  fireEvent.click(
    await screen.findByRole('menuitem', {
      name: 'Desactivar gestión inteligente',
    }),
  )
  let sheet = await screen.findByRole('dialog', {
    name: 'Desactivar gestión inteligente · Restaurante',
  })
  fireEvent.click(within(sheet).getByRole('button', { name: 'Cancelar' }))
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(screen.getByRole('dialog', { name: 'Gestionar cola' })).toBeVisible()
  expect(
    vi.mocked(api).mock.calls.filter(([, method]) => method === 'POST'),
  ).toHaveLength(0)
  fireEvent.click(trigger)
  fireEvent.click(
    await screen.findByRole('menuitem', {
      name: 'Desactivar gestión inteligente',
    }),
  )
  sheet = await screen.findByRole('dialog', {
    name: 'Desactivar gestión inteligente · Restaurante',
  })
  const confirm = within(sheet).getByRole('button', {
    name: 'Desactivar gestión inteligente',
  })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
  await waitFor(() => expect(trigger).toHaveFocus())
  fireEvent.click(trigger)
  expect(
    await screen.findByRole('menuitem', {
      name: 'Volver a gestión automática',
    }),
  ).toBeVisible()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
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
  fireEvent.click(await screen.findByRole('button', { name: 'Ver cola' }))
  const drawer = await screen.findByRole('dialog', { name: 'Ver cola' })
  expect(
    within(drawer).queryByRole('button', { name: 'Opciones de la cola' }),
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
  expect(
    within(await screen.findByRole('alert')).getByRole('button', {
      name: 'Confirmar ocupación',
    }),
  ).toBeVisible()
  expect(screen.getByText('Desactivada manualmente')).toBeVisible()
})
it('omits queue footer in non-active tabs and keeps advance connected to the existing confirmation', async () => {
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
  fireEvent.click(
    await screen.findByRole('button', { name: 'Gestionar cola' }),
  )
  const drawer = await screen.findByRole('dialog', { name: 'Gestionar cola' })
  for (const tab of ['Completados', 'Cancelados']) {
    fireEvent.click(within(drawer).getByRole('tab', { name: tab }))
    expect(drawer.querySelector('[data-slot="drawer-footer"]')).toBeNull()
  }
  fireEvent.click(within(drawer).getByRole('tab', { name: 'Lista' }))
  const advance = within(drawer).getByRole('button', {
    name: 'Avanzar un turno',
  })
  await waitFor(() => expect(advance).toBeEnabled())
  fireEvent.click(advance)
  expect(await screen.findByText(/Turno A1/)).toBeVisible()
})
