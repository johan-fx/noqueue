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
import { api } from './api'
import {
  manualQueueCopy,
  manualQueueError,
  type ManualLocale,
} from './manual-queue-copy'
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
  const [result, setResult] = useState<{
    code: string
    recoveryToken: string
    locale: ManualLocale
  } | null>(null)
  const [notice, setNotice] = useState<
    'copied' | 'copyFailed' | { error: unknown } | null
  >(null)
  const activeLocale = result?.locale ?? locale
  const copy = manualQueueCopy[activeLocale]
  const url = result
    ? `${window.location.origin}/t/${result.recoveryToken}?lang=${result.locale}`
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
        lang={activeLocale}
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
            <span aria-hidden="true" className="w-9" />
          </div>
          <DrawerDescription className="sr-only">
            {result ? copy.added : copy.addDescription}
          </DrawerDescription>
          <div
            role="group"
            aria-label={copy.language}
            className="flex justify-end gap-1 pt-2"
          >
            {(['es', 'en'] as const).map((language) => (
              <Button
                key={language}
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={activeLocale === language}
                disabled={busy || result !== null}
                onClick={() => setLocale(language)}
              >
                {language.toUpperCase()}
              </Button>
            ))}
          </div>
        </DrawerHeader>
        {result ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <h2 className="text-2xl font-medium">{copy.added}</h2>
            <p className="text-xl font-medium">
              {copy.code}: {result.code}
            </p>
            <label className="block space-y-2">
              {copy.link}
              <Input readOnly value={url} onFocus={(e) => e.target.select()} />
            </label>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  .writeText(url)
                  .then(() => setNotice('copied'))
                  .catch(() => setNotice('copyFailed'))
              }}
            >
              {copy.copy}
            </Button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="block text-center underline"
            >
              {copy.open}
            </a>
            <Button className="w-full" onClick={onClose}>
              {copy.close}
            </Button>
          </div>
        ) : (
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
              const entry = joinedEntrySchema.parse(
                await api(`/queues/${queue.id}/entries`, 'POST', input, key),
              )
              setResult({ ...entry, locale: input.locale })
              try {
                await onSaved()
              } catch (e) {
                setNotice({ error: e })
              }
            }}
          />
        )}
        {notice && (
          <p role="status" className="px-4 pb-4">
            {typeof notice === 'string'
              ? copy[notice]
              : `${copy.created} ${manualQueueError(
                  notice.error,
                  activeLocale,
                )}`}
          </p>
        )}
      </DrawerContent>
    </Drawer>
  )
}
