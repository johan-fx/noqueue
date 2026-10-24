import { ArrowLeft } from 'lucide-react'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

type Space = ServiceInput['spaces'][number]
type TableType = NonNullable<Space['tableTypes']>[number]

// Bottom sheet shown when the advanced breakdown changes the generic total.
// It only renders data. The parent decides when to open it and what to do next.
export function SpaceCapacityConfirmSheet({
  open,
  spaceName,
  type,
  tableTypes,
  onConfirm,
  onBack,
}: {
  open: boolean
  spaceName: string
  type: 'restaurant' | 'pool'
  tableTypes: TableType[]
  onConfirm: () => void
  onBack: () => void
}) {
  // Pools talk about "plazas", restaurants about "mesas".
  const plural = type === 'pool' ? 'plazas' : 'mesas'
  const titled = type === 'pool' ? 'Plazas' : 'Mesas'
  const total = tableTypes.reduce((sum, item) => sum + item.count, 0)

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onBack()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[90dvh] w-full gap-8 overflow-y-auto rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md"
      >
        <SheetHeader className="gap-4 p-0 pr-8">
          <SheetTitle className="text-2xl leading-snug font-medium text-gray-700">
            Se va a actualizar el número de {plural} disponibles
          </SheetTitle>
          {/* Screen readers get a short summary. The rows below show the data. */}
          <SheetDescription className="sr-only">
            Revisa el nuevo total antes de confirmar.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 text-lg font-medium">
          <p className="flex justify-between gap-4">
            <span className="text-gray-400">Espacio</span>
            <span className="text-gray-700">{spaceName}</span>
          </p>
          <div className="space-y-2">
            <p className="flex justify-between gap-4">
              <span className="text-gray-400">Nº total de {plural}</span>
              <span className="text-gray-700">{total}</span>
            </p>
            {tableTypes.map((item) => (
              <p
                key={item.seats}
                className="flex justify-between gap-4 text-base text-gray-400"
              >
                <span>
                  {titled} de {item.seats}
                </span>
                <span>{item.count}</span>
              </p>
            ))}
          </div>
        </div>
        <SheetFooter className="p-0">
          <Button size="lg" onClick={onConfirm}>
            Confirmar
          </Button>
          <Button size="lg" variant="outline" onClick={onBack}>
            <ArrowLeft aria-hidden="true" /> Volver
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
