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
      {type === 'restaurant' && (
        <fieldset className="space-y-4">
          <legend className="mb-3 font-medium">Aviso de acercamiento</legend>
          <p className="text-sm text-muted-foreground">
            Se activa al cumplir cualquiera de los dos umbrales. Los cambios se
            aplican a los turnos en espera.
          </p>
          {(
            [
              ['approachTurns', 'Turnos por delante', 2, 100],
              ['approachMinutes', 'Minutos de espera', 10, 1440],
            ] as const
          ).map(([name, label, fallback, max]) => (
            <Field key={name}>
              <FieldLabel htmlFor={name}>{label}</FieldLabel>
              <Input
                id={name}
                type="number"
                min={0}
                max={max}
                defaultValue={form.getValues(name) ?? fallback}
                {...form.register(name, { valueAsNumber: true })}
              />
              <FieldError errors={[form.formState.errors[name]]} />
            </Field>
          ))}
        </fieldset>
      )}
      <p className="text-sm text-muted-foreground">
        El plazo configurado en ajustes avanzados se aplica a asignaciones
        futuras; no cambia plazos ya iniciados.
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
