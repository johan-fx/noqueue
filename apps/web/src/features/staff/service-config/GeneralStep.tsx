import { Controller, type UseFormReturn } from 'react-hook-form'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TimeInput } from '@/components/shadcn-studio/date-picker/date-picker-09'
import { Choice } from '../ServiceForm'
import { readHours, weekdays, writeHours } from './hours'
import { cutoffOptions } from './model'
import { PlusIcon, Trash2Icon } from 'lucide-react'

export function GeneralStep({
  form,
  lockType,
}: {
  form: UseFormReturn<ServiceInput>
  lockType: boolean
}) {
  const values = form.watch()
  const hours = readHours(values.schedules)
  const cutoffs = cutoffOptions.includes(values.cutoffMinutes)
    ? cutoffOptions
    : [values.cutoffMinutes, ...cutoffOptions]

  function applyHours(days: number[], ranges: typeof hours.ranges) {
    form.setValue('schedules', writeHours(days, ranges), { shouldValidate: true })
  }

  return (
    <div className="space-y-5">
      {!lockType && (
        <Field>
          <FieldLabel>Tipo</FieldLabel>
          <Controller
            control={form.control}
            name="type"
            render={({ field }) => (
              <Choice
                label="Tipo de servicio"
                value={field.value}
                onChange={(type) => {
                  field.onChange(type)
                  form.setValue('assignmentPreference', 'fastest')
                  if (type === 'reception') {
                    form.setValue('spaces', [])
                    form.setValue('receptionServices', ['check_in'])
                  } else {
                    form.setValue('receptionServices', [])
                    form.setValue('spaces', [
                      {
                        name: type === 'pool' ? 'Piscina' : 'Interior',
                        tables: 10,
                      },
                    ])
                  }
                }}
                items={{
                  restaurant: 'Restaurante',
                  reception: 'Recepción',
                  pool: 'Piscina / Bar',
                }}
              />
            )}
          />
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="service-name">Nombre del servicio</FieldLabel>
        <Input id="service-name" {...form.register('name')} />
        <FieldError errors={[form.formState.errors.name]} />
      </Field>
      <Field>
        <FieldLabel>Días de apertura</FieldLabel>
        <ToggleGroup
          multiple
          variant="outline"
          spacing={2}
          className="grid w-full grid-cols-7"
          value={(values.twentyFourHours
            ? weekdays.map((weekday) => weekday.day)
            : hours.days
          ).map(String)}
          onValueChange={(next) => {
            if (values.twentyFourHours) form.setValue('twentyFourHours', false)
            applyHours(next.map(Number), hours.ranges)
          }}
        >
          {weekdays.map((weekday) => (
            <ToggleGroupItem
              key={weekday.day}
              value={String(weekday.day)}
              aria-label={weekday.label}
              className="h-10 w-full rounded-md border-input bg-background text-foreground aria-pressed:bg-background data-pressed:border-foreground data-pressed:bg-background"
            >
              {weekday.short}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
      <Field orientation="horizontal">
        <Switch
          id="service-twenty-four-hours"
          checked={values.twentyFourHours}
          onCheckedChange={(checked) => {
            form.setValue('twentyFourHours', checked)
            form.setValue(
              'schedules',
              checked ? [] : writeHours(hours.days, hours.ranges),
            )
          }}
        />
        <FieldLabel htmlFor="service-twenty-four-hours">
          24 horas, todos los días
        </FieldLabel>
      </Field>
      {!values.twentyFourHours && (
        <div className="space-y-3">
          {/* Each added range stays editable and can be removed. */}
          <ul className="space-y-3">
            {hours.ranges.map((range, index) => (
              <li key={index} className="flex items-end gap-2">
                <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
                  <TimeInput
                    id={`from-${index}`}
                    label="Desde"
                    value={range.from}
                    onChange={(from) => {
                      const ranges = hours.ranges.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, from } : item,
                      )
                      applyHours(hours.days, ranges)
                    }}
                  />
                  <TimeInput
                    id={`to-${index}`}
                    label="Hasta"
                    value={range.to}
                    onChange={(to) => {
                      const ranges = hours.ranges.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, to } : item,
                      )
                      applyHours(hours.days, ranges)
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0 size-11"
                  aria-label={`Eliminar franja ${index + 1}`}
                  onClick={() =>
                    applyHours(
                      hours.days,
                      hours.ranges.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
          <FieldError errors={[form.formState.errors.schedules]} />
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="w-full"
            onClick={() =>
              applyHours(hours.days, [
                ...hours.ranges,
                { from: '12:00', to: '23:00' },
              ])
            }
          >
            <PlusIcon className="size-4" /> Añadir franja
          </Button>
        </div>
      )}
      <Field>
        <FieldLabel>
          ¿Cuánto tiempo antes del cierre puede apuntarse un cliente?
        </FieldLabel>
        <Controller
          control={form.control}
          name="cutoffMinutes"
          render={({ field }) => (
            <Choice
              label="Tiempo antes del cierre"
              value={String(field.value)}
              onChange={(value) => field.onChange(Number(value))}
              items={Object.fromEntries(
                cutoffs.map((minutes) => [String(minutes), `${minutes} min`]),
              )}
            />
          )}
        />
        <p className="text-sm text-muted-foreground">
          {values.cutoffMinutes === 0
            ? 'Se podrá apuntar a la cola hasta la hora de cierre.'
            : `No será posible apuntarse a la cola ${values.cutoffMinutes} minutos antes de la hora de cierre.`}
        </p>
        <FieldError errors={[form.formState.errors.cutoffMinutes]} />
      </Field>
    </div>
  )
}
