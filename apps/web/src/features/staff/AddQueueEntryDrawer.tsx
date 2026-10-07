import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import type { QueueSummary } from '@noqueue/contracts/staff'
import { joinedEntrySchema } from '@noqueue/contracts/queue'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ManualQueueEntryForm } from './ManualQueueEntryForm'
import { api, errorMessage } from './api'
export function AddQueueEntryDrawer({
  queue,
  onClose,
  onSaved,
  returnFocus,
}: {
  queue: QueueSummary
  onClose: () => void
  onSaved: () => Promise<void>
  returnFocus: HTMLElement | null
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    code: string
    recoveryToken: string
  } | null>(null)
  const [notice, setNotice] = useState('')
  const url = result
    ? `${window.location.origin}/t/${result.recoveryToken}?lang=es`
    : ''
  return (
    <Drawer
      open
      swipeDirection="right"
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DrawerContent
        finalFocus={() => returnFocus}
        className="w-full sm:w-[28rem]"
      >
        <DrawerHeader className="border-b p-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Volver"
              disabled={busy}
              onClick={onClose}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <DrawerTitle className="flex-1 text-center text-base font-semibold">
              {queue.name}
            </DrawerTitle>
            <span aria-hidden="true" className="w-9" />
          </div>
          <DrawerDescription className="sr-only">
            {result ? 'Turno añadido' : 'Añadir a la lista'}
          </DrawerDescription>
        </DrawerHeader>
        {result ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <h2 className="text-2xl font-medium">Turno añadido</h2>
            <p className="text-xl font-medium">Turno: {result.code}</p>
            <label className="block space-y-2">
              Enlace del turno
              <Input readOnly value={url} onFocus={(e) => e.target.select()} />
            </label>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  .writeText(url)
                  .then(() => setNotice('Enlace copiado.'))
                  .catch(() =>
                    setNotice(
                      'No se pudo copiar. Selecciona y copia el enlace.',
                    ),
                  )
              }}
            >
              Copiar enlace
            </Button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="block text-center underline"
            >
              Abrir turno
            </a>
            <Button className="w-full" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        ) : (
          <ManualQueueEntryForm
            service={{
              type: queue.config.type,
              receptionServices: queue.config.receptionServices,
              spaces: queue.config.spaces.map((space) => ({
                id: space.id!,
                name: space.name,
                maxPartySize: space.tableTypes?.length
                  ? Math.max(...space.tableTypes.map((type) => type.seats))
                  : 20,
              })),
            }}
            whatsappRequired={queue.manualJoinWhatsappRequired !== false}
            onBusyChange={setBusy}
            onSubmit={async (input, key) => {
              const entry = joinedEntrySchema.parse(
                await api(`/queues/${queue.id}/entries`, 'POST', input, key),
              )
              setResult(entry)
              try {
                await onSaved()
              } catch (e) {
                setNotice(`El turno está creado. ${errorMessage(e)}`)
              }
            }}
          />
        )}
        {notice && (
          <p role="status" className="px-4 pb-4">
            {notice}
          </p>
        )}
      </DrawerContent>
    </Drawer>
  )
}
