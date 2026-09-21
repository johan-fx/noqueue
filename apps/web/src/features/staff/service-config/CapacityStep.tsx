import type { UseFormReturn } from 'react-hook-form'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import { DrawerTrigger } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { seatLabel } from './model'
import { CheckIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { cn } from 'cn'

const receptionLabels = {
  check_in: 'Check-in',
  check_out: 'Check-out',
  other: 'Otros temas',
} as const

export function CapacityStep({ form }: { form: UseFormReturn<ServiceInput> }) {
  const values = form.watch()
  const seats = seatLabel(values.type)
  if (values.type === 'reception') {
    return (
      <Field>
        <FieldLabel>Servicios de recepción</FieldLabel>
        {/* Two equal cards per row. Selected: dark border + check on the right. */}
        <div className="grid grid-cols-2 gap-4">
          {(['check_in', 'check_out', 'other'] as const).map((key) => {
            const selected = values.receptionServices.includes(key)
            return (
              <Button
                key={key}
                type="button"
                variant="outline"
                size="lg"
                aria-pressed={selected}
                className={cn(
                  'h-12 w-full justify-between px-4 text-base font-normal text-gray-700 shadow-xs',
                  selected ? 'border-gray-800' : 'border-input',
                )}
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
                {selected && <CheckIcon className="size-6" />}
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
           <Trash2Icon className="size-4 text-red-500 hover:text-red-600" /> Quitar espacio
          </Button>
        </section>
      ))}
      {/* Opens the nested add-space drawer. The capacity list stays mounted behind it. */}
      <DrawerTrigger
        render={
          <Button type="button" size="lg" variant="outline" className="w-full" />
        }
      >
        <PlusIcon className="size-4" /> Añadir espacio
      </DrawerTrigger>
      <FieldError errors={[form.formState.errors.spaces]} />
    </div>
  )
}
