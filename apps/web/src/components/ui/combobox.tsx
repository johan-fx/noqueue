import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { cn } from 'cn'
import { Input } from './input'

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
  ...props
}: ComboboxPrimitive.Popup.Props) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
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
function ComboboxItem({ className, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        'cursor-default rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground',
        className,
      )}
      {...props}
    />
  )
}
function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      role="presentation"
      aria-live="off"
      data-slot="combobox-empty"
      className={cn('p-3 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}
export {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
}
