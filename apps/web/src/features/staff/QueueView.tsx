import { useState, useEffect } from 'react'
import { Plus, Users, LogIn, LogOut, BadgeHelp } from 'lucide-react'
import { QueueEntryCard } from './QueueEntryCard'
import type {
  EntryCommand as QueueCommand,
  QueueSummary,
  StaffEntry,
} from '@noqueue/contracts/staff'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { QueuePublicLinks } from './QueuePublicLinks'

import { receptionLabels } from './queue-labels'
const views = [
  {
    value: 'active',
    label: 'Lista',
    title: 'Lista de espera',
    statuses: ['waiting', 'called'],
  },
  {
    value: 'completed',
    label: 'Completados',
    title: 'Completados',
    statuses: ['completed', 'served'],
  },
  {
    value: 'cancelled',
    label: 'Cancelados',
    title: 'Cancelados',
    statuses: ['cancelled', 'no_show', 'expired'],
  },
] as const

function AddTurnButton({
  busy,
  deactivated,
  onAdd,
}: {
  busy: boolean
  deactivated: boolean
  onAdd: (trigger: HTMLElement) => void
}) {
  const button = (
    <Button
      size="sm"
      variant="outline"
      disabled={busy || deactivated}
      onClick={(event) => onAdd(event.currentTarget)}
    >
      <Plus aria-hidden="true" />
      Añadir
    </Button>
  )
  if (!deactivated) return button
  // A disabled button ignores pointer events, so the tooltip listens on the span.
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" tabIndex={0} />}>
          {button}
        </TooltipTrigger>
        <TooltipContent>
          No se pueden añadir turnos ya que la lista está desactivada.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function QueueView({
  queue,
  entries,
  tab,
  onTabChange,
  canOperate,
  busy,
  lastSync,
  error,
  clockOffsetMs = 0,
  onAction,
  onAdd,
  onManage = () => {},
  nextEntryId,
}: {
  queue: QueueSummary
  entries: StaffEntry[]
  tab: string
  onTabChange: (value: string) => void
  canOperate: boolean
  busy: boolean
  lastSync: string
  error: string
  clockOffsetMs?: number
  onRefresh: () => void
  onAdd?: (trigger: HTMLElement) => void
  onManage?: (entry: StaffEntry) => void
  nextEntryId?: string | null
  onAction: (entry: StaffEntry, action: QueueCommand['action']) => void
}) {
  const [clientNow, setNow] = useState(Date.now)
  const now = clientNow + clockOffsetMs
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const sync = () => {
      setNow(Date.now())
      setOnline(navigator.onLine)
    }
    const timer = setInterval(sync, 1000)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])
  const [reveal, setReveal] = useState<{
    queueId: string
    id: string
    direction: 'left' | 'right' | 'all'
  } | null>(null)
  const [selection, setSelection] = useState<{
    queueId: string
    value: string
  } | null>(null)
  const filter = selection?.queueId === queue.id ? selection.value : 'all'
  // Closing the list (paused) or leaving it inactive blocks new turns.
  // The button stays visible so staff can read why it is disabled.
  const listDeactivated =
    queue.queueState === 'inactive' || queue.queueState === 'paused'
  const options =
    queue.config.type === 'reception'
      ? queue.config.receptionServices.map((type) => ({
          value: type,
          label: receptionLabels[type],
        }))
      : queue.config.type === 'restaurant'
      ? [
          ...new Set(
            entries
              .filter((entry) => ['waiting', 'called'].includes(entry.status))
              .map((entry) => entry.partySize),
          ),
        ]
          .sort((a, b) => a - b)
          .map((size) => ({ value: String(size), label: `${size} personas` }))
      : []
  const activeFilter = options.some((option) => option.value === filter)
    ? filter
    : 'all'
  const scope = `${queue.id}:${tab}:${activeFilter}`
  const [previousScope, setPreviousScope] = useState(scope)
  if (previousScope !== scope) {
    setPreviousScope(scope)
    setReveal(null)
  }
  return (
    <div className="space-y-6">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          onTabChange(String(value))
          setReveal(null)
        }}
        className="gap-6"
      >
        <TabsList
          aria-label="Vistas de la lista"
          className="w-full group-data-horizontal/tabs:h-12"
        >
          {views.map((view) => (
            <TabsTrigger key={view.value} value={view.value}>
              {view.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {views.map((view) => {
          const allRows = entries.filter((entry) =>
            (view.statuses as readonly string[]).includes(entry.status),
          )
          const rows = allRows.filter(
            (entry) =>
              view.value !== 'active' ||
              activeFilter === 'all' ||
              (queue.config.type === 'reception'
                ? entry.receptionService === activeFilter
                : String(entry.partySize) === activeFilter),
          )
          return (
            <TabsContent
              key={view.value}
              value={view.value}
              className="space-y-6"
            >
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-3xl font-medium tracking-tight">
                    {view.title}
                  </h3>
                  {view.value === 'active' && canOperate && onAdd && (
                    <AddTurnButton
                      busy={busy}
                      deactivated={listDeactivated}
                      onAdd={onAdd}
                    />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {view.value === 'active' && (
                    <span
                      className={
                        queue.open ? 'text-green-600 dark:text-green-400' : ''
                      }
                    >
                      {queue.open ? 'Abierto' : 'Cerrado'}
                    </span>
                  )}
                  <span>
                    {rows.length} {rows.length === 1 ? 'turno' : 'turnos'}
                  </span>
                </div>
              </div>
              {view.value === 'active' && options.length > 0 && (
                <div
                  role="group"
                  aria-label="Filtros de la lista"
                  className="flex max-w-full gap-1 overflow-x-auto pb-1"
                >
                  {[{ value: 'all', label: 'Todos' }, ...options].map(
                    (option) => {
                      const Icon =
                        queue.config.type === 'restaurant'
                          ? Users
                          : option.value === 'check_in'
                          ? LogIn
                          : option.value === 'check_out'
                          ? LogOut
                          : BadgeHelp
                      return (
                        <Button
                          key={option.value}
                          className="shrink-0 rounded-full"
                          size="sm"
                          variant={
                            activeFilter === option.value ? 'default' : 'ghost'
                          }
                          aria-pressed={activeFilter === option.value}
                          aria-label={`Filtrar ${option.label}`}
                          onClick={() => {
                            setSelection({
                              queueId: queue.id,
                              value: option.value,
                            })
                            setReveal(null)
                          }}
                        >
                          {option.value !== 'all' && (
                            <Icon className="size-4" aria-hidden="true" />
                          )}
                          {queue.config.type === 'restaurant' &&
                          option.value !== 'all'
                            ? option.value
                            : option.label}
                        </Button>
                      )
                    },
                  )}
                </div>
              )}
              <ul aria-label={view.title} className="space-y-2">
                {rows.map((entry) => (
                  <QueueEntryCard
                    now={now}
                    online={online}
                    key={`${scope}:${entry.id}`}
                    queue={queue}
                    entry={entry}
                    position={allRows.indexOf(entry) + 1}
                    isNext={
                      nextEntryId === undefined
                        ? allRows.indexOf(entry) === 0
                        : nextEntryId === entry.id
                    }
                    canOperate={canOperate}
                    busy={busy}
                    revealed={
                      reveal?.queueId === queue.id && reveal.id === entry.id
                        ? reveal.direction
                        : null
                    }
                    onReveal={(direction) =>
                      setReveal(
                        direction
                          ? { queueId: queue.id, id: entry.id, direction }
                          : null,
                      )
                    }
                    onAction={onAction}
                    onManage={onManage}
                  />
                ))}
              </ul>
              {!rows.length && (
                <p className="rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground">
                  {view.value === 'active'
                    ? 'No hay turnos en espera.'
                    : view.value === 'completed'
                    ? 'Todavía no hay turnos completados.'
                    : 'No hay turnos cancelados ni ausentes.'}
                </p>
              )}
            </TabsContent>
          )
        })}
      </Tabs>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {/* One row in the narrow queue drawer: the status wraps, the link does not. */}
      <div className="flex flex-nowrap items-center justify-between gap-2 border-t pt-4 pb-2 text-xs text-muted-foreground">
        <p className="min-w-0 leading-4">
          {`Última lectura: ${lastSync || 'cargando…'} `}
          <span className="whitespace-nowrap">· Cada 5 s</span>
        </p>
        <div className="shrink-0">
          <QueuePublicLinks queueId={queue.id} />
        </div>
      </div>
    </div>
  )
}
