import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { Commercial } from './Commercial'
import { api } from './api'
vi.mock('./api', () => ({ api: vi.fn(), errorMessage: String }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const customer = {
  id: 'org',
  name: 'Empresa',
  slug: 'empresa',
  status: 'active',
  venueId: 'hotel',
  venueName: 'Hotel',
}
it('renders platform cards as links without eager service requests and paginates', async () => {
  vi.mocked(api).mockResolvedValue({
    items: [customer],
    page: 2,
    hasMore: true,
  })
  render(
    <MemoryRouter initialEntries={['/staff?page=2']}>
      <Commercial />
    </MemoryRouter>,
  )
  expect(await screen.findByRole('link', { name: /Hotel/ })).toHaveAttribute(
    'href',
    '/staff/establishments/hotel',
  )
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /Acciones de/ }),
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'Página siguiente' }),
  ).toHaveAttribute('href', '/staff?page=3')
  expect(api).toHaveBeenCalledTimes(1)
  expect(api).toHaveBeenCalledWith('/commercial/organizations?page=2')
})
it('normalizes invalid pages and links operator cards without menus or eager service requests', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes('/commercial/')
      ? { items: [customer], page: 1, hasMore: false }
      : [],
  )
  render(
    <MemoryRouter initialEntries={['/staff?page=-2']}>
      <Commercial />
    </MemoryRouter>,
  )
  expect(await screen.findByRole('link', { name: /Hotel/ })).toHaveAttribute(
    'href',
    '/staff/establishments/hotel',
  )
  expect(
    screen.queryByRole('button', { name: /Acciones de/ }),
  ).not.toBeInTheDocument()
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/commercial/organizations?page=1'),
  )
  expect(api).toHaveBeenCalledTimes(1)
  expect(
    screen.queryByRole('navigation', {
      name: 'Paginación de establecimientos',
    }),
  ).not.toBeInTheDocument()
})

it('shows a retryable error and an empty out-of-range page with a usable previous link', async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ items: [], page: 9, hasMore: false })
  render(
    <MemoryRouter initialEntries={['/staff?page=9']}>
      <Commercial />
    </MemoryRouter>,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('offline')
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar listado' }))
  expect(
    await screen.findByText('No hay establecimientos en esta página.'),
  ).toBeVisible()
  expect(
    screen.getByRole('link', { name: 'Página anterior' }),
  ).toHaveAttribute('href', '/staff?page=8')
  expect(
    screen.getByRole('link', { name: 'Página siguiente' }),
  ).toHaveAttribute('aria-disabled', 'true')
})

it.each([0, 24])(
  'hides the paginator with %i entries on the only page',
  async (count) => {
    vi.mocked(api).mockResolvedValue({
      items: Array.from({ length: count }, (_, i) => ({
        ...customer,
        venueId: `hotel-${i}`,
      })),
      page: 1,
      hasMore: false,
    })
    render(
      <MemoryRouter>
        <Commercial />
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(
        screen.queryByText('Cargando establecimientos…'),
      ).not.toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('navigation', {
        name: 'Paginación de establecimientos',
      }),
    ).not.toBeInTheDocument()
  },
)
it('shows pagination when there are at least 25 establishments', async () => {
  vi.mocked(api).mockResolvedValue({
    items: Array.from({ length: 24 }, (_, index) => ({
      ...customer,
      venueId: `hotel-${index}`,
    })),
    page: 1,
    hasMore: true,
  })
  render(
    <MemoryRouter>
      <Commercial />
    </MemoryRouter>,
  )
  expect(await screen.findAllByRole('link', { name: /Hotel/ })).toHaveLength(
    24,
  )
  expect(
    screen.getByRole('navigation', {
      name: 'Paginación de establecimientos',
    }),
  ).toBeVisible()
})
