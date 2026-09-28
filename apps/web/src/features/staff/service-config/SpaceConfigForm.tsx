import { useState } from 'react'
import { Check, Minus, Plus } from 'lucide-react'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import { cn } from 'cn'

type Space = ServiceInput['spaces'][number]
type TableType = NonNullable<Space['tableTypes']>[number]

// Even sizes from the design. "Añadir tipo" appends the next even size.
const presetSeats = [2, 4, 6, 8, 10, 12, 14, 16]

function seatCopy(type: 'restaurant' | 'pool') {
  const plural = type === 'pool' ? 'plazas' : 'mesas'
  const singular = type === 'pool' ? 'plaza' : 'mesa'
  const titled = type === 'pool' ? 'Plazas' : 'Mesas'
  return {
    singular,
    types: `Tipos de ${plural}`,
    total: `Nº de ${plural}:`,
    question: `¿Cuántas ${plural} hay por cada tipología?`,
    add: `Añadir tipo de ${singular}`,
    row: (seats: number) => `${titled} de ${seats}`,
  }
}

// Local draft. The drawer writes it into the service form only on submit.
export function SpaceConfigForm({
  space,
  type,
  onConfirm,
}: {
  space: Space
  type: 'restaurant' | 'pool'
  onConfirm: (tableTypes: TableType[]) => void
}) {
  const copy = seatCopy(type)
  const saved = space.tableTypes ?? []
  const [sizes, setSizes] = useState(() => {
    const extra = saved
      .map((item) => item.seats)
      .filter((seats) => !presetSeats.includes(seats))
    return [...presetSeats, ...extra].sort((a, b) => a - b)
  })
  // Missing key means the card is not selected.
  const [counts, setCounts] = useState<Record<number, number>>(() =>
    Object.fromEntries(saved.map((item) => [item.seats, item.count])),
  )
  const selected = sizes
    .filter((seats) => counts[seats] != null)
    .map((seats) => ({
      ...saved.find((item) => item.seats === seats),
      seats,
      count: counts[seats]!,
    }))
  const total = selected.reduce((sum, item) => sum + item.count, 0)

  function toggle(seats: number) {
    setCounts((current) => {
      if (current[seats] != null) {
        const next = { ...current }
        delete next[seats]
        return next
      }
      return { ...current, [seats]: 1 }
    })
  }

  function addType() {
    const max = sizes.reduce((highest, seats) => Math.max(highest, seats), 0)
    const next = max + (max % 2 === 0 ? 2 : 1)
    setSizes((current) => [...current, next])
    setCounts((current) => ({ ...current, [next]: 1 }))
  }

  function changeCount(seats: number, delta: number) {
    setCounts((current) => ({
      ...current,
      [seats]: Math.max(1, (current[seats] ?? 1) + delta),
    }))
  }

  return (
    <form
      id="space-config"
      className="space-y-8"
      onSubmit={(event) => {
        event.preventDefault()
        onConfirm(selected)
      }}
    >
      <div className="space-y-2 text-lg font-medium text-gray-700">
        <p className="flex justify-between gap-4">
          <span>Espacio:</span>
          <span>{space.name}</span>
        </p>
        <p className="flex justify-between gap-4">
          <span>{copy.total}</span>
          <span>{selected.length ? total : space.tables}</span>
        </p>
      </div>
      <div className="space-y-2">
        <p className="font-medium text-gray-700">{copy.types}</p>
        <div className="grid grid-cols-2 gap-4">
          {sizes.map((seats) => {
            const on = counts[seats] != null
            return (
              <Button
                key={seats}
                type="button"
                variant="outline"
                size="lg"
                aria-pressed={on}
                className={cn(
                  'h-12 w-full justify-between px-4 text-sm font-medium text-gray-700 shadow-xs',
                  on ? 'border-gray-800' : 'border-input',
                )}
                onClick={() => toggle(seats)}
              >
                De {seats}
                {on && <Check aria-hidden="true" className="size-6" />}
              </Button>
            )
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          onClick={addType}
        >
          <Plus aria-hidden="true" className="size-4" /> {copy.add}
        </Button>
      </div>
      {selected.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium text-gray-700">{copy.question}</p>
          <ul>
            {selected.map((item) => (
              <li
                key={item.seats}
                className="flex items-center justify-between border-b border-input py-2"
              >
                <span className="font-medium text-gray-700">
                  {copy.row(item.seats)}
                </span>
                <span className="flex items-center gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="rounded-full"
                    aria-label={`Quitar una ${copy.singular} de ${item.seats}`}
                    disabled={item.count <= 1}
                    onClick={() => changeCount(item.seats, -1)}
                  >
                    <Minus aria-hidden="true" />
                  </Button>
                  <span className="min-w-4 text-center font-medium text-gray-700">
                    {item.count}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="rounded-full"
                    aria-label={`Añadir una ${copy.singular} de ${item.seats}`}
                    onClick={() => changeCount(item.seats, 1)}
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  )
}
