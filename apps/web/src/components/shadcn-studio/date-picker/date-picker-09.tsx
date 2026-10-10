import type { ComponentProps } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Clock8Icon } from 'lucide-react'

/** Time field from shadcn studio date-picker-09: clock icon, native time value. */
export function TimeInput({
  id,
  label,
  value,
  onChange,
  showClock = true,
  hideLabel = false,
  ...inputProps
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  showClock?: boolean
  hideLabel?: boolean
} & Pick<ComponentProps<typeof Input>, 'aria-invalid' | 'aria-describedby'>) {
  return (
    <div className="flex w-full flex-col gap-2">
      <Label htmlFor={id} className={hideLabel ? 'sr-only' : 'px-1'}>
        {label}
      </Label>
      <div className="relative">
        {showClock && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center pl-3 text-muted-foreground">
            <Clock8Icon className="size-4" />
            <span className="sr-only">Hora</span>
          </div>
        )}
        <Input
          {...inputProps}
          type="time"
          id={id}
          step="60"
          value={value}
          onChange={(event) => onChange(event.target.value.slice(0, 5))}
          className={`peer bg-background appearance-none ${
            showClock
              ? 'pl-9'
              : 'text-center [&::-webkit-datetime-edit]:inline-flex [&::-webkit-datetime-edit]:w-full [&::-webkit-datetime-edit]:justify-center [&::-webkit-datetime-edit-fields-wrapper]:inline-flex [&::-webkit-datetime-edit-fields-wrapper]:justify-center'
          } [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none`}
        />
      </div>
    </div>
  )
}
