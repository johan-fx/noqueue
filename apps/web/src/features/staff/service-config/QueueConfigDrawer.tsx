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
import { QueueConfigForm, type QueueOptions } from './QueueConfigForm'
import { type QueueBySeat } from './model'

// Nested drawer on the queue step. Draft stays local until Confirmar.
export function QueueConfigDrawer({
  open,
  type,
  options,
  spaces,
  averageMinutes,
  queueBySeat,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  type: ServiceInput['type']
  options?: QueueOptions
  spaces: ServiceInput['spaces']
  averageMinutes: number
  capacity: number
  queueBySeat: QueueBySeat[] | undefined
  onOpenChange: (open: boolean) => void
  onConfirm: (spaces: ServiceInput['spaces'], options?: QueueOptions) => void
}) {
  const fallbackMinutes = Number.isInteger(averageMinutes) ? averageMinutes : 60
  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <DrawerContent className="w-full sm:w-md">
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
              <DrawerDescription className="text-base">
                Gestión de la cola
              </DrawerDescription>
            </div>
          </div>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
          {/* Remount so each open starts from the saved overrides. */}
          {open && (
            <QueueConfigForm
              type={type}
              options={options}
              spaces={spaces}
              averageMinutes={fallbackMinutes}
              saved={queueBySeat}
              onConfirm={onConfirm}
            />
          )}
        </div>
        <DrawerFooter className="border-t bg-background p-4">
          <Button type="submit" form="queue-config" className="h-12 w-full">
            Confirmar
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
