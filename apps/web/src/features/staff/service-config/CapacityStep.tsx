import type { UseFormReturn } from 'react-hook-form'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { seatLabel } from './model'

const receptionLabels = {
  check_in: 'Check-in',
  check_out: 'Check-out',
  other: 'Otros',
} as const

export function CapacityStep({
  form,
  onAddSpace,
}: {
  form: UseFormReturn<ServiceInput>
  onAddSpace: () => void
}) {
  const values = form.watch()
  const seats = seatLabel(values.type)
  if (values.type === 'reception') {
    return (
      <Field>
        <FieldLabel>Servicios de recepción</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {(['check_in', 'check_out', 'other'] as const).map((key) => {
            const selected = values.receptionServices.includes(key)
            return (
              <Button
                key={key}
                type="button"
                variant={selected ? 'default' : 'outline'}
                aria-pressed={selected}
                onClick={() => {
                  const current = form.getValues('receptionServices')
                  form.setValue(
                    'receptionServices',
                    current.includes(key)
                      ? current.filter((item) => item !== key)
                      : [...current, key],
                    { shouldValidate: true },
                  )
                }}
              >
                {receptionLabels[key]}
              </Button>
            )
          })}
        </div>
        <FieldError errors={[form.formState.errors.receptionServices]} />
      </Field>
    )
  }
  return (
    <div className="space-y-4">
      {values.spaces.map((space, index) => (
        <section key={`${space.name}-${index}`} className="space-y-3 rounded-lg border p-4">
          <h3 className="font-medium">Espacio {index + 1}</h3>
          <Input aria-label={`Espacio ${index + 1}`} value={space.name} readOnly />
          <Field>
            <FieldLabel htmlFor={`tables-${index}`}>
              Nº total de {seats} disponibles
            </FieldLabel>
            <Input
              id={`tables-${index}`}
              type="number"
              min={1}
              value={space.tables}
              onChange={(event) => {
                const spaces = form.getValues('spaces')
                spaces[index] = {
                  ...spaces[index]!,
                  tables: Number(event.target.value),
                }
                form.setValue('spaces', spaces, { shouldValidate: true })
              }}
            />
          </Field>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const spaces = form.getValues('spaces').filter((_, i) => i !== index)
              form.setValue('spaces', spaces)
              if (
                form.getValues('assignmentPreference') === space.name &&
                !spaces.some((item) => item.name === space.name)
              )
                form.setValue('assignmentPreference', 'fastest')
            }}
          >
            Quitar espacio
          </Button>
        </section>
      ))}
      <Button type="button" variant="outline" className="w-full" onClick={onAddSpace}>
        + Añadir espacio
      </Button>
      <FieldError errors={[form.formState.errors.spaces]} />
    </div>
  )
}
