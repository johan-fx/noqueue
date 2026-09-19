import { useState } from 'react'
import { Check, ChevronDown, Clock, X } from 'lucide-react'
import type {
  QueueCommand,
  QueueSummary,
  StaffEntry,
} from '@noqueue/contracts/staff'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

import { queueActionLabels } from './queue-labels'
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
const statusLabels: Record<string, string> = {
  waiting: 'En espera',
  called: 'Llamado',
  completed: 'Completado',
  served: 'Completado',
  cancelled: 'Cancelado',
  no_show: 'No presentado',
  expired: 'Caducado',
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
  onRefresh,
  onAction,
}: {
  queue: QueueSummary
  entries: StaffEntry[]
  tab: string
  onTabChange: (value: string) => void
  canOperate: boolean
  busy: boolean
  lastSync: string
  error: string
  onRefresh: () => void
  onAction: (entry: StaffEntry, action: QueueCommand['action']) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <div className="space-y-6">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          onTabChange(String(value))
          setExpanded(null)
        }}
        className="gap-6"
      >
        <TabsList
          aria-label="Vistas de la cola"
          className="w-full group-data-horizontal/tabs:h-12"
        >
          {views.map((view) => (
            <TabsTrigger key={view.value} value={view.value}>
              {view.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {views.map((view) => {
          const rows = entries.filter((entry) =>
            (view.statuses as readonly string[]).includes(entry.status),
          )
          return (
            <TabsContent
              key={view.value}
              value={view.value}
              className="space-y-6"
            >
              <div className="space-y-2">
                <h3 className="text-3xl font-medium tracking-tight">
                  {view.title}
                </h3>
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
              <ul aria-label={view.title} className="space-y-4">
                {rows.map((entry, index) => {
                  const active = view.value === 'active'
                  const completed = view.value === 'completed'
                  const actions: QueueCommand['action'][] =
                    entry.status === 'waiting'
                      ? ['call', 'skip', 'cancel']
                      : entry.status === 'called'
                        ? ['complete', 'no_show', 'cancel']
                        : []
                  return (
                    <li
                      key={entry.id}
                      className="rounded-lg border bg-background"
                    >
                      <div className="flex min-h-21 items-center gap-4 p-4">
                        {active && (
                          <span
                            aria-label={'Posición ' + (index + 1)}
                            className="w-6 shrink-0 text-center text-2xl font-medium tabular-nums"
                          >
                            {index + 1}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {entry.partySize === 1
                              ? '1 persona'
                              : entry.partySize + ' personas'}
                          </p>
                          <p className="break-words text-sm">
                            <span className="text-muted-foreground">
                              Turno:{' '}
                            </span>
                            <span className="font-medium">{entry.code}</span>
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <span
                            className={
                              'flex items-center gap-1 text-xs font-medium ' +
                              (completed
                                ? 'text-green-600 dark:text-green-400'
                                : active
                                  ? 'text-muted-foreground'
                                  : 'text-destructive')
                            }
                          >
                            {completed ? (
                              <Check className="size-4" aria-hidden="true" />
                            ) : !active ? (
                              <X className="size-4" aria-hidden="true" />
                            ) : null}
                            {statusLabels[entry.status] ?? entry.status}
                          </span>
                          {entry.status === 'called' &&
                            entry.calledAt != null && (
                              <Badge
                                variant="secondary"
                                title="Tiempo desde la llamada"
                              >
                                <Clock aria-hidden="true" className="size-3" />
                                {Math.max(
                                  0,
                                  Math.floor(
                                    (Date.now() - entry.calledAt) / 60000,
                                  ),
                                )}{' '}
                                min
                              </Badge>
                            )}
                          {canOperate && actions.length > 0 && (
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={busy}
                              aria-label={'Acciones del turno ' + entry.code}
                              aria-expanded={expanded === entry.id}
                              aria-controls={'actions-' + entry.id}
                              onClick={() =>
                                setExpanded(
                                  expanded === entry.id ? null : entry.id,
                                )
                              }
                            >
                              <ChevronDown
                                aria-hidden="true"
                                className={
                                  expanded === entry.id ? 'rotate-180' : ''
                                }
                              />
                            </Button>
                          )}
                        </div>
                      </div>
                      {canOperate &&
                        actions.length > 0 &&
                        expanded === entry.id && (
                          <div
                            id={'actions-' + entry.id}
                            className="flex flex-wrap gap-2 border-t p-3"
                          >
                            {actions.map((action) => (
                              <Button
                                key={action}
                                variant="outline"
                                disabled={busy}
                                onClick={() => onAction(entry, action)}
                              >
                                {queueActionLabels[action]}
                              </Button>
                            ))}
                          </div>
                        )}
                    </li>
                  )
                })}
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
      <div className="space-y-2 border-t pt-4 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>Última lectura: {lastSync || 'cargando…'} · Cada 5 s</p>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onRefresh}>
            Actualizar
          </Button>
        </div>
        <a
          className="underline"
          href={'/q/' + queue.id}
          target="_blank"
          rel="noreferrer"
        >
          Abrir enlace público de la cola
        </a>
      </div>
    </div>
  )
}
