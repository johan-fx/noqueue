import { useId } from 'react'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { serviceSchema, type ServiceInput } from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
const defaultService: ServiceInput = {
  name: '',
  type: 'restaurant',
  capacity: 20,
  averageMinutes: 30,
  graceMinutes: 5,
  cutoffMinutes: 0,
  twentyFourHours: false,
  schedules: [{ day: 1, from: '12:00', to: '23:00' }],
  spaces: [{ name: 'Interior', tables: 10 }],
  receptionServices: ['check_in'],
}
export function Choice({
  value,
  onChange,
  items,
  label,
  id,
}: {
  value: string
  onChange: (value: string) => void
  items: Record<string, string>
  label: string
  id?: string
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v)
      }}
    >
      <SelectTrigger id={id} aria-label={label} className="w-full">
        <SelectValue>{items[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(items).map(([key, text]) => (
          <SelectItem key={key} value={key}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
export function ServiceForm({
  initial = defaultService,
  onSave,
  label = 'Añadir servicio',
  disabled = false,
  formId,
  hideSubmit = false,
}: {
  initial?: ServiceInput
  onSave: (input: ServiceInput) => void | Promise<void>
  label?: string
  disabled?: boolean
  formId?: string
  hideSubmit?: boolean
}) {
  const prefix = useId()
  const form = useForm<ServiceInput>({
    resolver: zodResolver(serviceSchema),
    defaultValues: initial,
  })
  const schedules = useFieldArray({ control: form.control, name: 'schedules' }),
    spaces = useFieldArray({ control: form.control, name: 'spaces' })
  const type = useWatch({ control: form.control, name: 'type' }),
    always = useWatch({ control: form.control, name: 'twentyFourHours' }),
    receptionServices = useWatch({
      control: form.control,
      name: 'receptionServices',
    })
  return (
    <form
      id={formId}
      className="space-y-5"
      onSubmit={form.handleSubmit(onSave)}
    >
      <fieldset
        disabled={disabled || form.formState.isSubmitting}
        className="space-y-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={prefix + 'service-name'}>
              Nombre del servicio
            </FieldLabel>
            <Input id={prefix + 'service-name'} {...form.register('name')} />
            <FieldError errors={[form.formState.errors.name]} />
          </Field>
          <Field>
            <FieldLabel>Tipo</FieldLabel>
            <Controller
              control={form.control}
              name="type"
              render={({ field }) => (
                <Choice
                  label="Tipo de servicio"
                  value={field.value}
                  onChange={field.onChange}
                  items={{
                    restaurant: 'Restaurante',
                    reception: 'Recepción',
                    pool: 'Piscina / Bar',
                  }}
                />
              )}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ['capacity', 'Máximo de grupos/personas en espera'],
              ['averageMinutes', 'Duración media (minutos)'],
              ['graceMinutes', 'Plazo de llegada (minutos)'],
              [
                'cutoffMinutes',
                'Cierre de inscripciones antes del cierre (minutos)',
              ],
            ] as const
          ).map(([name, text]) => (
            <Field key={name}>
              <FieldLabel htmlFor={prefix + name}>{text}</FieldLabel>
              <Input
                id={prefix + name}
                type="number"
                {...form.register(name, { valueAsNumber: true })}
              />
              <FieldError errors={[form.formState.errors[name]]} />
            </Field>
          ))}
        </div>
        <Field>
          <FieldLabel>Horario</FieldLabel>
          <Controller
            control={form.control}
            name="twentyFourHours"
            render={({ field }) => (
              <Choice
                label="Horario"
                value={String(field.value)}
                onChange={(v) => field.onChange(v === 'true')}
                items={{
                  true: '24 horas, todos los días',
                  false: 'Franjas horarias',
                }}
              />
            )}
          />
        </Field>
        {!always && (
          <div className="space-y-3">
            {schedules.fields.map((item, i) => (
              <div
                key={item.id}
                className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2"
              >
                <Controller
                  control={form.control}
                  name={`schedules.${i}.day`}
                  render={({ field }) => (
                    <Choice
                      label={`Día ${i + 1}`}
                      value={String(field.value)}
                      onChange={(v) => field.onChange(Number(v))}
                      items={{
                        0: 'Domingo',
                        1: 'Lunes',
                        2: 'Martes',
                        3: 'Miércoles',
                        4: 'Jueves',
                        5: 'Viernes',
                        6: 'Sábado',
                      }}
                    />
                  )}
                />
                <Input
                  aria-label={`Desde ${i + 1}`}
                  type="time"
                  {...form.register(`schedules.${i}.from`)}
                />
                <Input
                  aria-label={`Hasta ${i + 1}`}
                  type="time"
                  {...form.register(`schedules.${i}.to`)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => schedules.remove(i)}
                  aria-label={`Eliminar horario ${i + 1}`}
                >
                  ×
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                schedules.append({ day: 1, from: '12:00', to: '23:00' })
              }
            >
              Añadir franja
            </Button>
            <FieldError errors={[form.formState.errors.schedules]} />
          </div>
        )}
        {type === 'restaurant' && (
          <section className="space-y-3">
            <h3 className="font-medium">Espacios y mesas</h3>
            {spaces.fields.map((item, i) => (
              <div className="flex gap-2" key={item.id}>
                <Input
                  aria-label={`Espacio ${i + 1}`}
                  {...form.register(`spaces.${i}.name`)}
                />
                <Input
                  aria-label={`Mesas ${i + 1}`}
                  type="number"
                  {...form.register(`spaces.${i}.tables`, {
                    valueAsNumber: true,
                  })}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => spaces.remove(i)}
                  aria-label={`Eliminar espacio ${i + 1}`}
                >
                  ×
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => spaces.append({ name: '', tables: 1 })}
            >
              Añadir espacio
            </Button>
          </section>
        )}
        {type === 'reception' && (
          <Field>
            <FieldLabel>Servicios de recepción</FieldLabel>
            <div className="flex gap-2">
              {(['check_in', 'check_out', 'other'] as const).map((key) => (
                <Button
                  type="button"
                  key={key}
                  variant={
                    receptionServices.includes(key) ? 'default' : 'outline'
                  }
                  aria-pressed={receptionServices.includes(key)}
                  onClick={() => {
                    const current = form.getValues('receptionServices')
                    form.setValue(
                      'receptionServices',
                      current.includes(key)
                        ? current.filter((v) => v !== key)
                        : [...current, key],
                      { shouldValidate: true },
                    )
                  }}
                >
                  {
                    {
                      check_in: 'Check-in',
                      check_out: 'Check-out',
                      other: 'Otros',
                    }[key]
                  }
                </Button>
              ))}
            </div>
          </Field>
        )}
        {Object.keys(form.formState.errors).length > 0 && (
          <p role="alert" className="text-sm text-destructive">
            Revisa los campos: nombre, capacidad, horarios sin solapamientos y
            espacios/servicios válidos.
          </p>
        )}
        {!hideSubmit && (
          <Button type="submit">
            {form.formState.isSubmitting ? 'Guardando…' : label}
          </Button>
        )}
      </fieldset>
    </form>
  )
}
