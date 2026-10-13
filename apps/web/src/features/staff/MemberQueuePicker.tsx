import { useRef } from 'react'
import { ChevronsUpDown, Search } from 'lucide-react'
import {
  Combobox,
  ComboboxTrigger,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxContent,
  ComboboxInput,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '@/components/ui/combobox'

export type MemberQueueOption = { id: string; name: string }
export function MemberQueuePicker({
  queues,
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
}: {
  queues: MemberQueueOption[]
  value: string[]
  onChange: (ids: string[]) => void
  disabled: boolean
  invalid: boolean
  describedBy?: string
}) {
  const anchor = useRef<HTMLDivElement>(null)
  const names = new Map(queues.map((queue) => [queue.id, queue.name]))
  return (
    <Combobox
      multiple
      items={queues.map((queue) => queue.id)}
      value={value}
      itemToStringLabel={(id) => names.get(id) ?? 'Servicio no disponible'}
      onValueChange={onChange}
      disabled={disabled}
      onInputValueChange={(_value, details) => {
        if (details.isItemPress) details.cancel()
      }}
    >
      <div
        ref={anchor}
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        data-slot="member-queue-picker"
        className="flex min-h-11 items-center gap-2 data-disabled:opacity-60 rounded-md border border-input bg-background px-3 py-1.5 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 data-invalid:border-destructive data-invalid:ring-[3px] data-invalid:ring-destructive/20"
      >
        <ComboboxChips className={value.length ? 'flex-1' : 'hidden'}>
          {value.map((id) => (
            <ComboboxChip
              key={id}
              aria-label={names.get(id) ?? 'Servicio no disponible'}
            >
              <span className="min-w-0 break-words">
                {names.get(id) ?? 'Servicio no disponible'}
              </span>
              <ComboboxChipRemove
                aria-label={`Quitar ${
                  names.get(id) ?? 'servicio no disponible'
                }`}
              />
            </ComboboxChip>
          ))}
        </ComboboxChips>
        <ComboboxTrigger
          id="member-queueIds"
          aria-label="Servicios a gestionar"
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={
            value.length
              ? 'flex size-7 shrink-0 items-center justify-center rounded outline-none disabled:opacity-60'
              : 'flex min-h-7 w-full items-center justify-between gap-2 text-left text-sm text-muted-foreground outline-none disabled:opacity-60'
          }
        >
          {!value.length && <span>Selecciona uno o varios servicios</span>}
          <ChevronsUpDown
            className="size-4 shrink-0 opacity-50"
            aria-hidden="true"
          />
        </ComboboxTrigger>
      </div>
      <ComboboxContent
        anchor={anchor}
        className="max-h-[min(20rem,var(--available-height))] p-0"
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <ComboboxInput
            aria-label="Buscar servicios"
            placeholder="Busca por el nombre del servicio..."
            className="h-8 min-w-0 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="p-1">
          <ComboboxEmpty>No se encontraron servicios.</ComboboxEmpty>
          <ComboboxList aria-label="Servicios disponibles">
            {(id: string) => (
              <ComboboxItem key={id} value={id} className="break-words">
                {names.get(id)}
              </ComboboxItem>
            )}
          </ComboboxList>
        </div>
      </ComboboxContent>
    </Combobox>
  )
}
