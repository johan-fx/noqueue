import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { cn } from 'cn'
import { Input } from './input'
import { Check, X } from 'lucide-react'

const Combobox = ComboboxPrimitive.Root
function ComboboxInput(props: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      render={<Input />}
      {...props}
    />
  )
}
function ComboboxContent({
  className,
  anchor,
  ...props
}: ComboboxPrimitive.Popup.Props & {
  anchor?: ComboboxPrimitive.Positioner.Props['anchor']
}) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        anchor={anchor}
        sideOffset={4}
        align="start"
        className="z-50"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            'max-h-(--available-height) w-(--anchor-width) overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md',
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}
function ComboboxList(props: ComboboxPrimitive.List.Props) {
  return <ComboboxPrimitive.List data-slot="combobox-list" {...props} />
}
function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        'relative cursor-default rounded-md py-2 pl-3 pr-8 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground',
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        data-slot="combobox-item-indicator"
        className="pointer-events-none absolute right-2 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center"
      >
        <Check className="size-4" aria-hidden="true" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}
function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      role="presentation"
      aria-live="off"
      data-slot="combobox-empty"
      className={cn('p-3 text-sm text-muted-foreground empty:p-0', className)}
      {...props}
    />
  )
}
const ComboboxTrigger = ComboboxPrimitive.Trigger
const ComboboxValue = ComboboxPrimitive.Value
function ComboboxChips({ className, ...props }: ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}
      {...props}
    />
  )
}
function ComboboxChip({ className, ...props }: ComboboxPrimitive.Chip.Props) {
  return (
    <ComboboxPrimitive.Chip
      data-slot="combobox-chip"
      className={cn(
        'flex max-w-full items-center gap-1 rounded bg-secondary py-0.5 pl-1.5 pr-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  )
}
function ComboboxChipRemove({
  className,
  children,
  ...props
}: ComboboxPrimitive.ChipRemove.Props) {
  return (
    <ComboboxPrimitive.ChipRemove
      data-slot="combobox-chip-remove"
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    >
      {children ?? <X className="size-3" aria-hidden="true" />}
    </ComboboxPrimitive.ChipRemove>
  )
}
export {
  Combobox,
  ComboboxTrigger,
  ComboboxValue,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
}
