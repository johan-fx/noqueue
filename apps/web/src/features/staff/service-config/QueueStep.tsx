import type { UseFormReturn } from 'react-hook-form'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { Settings2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'

export function QueueStep({
  form,
  onConfigure,
}: {
  form: UseFormReturn<ServiceInput>
  onConfigure?: () => void
}) {
  const type = form.watch('type')
  const fields = [
    [
      'averageMinutes',
      type === 'restaurant'
        ? 'Tiempo medio del cliente en mesa'
        : 'Tiempo medio del cliente',
    ],
    [
      'capacity',
      type === 'pool'
        ? 'Nº máximo de personas en lista'
        : 'Nº máximo de turnos en lista',
    ],
  ] as const
  return (
    <div className="space-y-6">
      {fields.map(([name, label]) => (
        <Field key={name}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input
            id={name}
            type="number"
            min={1}
            {...form.register(name, { valueAsNumber: true })}
          />
          <FieldError errors={[form.formState.errors[name]]} />
        </Field>
      ))}
      <p className="text-sm text-muted-foreground">
        Los umbrales de acercamiento, los avisos de cambios de estimación y el
        plazo de llegada se ajustan en Configuración avanzada.
      </p>
      {onConfigure && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-gray-500"
          onClick={onConfigure}
        >
          <Settings2Icon aria-hidden="true" /> Configuración avanzada
        </Button>
      )}
    </div>
  )
}
