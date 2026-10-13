import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VenueLogoState } from '@noqueue/contracts/staff'
import { ApiError } from './api'
import { deleteVenueLogo, getVenueLogo, putVenueLogo } from './logo-api'
import { VenueLogoEditor } from './VenueLogoEditor'

vi.mock('./logo-api', () => ({
  deleteVenueLogo: vi.fn(),
  getVenueLogo: vi.fn(),
  putVenueLogo: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

function mockObjectUrls() {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:logo-preview'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
}

const savedState: VenueLogoState = {
  logo: {
    url: 'https://assets.example/old.png',
    name: 'old.png',
    type: 'image/png',
    size: 500,
  },
  logoVersion: 4,
  canEditLogo: true,
}

describe('VenueLogoEditor', () => {
  it('does not expose editing to users without permission', () => {
    render(
      <VenueLogoEditor
        venueId="venue-1"
        venueName="Hotel"
        state={{ ...savedState, canEditLogo: false }}
        onStateChange={vi.fn()}
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'Editar logotipo de Hotel' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Logotipo de Hotel' })).toHaveAttribute(
      'src',
      savedState.logo?.url,
    )
  })

  it('keeps a staged deletion local when the dialog is canceled', async () => {
    render(
      <VenueLogoEditor
        venueId="venue-1"
        venueName="Hotel"
        state={savedState}
        onStateChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Editar logotipo de Hotel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(deleteVenueLogo).not.toHaveBeenCalled()
    expect(putVenueLogo).not.toHaveBeenCalled()
  })

  it('uploads an edited image with the current version and updates the dashboard state', async () => {
    mockObjectUrls()
    const onStateChange = vi.fn()
    const nextState: VenueLogoState = {
      logo: {
        url: 'https://assets.example/new.png',
        name: 'new.png',
        type: 'image/png',
        size: 800,
      },
      logoVersion: 5,
      canEditLogo: true,
    }
    vi.mocked(putVenueLogo).mockResolvedValue(nextState)
    const view = render(
      <VenueLogoEditor
        venueId="venue-1"
        venueName="Hotel"
        state={savedState}
        onStateChange={onStateChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Editar logotipo de Hotel' }))
    const file = new File(['png bytes'], 'new.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Archivo de logotipo'), {
      target: { files: [file] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(putVenueLogo).toHaveBeenCalledTimes(1))
    const [, uploadedFile, version, requestKey] = vi.mocked(putVenueLogo).mock.calls[0]!
    expect(uploadedFile).toBe(file)
    expect(version).toBe(4)
    expect(requestKey).toMatch(/^[0-9a-f-]{36}$/i)
    expect(onStateChange).toHaveBeenCalledWith(nextState)
    view.rerender(
      <VenueLogoEditor
        venueId="venue-1"
        venueName="Hotel"
        state={nextState}
        onStateChange={onStateChange}
      />,
    )
    await waitFor(() => expect(screen.getByRole('img', { name: 'Logotipo de Hotel' })).toHaveAttribute('src', nextState.logo?.url))
  })

  it('retries an uncertain upload using the same idempotency key', async () => {
    mockObjectUrls()
    vi.mocked(putVenueLogo)
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValue({ ...savedState, logoVersion: 5 })
    render(
      <VenueLogoEditor
        venueId="venue-1"
        venueName="Hotel"
        state={savedState}
        onStateChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Editar logotipo de Hotel' }))
    const file = new File(['png bytes'], 'new.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Archivo de logotipo'), {
      target: { files: [file] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(putVenueLogo).toHaveBeenCalledTimes(2))
    expect(vi.mocked(putVenueLogo).mock.calls[0]?.slice(0, 3)).toEqual([
      'venue-1',
      file,
      4,
    ])
    expect(vi.mocked(putVenueLogo).mock.calls[1]?.slice(0, 3)).toEqual([
      'venue-1',
      file,
      4,
    ])
    expect(vi.mocked(putVenueLogo).mock.calls[1]?.[3]).toBe(
      vi.mocked(putVenueLogo).mock.calls[0]?.[3],
    )
  })

  it('refreshes after a version conflict and does not overwrite automatically', async () => {
    mockObjectUrls()
    const latest: VenueLogoState = {
      ...savedState,
      logo: { ...savedState.logo!, url: 'https://assets.example/latest.png' },
      logoVersion: 5,
    }
    vi.mocked(putVenueLogo).mockRejectedValue(
      new ApiError(409, 'conflict', 0, 'logo_version_conflict'),
    )
    vi.mocked(getVenueLogo).mockResolvedValue(latest)
    const onStateChange = vi.fn()
    render(
      <VenueLogoEditor
        venueId="venue-1"
        venueName="Hotel"
        state={savedState}
        onStateChange={onStateChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Editar logotipo de Hotel' }))
    fireEvent.change(screen.getByLabelText('Archivo de logotipo'), {
      target: { files: [new File(['png'], 'new.png', { type: 'image/png' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(
      await screen.findByText(/El logotipo cambió mientras lo editabas/),
    ).toBeVisible()
    expect(getVenueLogo).toHaveBeenCalledWith('venue-1')
    expect(onStateChange).toHaveBeenCalledWith(latest)
    expect(putVenueLogo).toHaveBeenCalledTimes(1)
    expect(deleteVenueLogo).not.toHaveBeenCalled()
  })
})
