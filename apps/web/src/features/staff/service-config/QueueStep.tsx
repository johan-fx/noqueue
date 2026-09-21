import type { UseFormReturn } from 'react-hook-form'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { seatLabel } from './model'

export function QueueStep({ form }: { form: UseFormReturn<ServiceInput> }) {
  const type = form.watch('type')
  const seats = seatLabel(type)
  const fields = [
    [
      'averageMinutes',
      type === 'restaurant'
        ? 'Tiempo medio del cliente en mesa'
        : 'Tiempo medio del cliente',
    ],
    ['graceMinutes', 'Tiempo para llegar después del aviso'],
    [
      'capacity',
      type === 'reception'
        ? 'Nº máximo de personas en cola'
        : `Nº máximo de ${seats} en cola`,
    ],
  ] as const
  return (
    <div className="space-y-5">
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
    </div>
  )
}
