import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { QueueOperations } from './QueueOperations'
import { emptyService } from './model'
import { issuesFor } from './validate'

export type QueueOptions = Pick<
  ServiceInput,
  'adjustments' | 'estimationMode' | 'resourceStateKnown' | 'stations'
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
      ...options,
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
  const operations = (
    <Accordion>
      <AccordionItem value="operations" className="border-t pt-2">
        <AccordionTrigger className="text-muted-foreground">
          Opciones de operación
        </AccordionTrigger>
        <AccordionContent className="pt-4">
          <QueueOperations form={form} spaceId={selected} />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
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
            'estimationMode',
            'resourceStateKnown',
          ].includes(item.path),
        )
        if (issue) {
          setError(
            'Revisa los tiempos, el motivo y la caducidad de los ajustes antes de confirmar.',
          )
          return
        }
        setError('')
        onConfirm(values.spaces, {
          adjustments: values.adjustments,
          stations: values.stations,
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
      {type !== 'reception' ? (
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
                          Tiempo medio{' '}
                          {type === 'restaurant'
                            ? 'del cliente en mesa'
                            : 'de ocupación'}{' '}
                          (min)
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
                        Duración desde la llegada hasta liberar el recurso. Se
                        ajusta con las ocupaciones registradas.
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
