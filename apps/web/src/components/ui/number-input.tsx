import type { ComponentProps } from 'react'
import { Input } from './input'

/** Controlled number draft. NaN represents empty/invalid input, never zero.
 * Forms must validate before submitting, just like RHF valueAsNumber fields.
 */
export function NumberInput({ value, onValueChange, ...props }: Omit<
  ComponentProps<typeof Input>, 'type' | 'value' | 'defaultValue' | 'onChange'
> & { value: number | undefined; onValueChange: (value: number) => void }) {
  return (
    <Input
      {...props}
      type="number"
      value={Number.isFinite(value) ? value : ''}
      onChange={(event) => onValueChange(event.target.valueAsNumber)}
    />
  )
}
