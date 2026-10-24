import { Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export type SpaceOption = { value: string; label: string }

// Figma "Filters": resting chips are white pills with a 2xs shadow and
// muted text. The selected chip uses the primary colors.
const chipClass =
  'h-auto rounded-2xl bg-background px-2.5 py-2 text-sm font-medium text-muted-foreground shadow-2xs aria-pressed:bg-primary aria-pressed:text-primary-foreground'

/**
 * Restaurant list filters. Two independent rows: space and party size.
 * Each row holds at most one value. The parent combines both (AND).
 * Pressing the active chip again clears that row.
 */
export function RestaurantFilters({
  spaces,
  sizes,
  space,
  size,
  onSpaceChange,
  onSizeChange,
  onClear,
}: {
  spaces: SpaceOption[]
  sizes: number[]
  space: string
  size: string
  onSpaceChange: (value: string) => void
  onSizeChange: (value: string) => void
  onClear: () => void
}) {
  return (
    <div
      role="group"
      aria-label="Filtros de la lista"
      className="flex flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        {/* The space chips scroll sideways; the clear button stays visible. */}
        <ToggleGroup
          aria-label="Filtrar por espacio"
          multiple={false}
          spacing={1}
          value={space ? [space] : []}
          onValueChange={(values) => onSpaceChange(values[0] ?? '')}
          className="min-w-0 max-w-full overflow-x-auto pb-1"
        >
          {spaces.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              aria-label={`Filtrar ${option.label}`}
              className={chipClass}
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {/* Disabled (50% opacity from the Button) while nothing is filtered. */}
        <Button
          size="sm"
          variant={!space && !size ? 'outline' : 'default'}
          className="shrink-0"
          disabled={!space && !size}
          onClick={onClear}
        >
          Limpiar filtros
        </Button>
      </div>
      <ToggleGroup
        aria-label="Filtrar por tamaño"
        multiple={false}
        spacing={1}
        value={size ? [size] : []}
        onValueChange={(values) => onSizeChange(values[0] ?? '')}
        className="max-w-full overflow-x-auto pb-1"
      >
        {sizes.map((count) => (
          <ToggleGroupItem
            key={count}
            value={String(count)}
            aria-label={`Filtrar ${count} ${count === 1 ? 'persona' : 'personas'}`}
            className={chipClass}
          >
            <Users className="size-4" aria-hidden="true" />
            {count}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
