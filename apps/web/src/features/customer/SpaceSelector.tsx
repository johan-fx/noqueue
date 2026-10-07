import type { PublicService } from '@noqueue/contracts/queue'
import { Check } from 'lucide-react'
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
      <div className="grid grid-cols-2 gap-4">
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
          <label
            key={item.id}
            className={`relative flex min-h-12 cursor-pointer items-center justify-between gap-1 rounded-lg border px-4 py-2 has-focus-visible:ring-2 has-disabled:cursor-not-allowed has-disabled:opacity-40 ${
              value === item.id ? 'border-gray-800' : 'border-input'
            }`}
          >
            <input
              type="radio"
              className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
              name="customer-space"
              value={item.id}
              checked={value === item.id}
              onChange={() => onChange(item.id)}
              disabled={item.maxPartySize < size}
            />
            <span className="text-base leading-5 tracking-tight">
              {item.name}
            </span>
            {value === item.id && (
              <Check aria-hidden="true" className="size-5 shrink-0" />
            )}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
