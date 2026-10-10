import { Controller, type UseFormReturn } from 'react-hook-form'
import {
  defaultGraceMinutes,
  type ServiceInput,
} from '@noqueue/contracts/staff'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Choice } from '../ServiceForm'
import { ScheduleGroupsEditor } from './ScheduleGroupsEditor'
import type {
  ScheduleEditorState,
  ScheduleEditorHandle,
} from './schedule-editor-state'
import type { Ref } from 'react'
import { cutoffOptions } from './model'

export function GeneralStep({
  form,
  lockType,
  scheduleState,
  onScheduleChange,
  scheduleEditorRef,
}: {
  form: UseFormReturn<ServiceInput>
  lockType: boolean
  scheduleState: ScheduleEditorState
  onScheduleChange: (next: ScheduleEditorState) => void
  scheduleEditorRef: Ref<ScheduleEditorHandle>
}) {
  const values = form.watch()
  const cutoffs = cutoffOptions.includes(values.cutoffMinutes)
    ? cutoffOptions
    : [values.cutoffMinutes, ...cutoffOptions]

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
                  if (!form.getFieldState('graceMinutes').isDirty)
                    form.setValue(
                      'graceMinutes',
                      defaultGraceMinutes(type as ServiceInput['type']),
                    )
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
      <ScheduleGroupsEditor
        state={scheduleState}
        onChange={onScheduleChange}
        editorRef={scheduleEditorRef}
      />
      <FieldError errors={[form.formState.errors.scheduleGroups]} />
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
            ? 'Se podrá apuntar a la lista hasta la hora de cierre.'
            : `No será posible apuntarse a la lista ${values.cutoffMinutes} minutos antes de la hora de cierre.`}
        </p>
        <p className="text-sm text-muted-foreground">
          Este límite solo se aplica a los horarios con franjas, no a los
          abiertos 24 horas.
        </p>
        <FieldError errors={[form.formState.errors.cutoffMinutes]} />
      </Field>
    </div>
  )
}
