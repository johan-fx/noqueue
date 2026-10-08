import { Radio } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { cn } from 'cn'

function RadioGroup({
  className,
  ...props
}: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn('grid gap-3', className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: Radio.Root.Props) {
  return (
    <Radio.Root
      data-slot="radio-group-item"
      className={cn(
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-disabled:cursor-not-allowed data-disabled:opacity-40',
        className,
      )}
      {...props}
    />
  )
}

function RadioGroupIndicator({
  className,
  ...props
}: Radio.Indicator.Props) {
  return (
    <Radio.Indicator
      data-slot="radio-group-indicator"
      className={cn('flex items-center justify-center', className)}
      {...props}
    />
  )
}

export { RadioGroup, RadioGroupItem, RadioGroupIndicator }
