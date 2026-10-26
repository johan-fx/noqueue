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
} & Pick<ComponentProps<typeof Input>, 'aria-invalid' | 'aria-describedby' | 'name' | 'ref' | 'onBlur' | 'disabled' | 'required' | 'min' | 'max'>) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <Label htmlFor={id} className={hideLabel ? 'sr-only' : 'px-1'}>
        {label}
      </Label>
      <div className="relative min-w-0">
        {showClock && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center pl-3 text-muted-foreground">
            <Clock8Icon className="size-4" />
            <span className="sr-only">Hora</span>
          </div>
        )}
        <Input
          {...inputProps}
          type="time"
          style={{ width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }}
          id={id}
          step="60"
          value={value}
          onChange={(event) => onChange(event.target.value.slice(0, 5))}
          onClick={(event) => {
            // Some Android browsers focus a time segment without opening the
            // picker. Request it synchronously during the user gesture, keeping
            // the native indicator/default action as a fallback (e.g. Safari).
            try {
              event.currentTarget.showPicker?.()
            } catch {
              // Unsupported contexts may reject showPicker. Do not cancel the
              // default action: native editing must remain available.
            }
          }}
          className={showClock ? 'pl-9' : 'text-center'}
        />
      </div>
    </div>
  )
}
