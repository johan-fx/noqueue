import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VenueLogoUpload } from './VenueLogoUpload'

afterEach(() => {
  cleanup()
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

describe('VenueLogoUpload', () => {
  it('supports drag-and-drop and reports the selected file without uploading it', () => {
    mockObjectUrls()
    const onFileChange = vi.fn()
    render(
      <VenueLogoUpload optional onFileChange={onFileChange} />,
    )
    const file = new File(['png bytes'], 'brand.png', { type: 'image/png' })
    const dropzone = screen.getByRole('button', { name: 'Subir logotipo' })

    fireEvent.dragEnter(dropzone)
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })

    expect(screen.getByText('brand.png')).toBeVisible()
    expect(onFileChange).toHaveBeenCalledWith(file)
  })

  it('rejects unsupported formats and files larger than five MiB', () => {
    mockObjectUrls()
    const onFileChange = vi.fn()
    render(<VenueLogoUpload onFileChange={onFileChange} />)
    const input = screen.getByLabelText('Archivo de logotipo')
    const wrongType = new File(['text'], 'brand.txt', { type: 'text/plain' })

    fireEvent.change(input, { target: { files: [wrongType] } })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Selecciona un archivo PNG, JPG o SVG válido.',
    )
    expect(onFileChange).not.toHaveBeenCalled()

    const tooLarge = new File(
      [new Uint8Array(5 * 1024 * 1024 + 1)],
      'oversized.png',
      { type: 'image/png' },
    )
    fireEvent.change(input, { target: { files: [tooLarge] } })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'El archivo supera el tamaño máximo de 5 MB.',
    )
    expect(onFileChange).not.toHaveBeenCalled()
  })

  it('stages remove explicitly and renders the uploaded preview metadata', () => {
    const onRemove = vi.fn()
    render(
      <VenueLogoUpload
        logo={{
          url: 'https://assets.example/brand.png',
          name: 'brand.png',
          type: 'image/png',
          size: 2450,
        }}
        onRemove={onRemove}
      />,
    )

    expect(screen.getByText('brand.png')).toBeVisible()
    expect(screen.getByRole('img', { name: 'Previsualización del logotipo' }))
      .toHaveAttribute('src', 'https://assets.example/brand.png')
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})
