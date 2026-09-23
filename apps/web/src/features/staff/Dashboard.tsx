import { useEffect, useState, useRef } from 'react'
import type {
  QueueSummary,
  StaffEntry,
  VenueSummary,
  QueueCommand,
  ServiceInput,
} from '@noqueue/contracts/staff'
import { roleCapabilities } from '@noqueue/contracts/staff'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardAction,
  CardDescription,
  CardFooter,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/components/ui/drawer'
import { Plus, MoveRight, UsersIcon } from 'lucide-react'
import { ServiceConfigDrawer } from './ServiceConfigDrawer'
import { api, errorMessage } from './api'
import { Members } from './Members'
import { QueueView } from './QueueView'
import { queueActionLabels as actionLabels } from './queue-labels'

export function Dashboard({ venue }: { venue: VenueSummary }) {
  const creationRequest = useRef<{ payload: string; key: string } | null>(null)
  const [drawer, setDrawer] = useState<
    'create' | 'edit' | 'members' | 'queue' | null
  >(null)
  const [drawerError, setDrawerError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const savingRef = useRef(false)
  const drawerTrigger = useRef<HTMLButtonElement | null>(null)
  function openDrawer(
    mode: 'create' | 'edit' | 'members' | 'queue',
    trigger: HTMLButtonElement,
  ) {
    if (savingRef.current) return
    drawerTrigger.current = trigger
    creationRequest.current = null
    setDrawerError('')
    if (mode === 'queue') setTab('active')
    setDrawer(mode)
  }
  function closeDrawer() {
    if (!savingRef.current && !busy) setDrawer(null)
  }
  const [queues, setQueues] = useState<QueueSummary[]>([]),
    [selected, setSelected] = useState(''),
    [entries, setEntries] = useState<StaffEntry[]>([]),
    [error, setError] = useState(''),
    [tab, setTab] = useState('active'),
    [busy, setBusy] = useState(false),
    [lastSync, setLastSync] = useState('')
  const [pending, setPending] = useState<{
    entry: StaffEntry
    action: QueueCommand['action']
    key: string
  } | null>(null)
  const permissions = roleCapabilities[venue.role]
  const queue = queues.find((q) => q.id === selected)
  useEffect(() => {
    let live = true
    api<QueueSummary[]>(`/venues/${venue.id}/queues`)
      .then((rows) => {
        if (live) {
          setQueues(rows)
          setSelected(rows[0]?.id ?? '')
        }
      })
      .catch((e) => {
        if (live) setError(errorMessage(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [venue.id])
  useEffect(() => {
    if (!selected) return
    let live = true
    async function refresh() {
      try {
        const rows = await api<StaffEntry[]>(`/queues/${selected}/entries`)
        if (live) {
          setEntries(rows)
          setLastSync(new Date().toLocaleTimeString())
        }
      } catch (e) {
        if (live) setError(errorMessage(e))
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [selected])
  async function refresh() {
    const [rows, qs] = await Promise.all([
      api<StaffEntry[]>(`/queues/${selected}/entries`),
      api<QueueSummary[]>(`/venues/${venue.id}/queues`),
    ])
    setEntries(rows)
    setQueues(qs)
  }
  async function refreshQueues() {
    try {
      setQueues(await api<QueueSummary[]>(`/venues/${venue.id}/queues`))
      setError('')
    } catch (e) {
      setError(`No se pudo actualizar el listado. ${errorMessage(e)}`)
    }
  }
  async function saveService(config: ServiceInput) {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setDrawerError('')
    try {
      if (drawer === 'create') {
        const payload = JSON.stringify(config)
        if (creationRequest.current?.payload !== payload)
          creationRequest.current = { payload, key: crypto.randomUUID() }
        const result = await api<{ id: string }>(
          `/venues/${venue.id}/queues`,
          'POST',
          config,
          creationRequest.current.key,
        )
        setEntries([])
        setLastSync('')
        setSelected(result.id)
      } else if (drawer === 'edit' && queue) {
        await api(`/queues/${queue.id}`, 'PATCH', {
          ...config,
          version: queue.version,
          open: !!queue.open,
        })
      } else return
      setDrawer(null)
      creationRequest.current = null
      await refreshQueues()
    } catch (e) {
      setDrawerError(errorMessage(e))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  async function toggleQueue(target: QueueSummary) {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      await api(`/queues/${target.id}`, 'PATCH', {
        ...target.config,
        version: target.version,
        open: !target.open,
      })
      setQueues(await api<QueueSummary[]>(`/venues/${venue.id}/queues`))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  async function command() {
    if (!pending) return
    setBusy(true)
    setError('')
    try {
      await api(
        `/queues/${selected}/commands`,
        'POST',
        {
          entryId: pending.entry.id,
          version: pending.entry.version,
          action: pending.action,
        },
        pending.key,
      )
      setPending(null)
      await refresh()
    } catch (e) {
      setError(errorMessage(e))
      await refresh().catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }
  const nextEntry = entries.find((entry) => entry.status === 'waiting')
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{venue.name}</h1>
          <p className="text-sm text-muted-foreground">
            {venue.organizationName} · {venue.role}
          </p>
        </div>
        {permissions.includes('members.manage') && (
          <Button
            variant="outline"
            className="text-sm!"
            onClick={(event) => openDrawer('members', event.currentTarget)}
          >
            <UsersIcon className="size-4" /> Accesos
          </Button>
        )}
      </div>
      <section aria-label="Listado de servicios" aria-busy={loading}>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-xl font-semibold">Servicios</h2>
            </CardTitle>
            <CardDescription>
              Selecciona un servicio para gestionar su cola.
            </CardDescription>
            {permissions.includes('queue.configure') && (
              <CardAction>
                <Button
                  onClick={(event) => openDrawer('create', event.currentTarget)}
                >
                  <Plus aria-hidden="true" />
                  Añadir servicio
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {queues.length ? (
              <div className="flex flex-col pb-4">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {queues.map((service) => (
                    <Card
                      key={service.id}
                      role="article"
                      aria-label={'Servicio ' + service.name}
                      size="sm"
                      className={
                        selected === service.id
                          ? 'ring-1 ring-primary'
                          : undefined
                      }
                    >
                      <CardHeader>
                        <CardTitle className="flex w-full items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2">
                            {service.name}
                            <Badge
                              variant={service.open ? 'default' : 'secondary'}
                            >
                              {service.open ? 'Abierto' : 'Cerrado'}
                            </Badge>
                          </span>
                          {permissions.includes('queue.configure') && (
                            <Label
                              htmlFor={`queue-open-${service.id}`}
                              className="shrink-0 font-normal"
                            >
                              Abrir cola
                              <Switch
                                id={`queue-open-${service.id}`}
                                size="sm"
                                checked={!!service.open}
                                disabled={saving}
                                onCheckedChange={() =>
                                  void toggleQueue(service)
                                }
                              />
                            </Label>
                          )}
                        </CardTitle>
                        <CardDescription>
                          {
                            {
                              restaurant: 'Restaurante',
                              pool: 'Piscina',
                              reception: 'Recepción',
                            }[service.config.type]
                          }
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <dl className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <dt className="text-muted-foreground">Capacidad</dt>
                            <dd className="font-medium">{service.capacity}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">
                              Duración media
                            </dt>
                            <dd className="font-medium">
                              {service.averageMinutes} min
                            </dd>
                          </div>
                        </dl>
                      </CardContent>
                      <CardFooter className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          className="w-full sm:w-auto"
                          variant="outline"
                          aria-pressed={selected === service.id}
                          onClick={(event) => {
                            if (selected !== service.id) {
                              setEntries([])
                              setLastSync('')
                            }
                            setSelected(service.id)
                            setPending(null)
                            openDrawer('queue', event.currentTarget)
                          }}
                        >
                          Gestionar cola
                        </Button>
                        {permissions.includes('queue.configure') && (
                          <Button
                            className="w-full sm:w-auto"
                            variant="outline"
                            onClick={(event) => {
                              if (selected !== service.id) {
                                setEntries([])
                                setLastSync('')
                              }
                              setSelected(service.id)
                              setPending(null)
                              openDrawer('edit', event.currentTarget)
                            }}
                          >
                            Configurar servicio
                          </Button>
                        )}
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              </div>
            ) : (
              <p className="py-10 text-center text-muted-foreground">
                {loading ? 'Cargando servicios…' : 'Todavía no hay servicios.'}
              </p>
            )}
          </CardContent>
        </Card>
      </section>
      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-destructive">
            {error}
          </p>
          <Button variant="outline" onClick={() => void refreshQueues()}>
            Actualizar listado
          </Button>
        </div>
      )}
      <ServiceConfigDrawer
        resetKey={drawer === 'edit' ? (queue?.id ?? 'edit') : 'create'}
        open={drawer === 'create' || drawer === 'edit'}
        mode={drawer === 'edit' ? 'edit' : 'create'}
        {...(drawer === 'edit' && queue ? { initial: queue.config } : {})}
        saving={saving}
        error={drawerError}
        finalFocus={drawerTrigger}
        onClose={closeDrawer}
        onSave={saveService}
      />
      <Drawer
        open={drawer === 'members' || drawer === 'queue'}
        onOpenChange={(open) => {
          if (!open) closeDrawer()
        }}
        swipeDirection="right"
      >
        <DrawerContent
          finalFocus={drawerTrigger}
          className="w-full sm:w-[48rem] sm:max-w-[calc(100vw-2rem)]"
        >
          <DrawerHeader className="border-b p-6">
            <DrawerTitle className="text-xl">
              {drawer === 'queue' ? 'Gestionar cola' : 'Gestionar accesos'}
            </DrawerTitle>
            <DrawerDescription>
              {drawer === 'queue' ? queue?.name : venue.name}
            </DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
            {drawerError && (
              <p role="alert" className="mb-4 text-destructive">
                {drawerError}
              </p>
            )}
            {drawer === 'queue' && queue && (
              <QueueView
                key={queue.id}
                queue={queue}
                entries={entries}
                tab={tab}
                onTabChange={setTab}
                canOperate={permissions.includes('queue.operate')}
                busy={busy}
                lastSync={lastSync}
                error={error}
                onRefresh={() =>
                  void refresh().catch((e) => setError(errorMessage(e)))
                }
                onAction={(entry, action) =>
                  setPending({ entry, action, key: crypto.randomUUID() })
                }
              />
            )}
            {drawer === 'members' && permissions.includes('members.manage') && (
              <Members venueId={venue.id} name={venue.name} compact />
            )}
          </div>
          <DrawerFooter className="border-t bg-background p-6 sm:flex-row sm:justify-end">
            {drawer === 'queue' &&
              tab === 'active' &&
              permissions.includes('queue.operate') && (
                <Button
                  className="h-12 w-full sm:order-last sm:w-auto sm:flex-1"
                  disabled={busy || !nextEntry}
                  onClick={() => {
                    if (nextEntry)
                      setPending({
                        entry: nextEntry,
                        action: 'call',
                        key: crypto.randomUUID(),
                      })
                  }}
                >
                  Avanzar un turno <MoveRight aria-hidden="true" />
                </Button>
              )}
            <Button
              variant="outline"
              disabled={saving || busy}
              onClick={closeDrawer}
            >
              Cerrar
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      <Dialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open && !busy) setPending(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending ? actionLabels[pending.action] : ''}
            </DialogTitle>
            <DialogDescription>
              Turno {pending?.entry.code}. Se registrará esta acción con tu
              identidad.{' '}
              {pending?.action === 'skip'
                ? 'El turno se moverá al final de la cola.'
                : ''}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Volver
            </Button>
            <Button disabled={busy} onClick={() => void command()}>
              {busy ? 'Guardando…' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
