import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { SpaceCapacityConfirmSheet } from './SpaceCapacityConfirmSheet'
import { SpaceConfigForm } from './SpaceConfigForm'

type Space = ServiceInput['spaces'][number]
type TableType = NonNullable<Space['tableTypes']>[number]

// Nested drawer on the service wizard. Draft stays local until Confirmar.
export function SpaceConfigDrawer({
  open,
  space,
  draftKey,
  type,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  space: Space | undefined
  draftKey: number
  type: 'restaurant' | 'pool'
  onOpenChange: (open: boolean) => void
  onConfirm: (tableTypes: TableType[]) => void
}) {
  // Breakdown waiting for the user's approval. Null means no sheet is shown.
  const [pending, setPending] = useState<TableType[] | null>(null)

  // Only ask when a breakdown exists and its sum differs from the generic total.
  // An empty selection or a matching total applies right away, as before.
  function requestConfirm(tableTypes: TableType[]) {
    const total = tableTypes.reduce((sum, item) => sum + item.count, 0)
    if (tableTypes.length && space && total !== space.tables) {
      setPending(tableTypes)
      return
    }
    onConfirm(tableTypes)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <DrawerContent className="w-full sm:w-[28rem]">
        <DrawerHeader className="gap-4 border-b p-6">
          <div className="flex items-center gap-2">
            <DrawerClose
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Volver"
                />
              }
            >
              <ChevronLeft aria-hidden="true" />
            </DrawerClose>
            <div>
              <DrawerTitle className="text-xl">
                Configuración avanzada
              </DrawerTitle>
              <DrawerDescription>Capacidad</DrawerDescription>
            </div>
          </div>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
          {/* Remount so each open starts from the saved breakdown. */}
          {open && space && (
            <SpaceConfigForm
              key={draftKey}
              space={space}
              type={type}
              onConfirm={requestConfirm}
            />
          )}
        </div>
        <DrawerFooter className="border-t bg-background p-4">
          <Button type="submit" form="space-config" className="h-12 w-full">
            Confirmar
          </Button>
        </DrawerFooter>
        {/* Back keeps this drawer open with its draft untouched. */}
        <SpaceCapacityConfirmSheet
          open={pending !== null}
          spaceName={space?.name ?? ''}
          type={type}
          tableTypes={pending ?? []}
          onBack={() => setPending(null)}
          onConfirm={() => {
            if (pending) onConfirm(pending)
            setPending(null)
          }}
        />
      </DrawerContent>
    </Drawer>
  )
}
