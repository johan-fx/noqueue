import type { PublicService } from '@noqueue/contracts/queue'
import { Check } from 'lucide-react'
import {
  RadioGroup,
  RadioGroupIndicator,
  RadioGroupItem,
} from '@/components/ui/radio-group'
import type { Locale } from './shared'

export function SpaceSelector({
  service,
  locale,
  size,
  value,
  disabled,
  onChange,
}: {
  service: PublicService
  locale: Locale
  size: number
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const es = locale === 'es'
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-4 font-medium">
        {es ? '¿Dónde quieres tu mesa?' : 'Where would you like your table?'}
      </legend>
      <RadioGroup
        aria-label={
          es ? '¿Dónde quieres tu mesa?' : 'Where would you like your table?'
        }
        className="grid grid-cols-2 gap-4"
        name="customer-space"
        value={value}
        onValueChange={(next) => onChange(next)}
        disabled={disabled}
      >
        {[
          ...service.spaces,
          {
            id: 'fastest',
            name: es ? 'Opción más rápida' : 'Fastest option',
            maxPartySize: Math.max(
              0,
              ...service.spaces.map((s) => s.maxPartySize),
            ),
          },
        ].map((item) => (
          <RadioGroupItem
            key={item.id}
            value={item.id}
            disabled={item.maxPartySize < size}
            className={`relative flex min-h-12 w-full cursor-pointer items-center justify-between gap-1 rounded-lg border px-4 py-2 ${
              value === item.id ? 'border-gray-800' : 'border-input'
            }`}
          >
            <span className="text-base leading-5 tracking-tight">
              {item.name}
            </span>
            <RadioGroupIndicator>
              <Check aria-hidden="true" className="size-5 shrink-0" />
            </RadioGroupIndicator>
          </RadioGroupItem>
        ))}
      </RadioGroup>
    </fieldset>
  )
}
