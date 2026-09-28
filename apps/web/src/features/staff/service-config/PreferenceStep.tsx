import type { UseFormReturn } from 'react-hook-form'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import { Check } from 'lucide-react'

export function PreferenceStep({
  form,
}: {
  form: UseFormReturn<ServiceInput>
}) {
  const spaces = form.watch('spaces')
  const selected = form.watch('assignmentPreference') ?? 'fastest'
  const options = [
    ...spaces.map((space) => ({
      value: space.id ?? space.name,
      label: space.name,
    })),
    { value: 'fastest', label: 'Menor tiempo posible' },
  ]
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        Preferencia de espacio por asignación
      </p>
      {options.map((option) => {
        const value = option.value
        const active = selected === value
        return (
          <Button
            key={value}
            type="button"
            variant="outline"
            aria-pressed={active}
            className="h-12 w-full justify-between"
            onClick={() => form.setValue('assignmentPreference', value)}
          >
            {option.label}
            {active && <Check aria-hidden="true" />}
          </Button>
        )
      })}
    </div>
  )
}
