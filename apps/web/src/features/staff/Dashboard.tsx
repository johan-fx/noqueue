import { VenueLocationEditor } from './VenueLocationEditor'
import { AddQueueEntryDrawer } from './AddQueueEntryDrawer'
import { entryActions, receptionLabels } from './queue-labels'
import { QueueLifecycleSheet } from './QueueLifecycleSheet'
import { readinessNotice, occupancyAction } from './queue-readiness'
import { useEffect, useState, useRef } from 'react'
import type {
  Capability,
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer'
import {
  Plus,
  MoveRight,
  UsersIcon,
  Info,
  ChevronLeft,
  Ellipsis,
} from 'lucide-react'
import { ServiceConfigDrawer } from './ServiceConfigDrawer'
import { api, ApiError, errorMessage } from './api'
import { MembersDrawer } from './MembersDrawer'
import { QueueView } from './QueueView'
import { queueActionLabels as actionLabels } from './queue-labels'

type DashboardProps =
  | { venue: VenueSummary; mode?: 'membership' }
  | { venue: Omit<VenueSummary, 'role'>; mode: 'commercial' }

export function Dashboard(props: DashboardProps) {
  const { venue } = props
  const creationRequest = useRef<{ payload: string; key: string } | null>(null)
  const [drawer, setDrawer] = useState<
    'create' | 'edit' | 'members' | 'queue' | null
  >(null)
  const [drawerError, setDrawerError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const savingRef = useRef(false)
  const menuTrigger = useRef<HTMLButtonElement | null>(null)
  const drawerTrigger = useRef<HTMLButtonElement | null>(null)
  function openDrawer(
    mode: 'create' | 'edit' | 'members' | 'queue',
    trigger: HTMLButtonElement,
  ) {
    if (savingRef.current || commandLock.current || pending || adding) return
    drawerTrigger.current = trigger
    creationRequest.current = null
    setDrawerError('')
    if (mode === 'queue') setTab('active')
    setDrawer(mode)
  }
  function closeDrawer() {
    if (!savingRef.current && !busy && !lifecycle && !pending && !adding)
      setDrawer(null)
  }
  const [queues, setQueues] = useState<QueueSummary[]>([]),
    [selected, setSelected] = useState(''),
    [entries, setEntries] = useState<StaffEntry[]>([]),
    [error, setError] = useState(''),
    [tab, setTab] = useState('active'),
    [busy, setBusy] = useState(false),
    [lastSync, setLastSync] = useState('')
  const [lifecycle, setLifecycle] = useState<{
    queueId: string
    insideDrawer?: boolean
    action:
      | 'open'
      | 'close'
      | 'occupancy'
      | 'confirm_inventory'
      | 'disable_intelligence'
      | 'enable_intelligence'
    trigger: HTMLElement | null
  } | null>(null)
  const [adding, setAdding] = useState<{
    queue: QueueSummary
    trigger: HTMLElement
  } | null>(null)
  const commandLock = useRef(false)
  const commandTrigger = useRef<HTMLElement | null>(null)
  const commandRequest = useRef<{ body: string; key: string } | null>(null)
  const [commandError, setCommandError] = useState('')
  const [commandStale, setCommandStale] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [pending, setPending] = useState<{
    queueId: string
    entry: StaffEntry
    action: QueueCommand['action']
    key: string
  } | null>(null)
  const permissions: readonly Capability[] =
    props.mode === 'commercial'
      ? ['queue.read', 'queue.configure', 'members.manage']
      : roleCapabilities[props.venue.role]
  const queueLabel = props.mode === 'commercial' ? 'Ver cola' : 'Gestionar cola'
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
        const summaries = await api<QueueSummary[]>(
          `/venues/${venue.id}/queues`,
        )
        if (live) {
          setQueues(summaries)
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
  }, [selected, venue.id])
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
        const approachChanged =
          (config.approachTurns ?? 2) !== (queue.config.approachTurns ?? 2) ||
          (config.approachMinutes ?? 10) !==
            (queue.config.approachMinutes ?? 10)
        if (
          approachChanged &&
          !window.confirm(
            'Los nuevos umbrales de acercamiento se aplicarán a los turnos en espera. ¿Quieres continuar?',
          )
        )
          return
        await api(`/queues/${queue.id}`, 'PATCH', {
          ...config,
          version: queue.version,
          open: !!queue.open,
          applyApproachToActive: approachChanged,
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
  function selectCommand(entry: StaffEntry, action: QueueCommand['action']) {
    if (!queue || commandLock.current) return
    const trigger = document.activeElement as HTMLElement
    // Entry actions collapse their tray before opening confirmation. Return to
    // the persistent disclosure, not an inert or unmounted action button.
    commandTrigger.current =
      trigger
        .closest('li[data-entry-code]')
        ?.querySelector<HTMLElement>('[aria-controls^="actions-"]') ?? trigger
    commandRequest.current = null
    setCommandError('')
    setCommandStale(false)
    setOverrideReason('')
    setPending({ queueId: queue.id, entry, action, key: crypto.randomUUID() })
  }
  async function command() {
    if (!pending || commandLock.current || commandStale) return
    commandLock.current = true
    setBusy(true)
    setCommandError('')
    const snapshot = pending
    const input = {
      entryId: snapshot.entry.id,
      version: snapshot.entry.version,
      action: snapshot.action,
      ...(['call', 'restore'].includes(snapshot.action) && overrideReason.trim()
        ? { overrideReason: overrideReason.trim() }
        : {}),
    }
    const body = JSON.stringify(input)
    if (commandRequest.current?.body !== body)
      commandRequest.current = {
        body,
        key: commandRequest.current ? crypto.randomUUID() : snapshot.key,
      }
    try {
      await api(
        `/queues/${snapshot.queueId}/commands`,
        'POST',
        input,
        commandRequest.current.key,
      )
      setPending(null)
      setOverrideReason('')
      await refresh().catch((error) =>
        setError(`Acción guardada. ${errorMessage(error)}`),
      )
    } catch (e) {
      setCommandError(errorMessage(e))
      if (e instanceof ApiError && e.status === 409) {
        setCommandStale(true)
        try {
          const rows = await api<StaffEntry[]>(
            `/queues/${snapshot.queueId}/entries`,
          )
          setEntries(rows)
          const entry = rows.find((row) => row.id === snapshot.entry.id)
          if (entry && entryActions(entry.status).includes(snapshot.action)) {
            setPending({ ...snapshot, entry, key: crypto.randomUUID() })
            commandRequest.current = null
            setCommandStale(false)
            setCommandError(
              `${errorMessage(
                e,
              )} Datos actualizados; revisa el turno y confirma de nuevo.`,
            )
          } else
            setCommandError(
              'El turno ya no permite esta acción. Cierra esta ventana y revisa la lista.',
            )
        } catch {
          setCommandError(
            'No se pudo actualizar el turno. Cierra esta ventana y actualiza la lista antes de continuar.',
          )
        }
      }
      await refresh().catch(() => undefined)
    } finally {
      commandLock.current = false
      setBusy(false)
    }
  }
  const nextEntry = entries.find(
    (entry) =>
      entry.status === 'waiting' &&
      !queue?.readiness?.reasons.includes('inventory_refresh_required') &&
      ((queue?.config.estimationMode !== 'active' &&
        !queue?.config.resourceStateKnown &&
        (!entry.preferredSpaceId || entry.preferredSpaceId === 'fastest')) ||
        entry.callable === true),
  )
  function openQueueOperation(action: NonNullable<typeof lifecycle>['action']) {
    if (!queue || busy || saving || lifecycle) return
    setLifecycle({
      queueId: queue.id,
      action,
      trigger: menuTrigger.current,
      insideDrawer: true,
    })
  }
  const lifecycleQueue = queues.find((item) => item.id === lifecycle?.queueId)
  const lifecycleSheet =
    lifecycle && lifecycleQueue ? (
      <QueueLifecycleSheet
        queueId={lifecycleQueue.id}
        name={lifecycleQueue.name}
        type={lifecycleQueue.config.type}
        action={lifecycle.action}
        returnFocus={lifecycle.trigger}
        onClose={() => setLifecycle(null)}
        onSaved={async () => {
          await refreshQueues()
          if (lifecycle.insideDrawer) await refresh()
        }}
      />
    ) : null
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{venue.name}</h1>
          <p className="text-sm text-muted-foreground">
            {venue.organizationName} ·{' '}
            {props.mode === 'commercial'
              ? 'Administración comercial'
              : props.venue.role}
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
      <VenueLocationEditor
        venueId={venue.id}
        canEditLocation={props.mode === 'commercial'}
      />
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
                <div className="grid gap-4 sm:grid-cols-1 xl:grid-cols-2">
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
                          <span className="flex min-w-0 flex-wrap items-center gap-2">
                            {service.name}
                            <Badge
                              variant={service.open ? 'default' : 'secondary'}
                            >
                              {service.open
                                ? 'Cola habilitada'
                                : 'Cola deshabilitada'}
                            </Badge>
                            {service.outsideSchedule && (
                              <Badge variant="secondary">
                                Fuera de horario
                              </Badge>
                            )}
                          </span>
                          {permissions.includes('queue.operate') && (
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
                                  setLifecycle({
                                    queueId: service.id,
                                    action: service.open ? 'close' : 'open',
                                    trigger:
                                      document.activeElement as HTMLElement,
                                  })
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
                        {(service.readiness?.state === 'pending' ||
                          occupancyAction(service) === 'confirm_inventory') && (
                          <Alert className="mb-3">
                            <Info aria-hidden="true" />
                            <AlertTitle>
                              {readinessNotice(service).title}
                            </AlertTitle>
                            <AlertDescription>
                              <ul>
                                {readinessNotice(service).messages.map(
                                  (message) => (
                                    <li
                                      key={message}
                                      className="text-muted-foreground list-disc"
                                    >
                                      {message}
                                    </li>
                                  ),
                                )}
                              </ul>
                              {permissions.includes('queue.operate') &&
                                occupancyAction(service) ===
                                  'confirm_inventory' && (
                                  <Button
                                    className="mt-2 w-full whitespace-normal sm:w-auto"
                                    variant="outline"
                                    disabled={saving || busy || !!lifecycle}
                                    onClick={(event) =>
                                      setLifecycle({
                                        queueId: service.id,
                                        action: 'confirm_inventory',
                                        trigger: event.currentTarget,
                                      })
                                    }
                                  >
                                    Confirmar ocupación
                                  </Button>
                                )}
                            </AlertDescription>
                          </Alert>
                        )}
                        {service.readiness?.state === 'disabled' && (
                          <p className="mb-3 text-sm font-medium" role="status">
                            Desactivada manualmente
                          </p>
                        )}
                        {service.readiness?.state === 'active' && (
                          <p className="mb-3 text-sm font-medium" role="status">
                            Gestión inteligente activa
                          </p>
                        )}
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
                          {queueLabel}
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
        resetKey={drawer === 'edit' ? queue?.id ?? 'edit' : 'create'}
        open={drawer === 'create' || drawer === 'edit'}
        mode={drawer === 'edit' ? 'edit' : 'create'}
        {...(drawer === 'edit' && queue ? { initial: queue.config } : {})}
        saving={saving}
        error={drawerError}
        finalFocus={drawerTrigger}
        onClose={closeDrawer}
        onSave={saveService}
      />
      {permissions.includes('members.manage') && (
        <MembersDrawer
          open={drawer === 'members'}
          venueId={venue.id}
          name={venue.name}
          finalFocus={drawerTrigger}
          onClose={closeDrawer}
        />
      )}
      <Drawer
        open={drawer === 'queue'}
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
            <div className="flex items-center gap-3">
              {drawer === 'queue' && (
                <DrawerClose
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Volver"
                      disabled={saving || busy || !!lifecycle}
                    />
                  }
                >
                  <ChevronLeft aria-hidden="true" />
                </DrawerClose>
              )}
              <div className="min-w-0 flex-1">
                <DrawerTitle className="text-xl">
                  {drawer === 'queue' ? queueLabel : 'Gestionar accesos'}
                </DrawerTitle>
                <DrawerDescription className="break-words">
                  {drawer === 'queue' ? queue?.name : venue.name}
                </DrawerDescription>
              </div>
              {drawer === 'queue' &&
                queue &&
                permissions.includes('queue.operate') && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          ref={menuTrigger}
                          variant="ghost"
                          size="icon"
                          aria-label="Opciones de la cola"
                          disabled={saving || busy || !!lifecycle}
                        />
                      }
                    >
                      <Ellipsis aria-hidden="true" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-64 max-w-[calc(100vw-2rem)]"
                      finalFocus={lifecycle ? false : menuTrigger}
                    >
                      {occupancyAction(queue) && (
                        <DropdownMenuItem
                          onClick={() =>
                            openQueueOperation(occupancyAction(queue)!)
                          }
                        >
                          {occupancyAction(queue) === 'occupancy'
                            ? 'Actualizar ocupación'
                            : 'Confirmar ocupación'}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() =>
                          openQueueOperation(
                            queue.config.intelligencePolicy === 'disabled'
                              ? 'enable_intelligence'
                              : 'disable_intelligence',
                          )
                        }
                      >
                        {queue.config.intelligencePolicy === 'disabled'
                          ? 'Volver a gestión automática'
                          : 'Desactivar gestión inteligente'}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
            </div>
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
                onAdd={(trigger) => setAdding({ queue, trigger })}
                onAction={selectCommand}
              />
            )}
          </div>
          {drawer === 'queue' &&
            tab === 'active' &&
            permissions.includes('queue.operate') && (
              <DrawerFooter className="border-t bg-background p-6 sm:flex-row sm:justify-end">
                {drawer === 'queue' &&
                  tab === 'active' &&
                  permissions.includes('queue.operate') && (
                    <Button
                      className="h-12 w-full sm:order-last sm:w-auto sm:flex-1"
                      disabled={busy || !nextEntry}
                      onClick={() => {
                        if (nextEntry) selectCommand(nextEntry, 'call')
                      }}
                    >
                      Avanzar un turno <MoveRight aria-hidden="true" />
                    </Button>
                  )}
              </DrawerFooter>
            )}
          {lifecycle?.insideDrawer && lifecycleSheet}
          {adding && (
            <AddQueueEntryDrawer
              queue={adding.queue}
              returnFocus={adding.trigger}
              onClose={() => setAdding(null)}
              onSaved={refresh}
            />
          )}
          <Sheet
            open={!!pending}
            onOpenChange={(open) => {
              if (!open && !busy) setPending(null)
            }}
          >
            <SheetContent
              side="bottom"
              finalFocus={() =>
                commandTrigger.current?.isConnected
                  ? commandTrigger.current
                  : menuTrigger.current
              }
              showCloseButton={!busy}
              className="mx-auto max-h-[90dvh] max-w-lg overflow-y-auto rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              <SheetHeader className="px-0 pr-8">
                <SheetTitle className="text-2xl">
                  {pending?.action === 'cancel'
                    ? '¿Estás seguro de que quieres cancelar el turno?'
                    : pending
                    ? actionLabels[pending.action]
                    : ''}
                </SheetTitle>
                <SheetDescription>
                  Se registrará esta acción con tu identidad.{' '}
                  {pending?.action === 'skip'
                    ? 'El turno se moverá al final de la cola.'
                    : ''}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-2 pb-12">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xl">
                    {pending?.entry.displayName ||
                      `Turno ${pending?.entry.code}`}
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Turno: </span>
                    {pending?.entry.code}
                  </p>
                </div>
                {queue?.config.type === 'restaurant' && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <UsersIcon className="size-4" aria-hidden="true" />
                    {pending?.entry.partySize} personas
                    {pending?.entry.space
                      ? ` · ${pending.entry.space.name}`
                      : ''}
                  </p>
                )}
                {queue?.config.type === 'reception' &&
                  pending?.entry.receptionService && (
                    <p className="text-xs text-muted-foreground">
                      {receptionLabels[pending.entry.receptionService]}
                    </p>
                  )}
              </div>
              {commandError && (
                <p role="alert" className="text-destructive">
                  {commandError}
                </p>
              )}
              {pending && ['call', 'restore'].includes(pending.action) && (
                <label className="space-y-2 text-sm">
                  {pending.action === 'restore'
                    ? 'Motivo de restauración (obligatorio)'
                    : 'Motivo de excepción al orden (opcional)'}
                  <input
                    className="w-full rounded border p-2"
                    value={overrideReason}
                    minLength={3}
                    maxLength={300}
                    onChange={(event) => setOverrideReason(event.target.value)}
                  />
                  <span className="text-muted-foreground">
                    {pending.action === 'restore'
                      ? 'Volverá a espera sin recuperar una mesa ya reasignada. Se auditará el motivo.'
                      : 'Solo para una llamada deliberada fuera de orden. Se auditará.'}
                  </span>
                </label>
              )}
              <SheetFooter className="gap-3 px-0">
                <Button
                  className={`h-12 w-full ${
                    pending?.action === 'cancel'
                      ? 'border-destructive text-destructive hover:text-destructive'
                      : ''
                  }`}
                  variant={pending?.action === 'cancel' ? 'outline' : 'default'}
                  disabled={busy || commandStale}
                  onClick={() => void command()}
                >
                  {busy
                    ? 'Guardando…'
                    : pending?.action === 'cancel'
                    ? 'Cancelar turno'
                    : 'Confirmar'}
                </Button>
                <Button
                  className="h-12 w-full"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setPending(null)}
                >
                  {pending?.action === 'cancel'
                    ? 'No cancelar'
                    : pending?.action === 'complete'
                    ? 'No confirmar'
                    : 'Volver'}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </DrawerContent>
      </Drawer>
      {!lifecycle?.insideDrawer && lifecycleSheet}
    </div>
  )
}
