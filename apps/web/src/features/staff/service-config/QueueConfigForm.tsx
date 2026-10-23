import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  defaultGraceMinutes,
  type ServiceInput,
} from '@noqueue/contracts/staff'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { emptyService } from './model'
import { issuesFor } from './validate'

export type QueueOptions = Partial<
  Pick<
    ServiceInput,
    | 'adjustments'
    | 'estimationMode'
    | 'estimatorVersion'
    | 'resourceStateKnown'
    | 'stations'
    | 'graceMinutes'
    | 'approachTurns'
    | 'approachMinutes'
    | 'etaChangeThresholdMinutes'
    | 'notificationCooldownMinutes'
    | 'automaticAssignmentEnabled'
  >
>

/** The nested drawer owns a complete draft; only confirmation updates the wizard. */
export function QueueConfigForm({
  spaces,
  averageMinutes,
  saved,
  type = 'restaurant',
  options,
  onConfirm,
}: {
  spaces: ServiceInput['spaces']
  averageMinutes: number
  saved: ServiceInput['queueBySeat']
  type?: ServiceInput['type']
  options?: QueueOptions | undefined
  onConfirm: (
    spaces: ServiceInput['spaces'],
    options?: QueueOptions | undefined,
  ) => void
}) {
  const form = useForm<ServiceInput>({
    defaultValues: {
      ...emptyService,
      graceMinutes: defaultGraceMinutes(type),
      approachTurns: 2,
      approachMinutes: 10,
      etaChangeThresholdMinutes: 5,
      notificationCooldownMinutes: 10,
      automaticAssignmentEnabled: false,
      ...options,
      // Missing versions are intelligent v2; explicit v1 remains a rollback.
      estimatorVersion: options?.estimatorVersion ?? 2,
      type,
      averageMinutes,
      spaces: spaces.map((space) => ({
        ...space,
        tableTypes: space.tableTypes?.map((group) => ({
          ...group,
          averageMinutes:
            group.averageMinutes ??
            saved?.find((row) => row.seats === group.seats)?.averageMinutes ??
            averageMinutes,
        })),
      })),
    },
  })
  const [selected, setSelected] = useState(
    spaces[0]?.id ?? spaces[0]?.name ?? '',
  )
  const [error, setError] = useState('')
  const draft = useWatch({ control: form.control, name: 'spaces' })
  const automaticAssignmentEnabled = useWatch({
    control: form.control,
    name: 'automaticAssignmentEnabled',
  })
  const operations = null
  return (
    <form
      id="queue-config"
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault()
        const values = form.getValues()
        const issue = issuesFor(values, 'queue').find((item) =>
          [
            'spaces',
            'adjustments',
            'stations',
            'graceMinutes',
            'approachTurns',
            'approachMinutes',
            'etaChangeThresholdMinutes',
            'notificationCooldownMinutes',
            'estimationMode',
            'resourceStateKnown',
            'estimatorVersion',
          ].includes(item.path),
        )
        if (issue) {
          setError('Revisa los tiempos antes de confirmar.')
          return
        }
        setError('')
        onConfirm(values.spaces, {
          adjustments: values.adjustments,
          stations: values.stations,
          graceMinutes: values.graceMinutes,
          approachTurns: values.approachTurns,
          approachMinutes: values.approachMinutes,
          etaChangeThresholdMinutes: values.etaChangeThresholdMinutes,
          notificationCooldownMinutes: values.notificationCooldownMinutes,
          automaticAssignmentEnabled: values.automaticAssignmentEnabled ?? false,
          estimatorVersion: values.estimatorVersion,
          estimationMode: values.estimationMode,
          resourceStateKnown: values.resourceStateKnown,
        })
      }}
    >
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Field>
        <FieldLabel htmlFor="arrival-grace">
          Plazo de llegada (minutos)
        </FieldLabel>
        <Input
          id="arrival-grace"
          type="number"
          min={1}
          max={120}
          required
          {...form.register('graceMinutes', { valueAsNumber: true })}
        />
        <p className="text-sm text-muted-foreground">
          Empieza al asignar, aunque falle el aviso. Solo afecta a futuras
          asignaciones.
        </p>
      </Field>
      <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
        El sistema ajusta automáticamente estas estimaciones según el ritmo real
        de asignación de turnos.
      </p>
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="min-w-0 space-y-2">
          <FieldLabel htmlFor="automatic-assignment-enabled" className="text-base">
            Modo de gestión automática
          </FieldLabel>
          <p className="text-sm text-muted-foreground">
            Tras una asignación manual, si la automatización está disponible,
            el sistema avisará al siguiente cliente compatible cuando venza el
            plazo sin confirmar la llegada. Confirmar o cancelar manualmente
            detiene ese ciclo.
          </p>
        </div>
        <Switch
          id="automatic-assignment-enabled"
          aria-label="Modo de gestión automática"
          checked={automaticAssignmentEnabled ?? false}
          onCheckedChange={(checked) =>
            form.setValue('automaticAssignmentEnabled', checked, {
              shouldDirty: true,
            })
          }
          className="mt-0.5"
        />
      </div>
      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 font-medium">Avisos de turno</legend>
        <p className="text-sm text-muted-foreground">
          El aviso de acercamiento se activa cuando la espera restante es igual
          o inferior a este límite. Los cambios de estimación comparan la hora
          prevista, no el simple paso del tiempo. Cada nueva prórroga se avisa
          sin aplicar el mínimo ni el intervalo de los avisos de mejora.
        </p>
        {(
          [
            [
              'approachMinutes',
              'Minutos restantes para aviso de acercamiento',
              10,
              1440,
            ],
            [
              'etaChangeThresholdMinutes',
              'Mejora mínima para avisar (min)',
              5,
              60,
            ],
            [
              'notificationCooldownMinutes',
              'Intervalo mínimo entre avisos de mejora (min)',
              10,
              120,
            ],
          ] as const
        ).map(([name, label, fallback, max]) => (
          <Field key={name}>
            <FieldLabel htmlFor={`notice-${name}`}>{label}</FieldLabel>
            <Input
              id={`notice-${name}`}
              type="number"
              min={name === 'approachMinutes' ? 0 : 1}
              max={max}
              required
              defaultValue={form.getValues(name) ?? fallback}
              {...form.register(name, { valueAsNumber: true })}
            />
            <FieldError errors={[form.formState.errors[name]]} />
          </Field>
        ))}
      </fieldset>
      {type === 'restaurant' ? (
        <Tabs
          value={selected}
          onValueChange={(value) => setSelected(String(value))}
          className="min-w-0 gap-6"
        >
          <div className="min-w-0 overflow-x-auto py-1">
            <TabsList
              aria-label="Espacios"
              className="w-full min-w-max group-data-horizontal/tabs:h-12"
            >
              {draft.map((item) => (
                <TabsTrigger
                  key={item.id ?? item.name}
                  value={item.id ?? item.name}
                >
                  {item.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {draft.map((space, index) => (
            <TabsContent
              key={space.id ?? space.name}
              value={space.id ?? space.name}
              className="space-y-6"
            >
              {!space?.tableTypes?.length && (
                <p className="text-sm text-muted-foreground">
                  Sin tipos definidos. Configúralos en el paso de capacidad;
                  mientras tanto, la estimación será provisional.
                </p>
              )}
              <Accordion key={selected} className="gap-4">
                {space?.tableTypes?.map((group, groupIndex) => (
                  <AccordionItem
                    key={group.seats}
                    value={String(group.seats)}
                    className="border-0"
                  >
                    <AccordionTrigger className="hover:no-underline **:data-[slot=accordion-trigger-icon]:size-6">
                      <span className="text-lg font-medium">
                        {type === 'restaurant' ? 'Mesas' : 'Grupos'} de{' '}
                        {group.seats}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="mt-3 space-y-4 rounded-lg border px-8 py-4">
                      <Field>
                        <FieldLabel
                          htmlFor={`group-time-${index}-${group.seats}`}
                        >
                          Intervalo inicial estimado entre turnos (min)
                        </FieldLabel>
                        <Input
                          id={`group-time-${index}-${group.seats}`}
                          aria-label={`${space.name} · ${group.seats} plazas (min)`}
                          type="number"
                          required
                          min={1}
                          max={1440}
                          value={group.averageMinutes}
                          onChange={(event) =>
                            form.setValue(
                              `spaces.${index}.tableTypes.${groupIndex}.averageMinutes`,
                              Number(event.target.value),
                            )
                          }
                        />
                      </Field>
                      <p className="text-xs text-muted-foreground">
                        Se usa como referencia inicial para este tamaño de grupo
                        y espacio; el estimador aprende del tiempo real entre
                        asignaciones.
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </TabsContent>
          ))}
          {operations}
        </Tabs>
      ) : (
        operations
      )}
    </form>
  )
}
