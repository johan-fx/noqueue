import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientInput } from './CreateEstablishmentDrawer'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { api } from './api'
import { putVenueLogo } from './logo-api'
import { Commercial } from './Commercial'

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
}))
vi.mock('./logo-api', () => ({
  getVenueLogo: vi.fn(),
  putVenueLogo: vi.fn(),
}))
vi.mock('./CreateEstablishmentDrawer', () => ({
  CreateEstablishmentDrawer: ({
    onComplete,
    createDisabled,
  }: {
    onComplete: (
      client: ClientInput,
      service: ServiceInput,
      file: File | null,
    ) => void | Promise<void>
    createDisabled?: boolean
  }) => (
    <button
      type="button"
      disabled={createDisabled}
      onClick={() => void onComplete(client, service, logoFile)}
    >
      Simular alta
    </button>
  ),
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

const logoFile = new File(['logo bytes'], 'brand.png', { type: 'image/png' })
const client = {
  locationToken: 'signed-location',
  locationOperationId: 'location-operation',
  organizationName: 'Hotel Sol',
  slug: 'hotel-sol',
  venueName: 'Sol Centro',
  timezone: 'Europe/Madrid',
  ownerName: 'Ana Ruiz',
  ownerUsername: 'ana.ruiz',
  ownerPassword: 'a-secure-password-that-is-long-enough',
} as ClientInput
const service = { name: 'Restaurante', type: 'restaurant' } as ServiceInput

describe('commercial logo upload after provisioning', () => {
  it('keeps the created venue and retries only the logo upload with the same request key', async () => {
    vi.mocked(api).mockImplementation(async (path, method) => {
      if (path === '/commercial/organizations' && method === 'POST')
        return { venueId: 'venue-1' }
      if (path.startsWith('/commercial/organizations?'))
        return { items: [], hasMore: false }
      return {}
    })
    vi.mocked(putVenueLogo)
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValue({ logo: null, logoVersion: 1, canEditLogo: true })

    render(
      <MemoryRouter>
        <Commercial />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Simular alta' }))

    const retry = await screen.findByRole('button', {
      name: 'Reintentar subida del logotipo',
    })
    expect(screen.getByText(/El establecimiento ya está creado/)).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Simular alta' }),
    ).toBeDisabled()
    expect(
      vi.mocked(api).mock.calls.filter(([, method]) => method === 'POST'),
    ).toHaveLength(1)

    fireEvent.click(retry)

    await waitFor(() => expect(putVenueLogo).toHaveBeenCalledTimes(2))
    const first = vi.mocked(putVenueLogo).mock.calls[0]!
    const second = vi.mocked(putVenueLogo).mock.calls[1]!
    expect(first).toEqual(second)
    expect(first[0]).toBe('venue-1')
    expect(first[1]).toBe(logoFile)
    expect(first[2]).toBe(0)
    expect(first[3]).toMatch(/^[0-9a-f-]{36}$/i)
    expect(
      vi.mocked(api).mock.calls.filter(([, method]) => method === 'POST'),
    ).toHaveLength(1)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Reintentar subida/ })).not.toBeInTheDocument(),
    )
  })
})
