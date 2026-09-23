import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
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
      const list = screen.getByRole('region', { name: 'Listado de servicios' })
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
      expect(
        screen.queryByRole('button', { name: 'Accesos' }) !== null,
      ).toBe(members)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(
        screen.queryByLabelText('Nombre del servicio'),
      ).not.toBeInTheDocument()
    },
  )
})
