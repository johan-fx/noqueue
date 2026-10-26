import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TimeInput } from './date-picker-09'

afterEach(cleanup)
function setup() {
  const onChange = vi.fn()
  render(<TimeInput id="until" label="Hasta" value="23:00" onChange={onChange} showClock={false} />)
  return { input: screen.getByLabelText('Hasta') as HTMLInputElement, onChange }
}
it('opens the native picker on a user click without suppressing default editing', () => {
  const { input } = setup()
  const showPicker = vi.fn()
  Object.defineProperty(input, 'showPicker', { value: showPicker })
  expect(fireEvent.click(input)).toBe(true)
  expect(showPicker).toHaveBeenCalledOnce()
  expect(input.className).not.toContain('calendar-picker-indicator')
  expect(input.className).not.toContain('appearance-none')
  expect(input).toHaveStyle({ width: '100%', minWidth: '0', maxWidth: '100%', boxSizing: 'border-box' })
})
it.each(['missing', 'throws'])('preserves native editing when showPicker %s', (mode) => {
  const { input, onChange } = setup()
  Object.defineProperty(input, 'showPicker', { value: mode === 'missing' ? undefined : () => { throw new DOMException('Not allowed', 'NotAllowedError') } })
  expect(fireEvent.click(input)).toBe(true)
  fireEvent.change(input, { target: { value: '22:30' } })
  expect(onChange).toHaveBeenCalledWith('22:30')
})
it('keeps native time semantics, minute precision and accessible error links', () => {
  render(<TimeInput id="from" label="Desde" value="12:00" onChange={vi.fn()} hideLabel aria-invalid aria-describedby="error" />)
  const input = screen.getByLabelText('Desde')
  expect(input).toHaveAttribute('type', 'time')
  expect(input).toHaveAttribute('step', '60')
  expect(input).toHaveAttribute('aria-describedby', 'error')
  expect(input).toHaveAttribute('aria-invalid', 'true')
})
