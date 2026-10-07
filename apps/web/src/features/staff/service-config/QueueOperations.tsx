import { useId } from 'react'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import type { UseFormReturn } from 'react-hook-form'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'

export function QueueOperations({
  form,
  spaceId,
}: {
  form: UseFormReturn<ServiceInput>
  spaceId?: string
}) {
  const id = useId()
  const type = form.watch('type')
  const spaces = form
    .watch('spaces')
    .filter((space) => !spaceId || (space.id ?? space.name) === spaceId)
  const adjustments = form.watch('adjustments') ?? []
  const groups =
    type !== 'restaurant'
      ? [{ spaceId: 'reception', seats: 100, label: 'Recepción' }]
      : spaces.flatMap((space) =>
          (space.tableTypes ?? []).map((group) => ({
            spaceId: space.id ?? space.name,
            seats: group.seats,
            label: `${space.name} · ${group.seats} plazas`,
          })),
        )
  return (
    <div className="space-y-5">
      {type !== 'restaurant' && (
        <Field>
          <FieldLabel htmlFor="stations">Puestos de atención</FieldLabel>
          <Input
            id="stations"
            defaultValue={1}
            type="number"
            min={1}
            max={1000}
            {...form.register('stations', { valueAsNumber: true })}
          />
        </Field>
      )}
      <section className="space-y-3 rounded border p-3">
        <h3 className="font-medium">Ajustes temporales</h3>
        <p className="text-sm text-muted-foreground">
          Cambian la duración o bloquean temporalmente un grupo hasta su
          caducidad (máximo 24 h), nunca el orden. Requieren motivo y permisos
          de operación.
        </p>
        {groups.map((group) => {
          const adjustment = adjustments.find(
            (a) => a.spaceId === group.spaceId && a.seats === group.seats,
          )
          const update = (patch: {
            minutes?: number
            reason?: string
            expiresAt?: number
          }) =>
            form.setValue(
              'adjustments',
              adjustments.map((a) =>
                a === adjustment ? { ...a, ...patch } : a,
              ),
            )
          return (
            <div
              key={`${group.spaceId}-${group.seats}`}
              className="space-y-2"
              role="group"
              aria-label={`Ajuste ${group.label}`}
            >
              <p>{group.label}</p>
              {adjustment ? (
                <>
                  <Field>
                    <FieldLabel
                      htmlFor={`${id}-${group.spaceId}-${group.seats}`}
                    >
                      Tipo de ajuste
                    </FieldLabel>
                    <Select
                      items={[
                        { value: 'duration', label: 'Duración estimada' },
                        {
                          value: 'availability',
                          label: 'Bloquear disponibilidad hasta caducidad',
                        },
                      ]}
                      value={adjustment.kind ?? 'duration'}
                      onValueChange={(value) => {
                        if (value === null) return
                        form.setValue(
                          'adjustments',
                          adjustments.map((a) =>
                            a !== adjustment
                              ? a
                              : value === 'availability'
                              ? {
                                  kind: 'availability',
                                  spaceId: a.spaceId,
                                  seats: a.seats,
                                  reason: a.reason,
                                  expiresAt: a.expiresAt,
                                }
                              : {
                                  kind: 'duration',
                                  spaceId: a.spaceId,
                                  seats: a.seats,
                                  reason: a.reason,
                                  expiresAt: a.expiresAt,
                                  minutes: form.getValues('averageMinutes'),
                                },
                          ),
                        )
                      }}
                    >
                      <SelectTrigger
                        id={`${id}-${group.spaceId}-${group.seats}`}
                        disabled={form.formState.isSubmitting}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="duration">
                          Duración estimada
                        </SelectItem>
                        <SelectItem value="availability">
                          Bloquear disponibilidad hasta caducidad
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {adjustment.kind !== 'availability' && (
                    <Field>
                      <FieldLabel>
                        Duración temporal (min)
                        <Input
                          type="number"
                          min={1}
                          max={1440}
                          value={adjustment.minutes}
                          onChange={(e) =>
                            update({ minutes: Number(e.target.value) })
                          }
                        />
                      </FieldLabel>
                    </Field>
                  )}
                  <Field>
                    <FieldLabel>
                      Motivo
                      <Input
                        value={adjustment.reason}
                        minLength={3}
                        maxLength={300}
                        onChange={(e) => update({ reason: e.target.value })}
                      />
                    </FieldLabel>
                  </Field>
                  <Field>
                    <FieldLabel>
                      Caducidad
                      <Input
                        type="datetime-local"
                        value={new Date(
                          adjustment.expiresAt -
                            new Date(adjustment.expiresAt).getTimezoneOffset() *
                              60000,
                        )
                          .toISOString()
                          .slice(0, 16)}
                        onChange={(e) => {
                          const value = new Date(e.target.value).getTime()
                          if (Number.isFinite(value))
                            update({ expiresAt: value })
                        }}
                      />
                    </FieldLabel>
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      form.setValue(
                        'adjustments',
                        adjustments.filter((a) => a !== adjustment),
                      )
                    }
                  >
                    Quitar ajuste
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    form.setValue('adjustments', [
                      ...adjustments,
                      {
                        spaceId: group.spaceId,
                        seats: group.seats,
                        minutes: form.getValues('averageMinutes'),
                        reason: '',
                        expiresAt: Date.now() + 60 * 60000,
                      },
                    ])
                  }
                >
                  Añadir ajuste
                </Button>
              )}
            </div>
          )
        })}
      </section>
      <p className="text-sm text-muted-foreground">
        La capacidad de la lista limita las admisiones, no los recursos en
        servicio.
      </p>
    </div>
  )
}
