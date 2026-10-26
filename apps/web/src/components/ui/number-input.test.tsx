import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { NumberInput } from './number-input'
afterEach(cleanup)
it('keeps an empty draft empty through blur and replaces it without inserting zero', () => {
  const changed = vi.fn()
  function Harness() {
    const [value, setValue] = useState(10)
    return <NumberInput aria-label="Mesas" required min={1} value={value} onValueChange={n => { changed(n); setValue(n) }} />
  }
  render(<Harness />)
  const input = screen.getByLabelText('Mesas') as HTMLInputElement
  fireEvent.change(input, { target: { value: '' } })
  expect(changed).toHaveBeenLastCalledWith(NaN)
  expect(input).toHaveValue(null)
  fireEvent.blur(input)
  expect(input).toHaveValue(null)
  expect(input.checkValidity()).toBe(false)
  fireEvent.change(input, { target: { value: '24' } })
  expect(input).toHaveValue(24)
  expect(input.checkValidity()).toBe(true)
})
it('syncs external reset, keeps zero distinct from empty and respects native constraints', () => {
  const props = { 'aria-label': 'Minutos', onValueChange: vi.fn(), min: 0, max: 60 }
  const { rerender } = render(<NumberInput {...props} value={NaN} />)
  expect(screen.getByLabelText('Minutos')).toHaveValue(null)
  rerender(<NumberInput {...props} value={0} />)
  expect(screen.getByLabelText('Minutos')).toHaveValue(0)
  rerender(<NumberInput {...props} value={61} disabled />)
  expect(screen.getByLabelText('Minutos')).toHaveValue(61)
  expect(screen.getByLabelText('Minutos')).toBeDisabled()
})
