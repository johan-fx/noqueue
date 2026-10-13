import { Users } from 'lucide-react'
import {
  assignmentTableOptions,
  type AssignmentSeating,
  type ServiceInput,
  type StaffEntry,
} from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'

export function AssignmentOptions({
  config,
  party,
  seating,
  onChange,
  disabled,
}: {
  config: ServiceInput
  party: Pick<StaffEntry, 'partySize' | 'preferredSpaceId'>
  seating: AssignmentSeating | null
  onChange: (value: AssignmentSeating) => void
  disabled: boolean
}) {
  const options = assignmentTableOptions(config, party.partySize)
  const selected =
    seating?.mode === 'confirmed'
      ? options.find((space) => space.spaceId === seating.spaceId)
      : undefined
  const preferred =
    party.preferredSpaceId && party.preferredSpaceId !== 'fastest'
      ? config.spaces.find(
          (space, index) =>
            (space.id ?? `legacy-${index}`) === party.preferredSpaceId,
        )
      : undefined
  const invalid =
    seating &&
    (seating.mode === 'unspecified'
      ? options.length > 0
      : !selected?.seats.includes(seating.seats))
  const buttonClass =
    'min-h-11 min-w-11 max-w-full rounded-full whitespace-normal break-words h-auto py-2'
  const onlySpace = options.length === 1 ? options[0] : undefined
  const onlyCapacity = selected?.seats.length === 1 ? selected.seats[0] : undefined
  const needsReview = invalid || (!seating && !!onlySpace)
  // A refreshed catalogue must never silently replace the pending selection.
  // When no selector remains, provide an explicit way to review the new choice.
  const reviewSpace = selected ? (onlyCapacity ? selected : undefined) : onlySpace
  return (
    <div className="space-y-3">
      {needsReview && (
        <p role="alert" className="text-sm text-destructive">
          Las opciones han cambiado. Revisa el espacio y la capacidad antes de
          asignar.
        </p>
      )}
      {!options.length ? (
        <p className="text-sm text-muted-foreground">
          No hay tipos de mesa configurados que admitan a este grupo. Puedes
          asignar sin especificar mesa; no se registrará una capacidad
          confirmada.
        </p>
      ) : (
        <>
          {options.length > 1 && (
            <div role="group" aria-label="Espacio" className="space-y-1">
              <p className="text-sm font-medium">Espacio</p>
              <div className="flex flex-wrap gap-1">
                {options.map((space) => (
                  <Button
                    key={space.spaceId}
                    type="button"
                    className={buttonClass}
                    variant={
                      selected?.spaceId === space.spaceId ? 'default' : 'ghost'
                    }
                    aria-pressed={selected?.spaceId === space.spaceId}
                    disabled={disabled}
                    onClick={() =>
                      onChange({
                        mode: 'confirmed',
                        spaceId: space.spaceId,
                        seats:
                          seating?.mode === 'confirmed' &&
                          space.seats.includes(seating.seats)
                            ? seating.seats
                            : space.seats[0]!,
                      })
                    }
                  >
                    {space.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {!needsReview && (onlySpace || onlyCapacity) && (
            <p className="text-sm text-muted-foreground break-words">
              {onlySpace?.name}
              {onlySpace && onlyCapacity ? ' · ' : ''}
              {onlyCapacity ? `Mesa para ${onlyCapacity}` : ''}
            </p>
          )}
          {needsReview && reviewSpace && (
            <Button
              type="button"
              variant="outline"
              className={buttonClass}
              disabled={disabled}
              onClick={() =>
                onChange({
                  mode: 'confirmed',
                  spaceId: reviewSpace.spaceId,
                  seats: reviewSpace.seats[0]!,
                })
              }
            >
              Revisar asignación
            </Button>
          )}
          {selected && selected.seats.length > 1 && (
            <div role="group" aria-label="Mesa para" className="space-y-1">
              <p className="text-sm font-medium">Mesa para</p>
              <div className="flex flex-wrap gap-1">
                {selected.seats.map((seats) => (
                  <Button
                    key={seats}
                    type="button"
                    className={buttonClass}
                    variant={
                      seating?.mode === 'confirmed' && seating.seats === seats
                        ? 'default'
                        : 'ghost'
                    }
                    aria-pressed={
                      seating?.mode === 'confirmed' && seating.seats === seats
                    }
                    aria-label={`Mesa para ${seats} ${
                      seats === 1 ? 'persona' : 'personas'
                    }`}
                    disabled={disabled}
                    onClick={() =>
                      onChange({
                        mode: 'confirmed',
                        spaceId: selected.spaceId,
                        seats,
                      })
                    }
                  >
                    <Users className="size-4" aria-hidden="true" />
                    {seats}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {!selected && !needsReview && (
            <p className="text-sm text-muted-foreground">
              Elige el espacio para ver las capacidades.
            </p>
          )}
          {preferred &&
            selected &&
            party.preferredSpaceId !== selected.spaceId && (
              <p role="status" className="text-sm text-muted-foreground">
                El cliente pidió {preferred.name}. Confirma que habéis acordado
                el cambio a {selected.name}.
              </p>
            )}
        </>
      )}
    </div>
  )
}
