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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ManualQueueEntryForm } from './ManualQueueEntryForm'
import { api } from './api'
import { manualQueueCopy, type ManualLocale } from './manual-queue-copy'
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
  const [locale, setLocale] = useState<ManualLocale>('es')
  const [busy, setBusy] = useState(false)
  const copy = manualQueueCopy[locale]
  return (
    <Drawer
      open
      swipeDirection="right"
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DrawerContent
        lang={locale}
        finalFocus={() => returnFocus}
        className="w-full sm:w-[28rem]"
      >
        <DrawerHeader className="border-b p-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={copy.back}
              disabled={busy}
              onClick={onClose}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <DrawerTitle className="flex-1 text-center text-base font-semibold">
              {queue.name}
            </DrawerTitle>
            {/* Language lives in the header, to the right of the queue name. */}
            <Select
              value={locale}
              items={[
                { value: 'es', label: 'ES' },
                { value: 'en', label: 'EN' },
              ]}
              disabled={busy}
              onValueChange={(value) => {
                if (value === 'es' || value === 'en') setLocale(value)
              }}
            >
              <SelectTrigger
                aria-label={copy.language}
                size="default"
                className="w-auto shrink-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                <SelectItem value="es">ES</SelectItem>
                <SelectItem value="en">EN</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DrawerDescription className="sr-only">
            {copy.addDescription}
          </DrawerDescription>
        </DrawerHeader>
        <ManualQueueEntryForm
          locale={locale}
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
            // Validate the response so a malformed reply stays in the form as an error.
            joinedEntrySchema.parse(
              await api(`/queues/${queue.id}/entries`, 'POST', input, key),
            )
            // The turn is already saved, so a failed list refresh must not block
            // the close. The dashboard shows its own refresh error.
            await onSaved().catch(() => undefined)
            onClose()
          }}
        />
      </DrawerContent>
    </Drawer>
  )
}
