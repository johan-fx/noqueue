import { useState } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { seatLabel, type QueueBySeat } from './model'

function copy(type: 'restaurant' | 'pool') {
  const seats = seatLabel(type)
  const titled = type === 'pool' ? 'Plazas' : 'Mesas'
  return {
    row: (size: number) => `${titled} de ${size}`,
    time:
      type === 'restaurant'
        ? 'Tiempo medio del cliente en mesa'
        : 'Tiempo medio del cliente',
    max: `Nº máximo de ${seats} en la cola`,
    empty:
      type === 'pool'
        ? 'Define los tipos de plaza en Capacidad para ajustarlos aquí.'
        : 'Define los tipos de mesa en Capacidad para ajustarlos aquí.',
  }
}

function inRange(value: string, max: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= max
}

// Local draft. The parent form only changes when this form is submitted.
export function QueueConfigForm({
  type,
  sizes,
  averageMinutes,
  capacity,
  saved,
  onConfirm,
}: {
  type: 'restaurant' | 'pool'
  sizes: number[]
  averageMinutes: number
  capacity: number
  saved?: QueueBySeat[]
  onConfirm: (rows: QueueBySeat[] | null) => void
}) {
  const text = copy(type)
  const savedBySize = new Map(saved?.map((item) => [item.seats, item]))
  const [draft, setDraft] = useState<
    Record<number, { averageMinutes: string; capacity: string }>
  >(() =>
    Object.fromEntries(
      sizes.map((seats) => {
        const row = savedBySize.get(seats)
        return [
          seats,
          {
            averageMinutes: String(row?.averageMinutes ?? averageMinutes),
            capacity: String(row?.capacity ?? capacity),
          },
        ]
      }),
    ),
  )
  const [invalid, setInvalid] = useState(false)

  return (
    <form
      id="queue-config"
      className="space-y-8"
      onSubmit={(event) => {
        event.preventDefault()
        // Nothing to store until the spaces define table sizes.
        if (!sizes.length) {
          onConfirm(null)
          return
        }
        const rows = sizes.map((seats) => ({
          seats,
          averageMinutes: draft[seats]?.averageMinutes ?? '',
          capacity: draft[seats]?.capacity ?? '',
        }))
        if (
          rows.some(
            (row) =>
              !inRange(row.averageMinutes, 1440) || !inRange(row.capacity, 10000),
          )
        ) {
          setInvalid(true)
          return
        }
        onConfirm(
          rows.map((row) => ({
            seats: row.seats,
            averageMinutes: Number(row.averageMinutes),
            capacity: Number(row.capacity),
          })),
        )
      }}
    >
      {!sizes.length ? (
        <p className="text-gray-500">{text.empty}</p>
      ) : (
        <Accordion defaultValue={sizes[0] == null ? [] : [sizes[0]]}>
          {sizes.map((seats) => {
            const row = draft[seats]
            return (
            <AccordionItem key={seats} value={seats}>
              <AccordionTrigger className="py-4 text-lg font-medium text-gray-700 hover:no-underline">
                {text.row(seats)}
              </AccordionTrigger>
              {row && (
                <AccordionContent className="mt-1 mb-4 space-y-4 rounded-lg border border-[#cdcdcd] px-8 py-5">
                  <Field>
                    <FieldLabel htmlFor={`minutes-${seats}`}>{text.time}</FieldLabel>
                    <div className="relative">
                      <Input
                        id={`minutes-${seats}`}
                        type="number"
                        min={1}
                        max={1440}
                        className="pr-20"
                        value={row.averageMinutes}
                        aria-invalid={invalid && !inRange(row.averageMinutes, 1440)}
                        onChange={(event) => {
                          const averageMinutes = event.target.value
                          setDraft((current) => ({
                            ...current,
                            [seats]: {
                              averageMinutes,
                              capacity: current[seats]?.capacity ?? '',
                            },
                          }))
                        }}
                      />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-gray-500">
                        minutos
                      </span>
                    </div>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`capacity-${seats}`}>{text.max}</FieldLabel>
                    <Input
                      id={`capacity-${seats}`}
                      type="number"
                      min={1}
                      max={10000}
                      value={row.capacity}
                      aria-invalid={invalid && !inRange(row.capacity, 10000)}
                      onChange={(event) => {
                        const capacity = event.target.value
                        setDraft((current) => ({
                          ...current,
                          [seats]: {
                            averageMinutes: current[seats]?.averageMinutes ?? '',
                            capacity,
                          },
                        }))
                      }}
                    />
                  </Field>
                </AccordionContent>
              )}
            </AccordionItem>
          )
        })}
        </Accordion>
      )}
      {invalid && <FieldError>Revisa los tiempos y el máximo de cada tipo.</FieldError>}
    </form>
  )
}
