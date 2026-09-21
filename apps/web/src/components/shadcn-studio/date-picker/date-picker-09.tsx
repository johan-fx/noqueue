import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Clock8Icon } from 'lucide-react'

/** Time field from shadcn studio date-picker-09: clock icon, native time value. */
export function TimeInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      <Label htmlFor={id} className="px-1">
        {label}
      </Label>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center pl-3 text-muted-foreground">
          <Clock8Icon className="size-4" />
          <span className="sr-only">Hora</span>
        </div>
        <Input
          type="time"
          id={id}
          step="60"
          value={value}
          onChange={(event) => onChange(event.target.value.slice(0, 5))}
          className="peer bg-background appearance-none pl-9 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
        />
      </div>
    </div>
  )
}
