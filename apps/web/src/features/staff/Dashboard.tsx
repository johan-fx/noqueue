import { Checkbox } from '@/components/ui/checkbox'
import { QueueAdvancedDrawer } from './QueueAdvancedDrawer'
import { ServiceCard } from './ServiceCard'
import { VenueLocationEditor } from './VenueLocationEditor'
import { AddQueueEntryDrawer } from './AddQueueEntryDrawer'
import { entryActions, receptionLabels } from './queue-labels'
import { QueueLifecycleSheet } from './QueueLifecycleSheet'
import { useEffect, useState, useRef } from 'react'
import type {
  Capability,
  QueueSummary,
  StaffEntry,
  VenueSummary,
  QueueCommand,
  EntryCommand,
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
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
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
import { Plus, MoveRight, UsersIcon, ChevronLeft, Ellipsis } from 'lucide-react'
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
  const refreshSequence = useRef(0)
  const queueRefreshSequence = useRef(0)
  const refreshPaused = useRef(false)
  function cardBusy(value: boolean) {
    refreshPaused.current = value
    if (value) refreshSequence.current++
    setBusy(value)
  }
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
    if (
      !savingRef.current &&
      !busy &&
      !lifecycle &&
      !pending &&
      !adding &&
      !advanced
    )
      setDrawer(null)
  }
  const [waitingCounts, setWaitingCounts] = useState<Record<string, number>>({})
  const [queues, setQueues] = useState<QueueSummary[]>([]),
    [selected, setSelected] = useState(''),
    [entries, setEntries] = useState<StaffEntry[]>([]),
    [error, setError] = useState(''),
    [tab, setTab] = useState('active'),
    [busy, setBusy] = useState(false),
    [lastSync, setLastSync] = useState('')
  const [advanced, setAdvanced] = useState<{
    queueId: string
    trigger: HTMLElement | null
    insideDrawer?: boolean
  } | null>(null)
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
      | 'declare_full'
      | 'pause'
      | 'resume'
      | 'release_unit'
    trigger: HTMLElement | null
  } | null>(null)
  const [adding, setAdding] = useState<{
    queue: QueueSummary
    trigger: HTMLElement
  } | null>(null)
  const commandLock = useRef(false)
  const commandTrigger = useRef<HTMLElement | null>(null)
  const commandRequest = useRef<
    { body: string; key: string; intent?: string } | null
  >(null)
  const [commandError, setCommandError] = useState('')
  const [commandStale, setCommandStale] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [arrivalMode, setArrivalMode] = useState<'notify' | 'present'>('notify')
  const [pending, setPending] = useState<{
    queueId: string
    entryId: string
    action: EntryCommand['action']
    key: string
  } | null>(null)
  const queuesRef = useRef<QueueSummary[]>([])
  const entriesRef = useRef<StaffEntry[]>([])
  const selectedRef = useRef('')
  const permissions: readonly Capability[] =
    props.mode === 'commercial'
      ? ['queue.read', 'queue.configure', 'members.manage']
      : roleCapabilities[props.venue.role]
  const queueLabel =
    props.mode === 'commercial' ? 'Ver lista' : 'Gestionar lista'
  const queue = queues.find((q) => q.id === selected)
  const pendingQueue = pending
    ? queues.find((item) => item.id === pending.queueId)
    : undefined
  const pendingEntry =
    pending?.queueId === selected
      ? entries.find((entry) => entry.id === pending.entryId)
      : undefined
  const pendingActionAllowed =
    !!pendingEntry &&
    !!pending &&
    allowsEntryAction(pendingEntry, pending.queueId, pending.action)
  const pendingActionUnavailable =
    !!pending && (!pendingEntry || !pendingActionAllowed)
  function commitQueues(rows: QueueSummary[]) {
    queuesRef.current = rows
    setQueues(rows)
  }
  function commitEntries(rows: StaffEntry[]) {
    entriesRef.current = rows
    setEntries(rows)
  }
  function selectQueue(queueId: string) {
    const changed = selectedRef.current !== queueId
    selectedRef.current = queueId
    if (changed) {
      refreshSequence.current++
      queueRefreshSequence.current++
      commitEntries([])
      setLastSync('')
    }
    setPending(null)
    setOverrideReason('')
    setArrivalMode('notify')
    setCommandError('')
    setCommandStale(false)
    commandRequest.current = null
    setSelected(queueId)
  }
  function allowsEntryAction(
    entry: StaffEntry,
    queueId: string,
    action: EntryCommand['action'],
  ) {
    const targetQueue = queuesRef.current.find((item) => item.id === queueId)
    return (
      entry.allowedActions ?? entryActions(entry.status, targetQueue?.config.type)
    ).includes(action)
  }
  useEffect(() => {
    let live = true
    api<QueueSummary[]>(`/venues/${venue.id}/queues`)
      .then((rows) => {
        if (live) {
          commitQueues(rows)
          selectQueue(rows[0]?.id ?? '')
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
    const queueId = selected
    if (selectedRef.current !== queueId) return
    let live = true
    async function refresh() {
      if (refreshPaused.current) return
      const sequence = ++refreshSequence.current
      try {
        const rows = await api<StaffEntry[]>(`/queues/${queueId}/entries`)
        const summaries = await api<QueueSummary[]>(
          `/venues/${venue.id}/queues`,
        )
        const counts = await Promise.all(
          summaries.map(async (summary) => {
            const waiting =
              summary.id === queueId
                ? rows
                : await api<StaffEntry[]>(`/queues/${summary.id}/entries`)
            return [
              summary.id,
              waiting.filter((entry) => entry.status === 'waiting').length,
            ] as const
          }),
        )
        if (
          live &&
          sequence === refreshSequence.current &&
          selectedRef.current === queueId
        ) {
          setWaitingCounts(Object.fromEntries(counts))
          commitQueues(summaries)
          commitEntries(rows)
          setLastSync(new Date().toLocaleTimeString())
        }
      } catch (e) {
        if (
          live &&
          sequence === refreshSequence.current &&
          selectedRef.current === queueId
        )
          setError(errorMessage(e))
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
    const queueId = selectedRef.current
    if (!queueId || queueId !== selected) return
    const sequence = ++refreshSequence.current
    try {
      const [rows, qs] = await Promise.all([
        api<StaffEntry[]>(`/queues/${queueId}/entries`),
        api<QueueSummary[]>(`/venues/${venue.id}/queues`),
      ])
      const counts = await Promise.all(
        qs.map(
          async (summary) =>
            [
              summary.id,
              (summary.id === queueId
                ? rows
                : await api<StaffEntry[]>(`/queues/${summary.id}/entries`)
              ).filter((entry) => entry.status === 'waiting').length,
            ] as const,
        ),
      )
      if (
        sequence !== refreshSequence.current ||
        selectedRef.current !== queueId ||
        selected !== queueId
      )
        return
      setWaitingCounts(Object.fromEntries(counts))
      commitEntries(rows)
      commitQueues(qs)
      setError('')
    } catch (error) {
      if (
        sequence === refreshSequence.current &&
        selectedRef.current === queueId &&
        selected === queueId
      )
        throw error
    }
  }
  async function refreshQueues() {
    const queueId = selectedRef.current
    const sequence = ++queueRefreshSequence.current
    try {
      const summaries = await api<QueueSummary[]>(`/venues/${venue.id}/queues`)
      if (
        sequence !== queueRefreshSequence.current ||
        selectedRef.current !== queueId
      )
        return
      commitQueues(summaries)
      setError('')
    } catch (e) {
      if (
        sequence === queueRefreshSequence.current &&
        selectedRef.current === queueId
      )
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
        selectQueue(result.id)
      } else if (drawer === 'edit' && queue) {
        const noticePolicyChanged =
          (config.approachMinutes ?? 10) !==
            (queue.config.approachMinutes ?? 10) ||
          (config.etaChangeThresholdMinutes ?? 5) !==
            (queue.config.etaChangeThresholdMinutes ?? 5) ||
          (config.notificationCooldownMinutes ?? 10) !==
            (queue.config.notificationCooldownMinutes ?? 10)
        const hasActiveWaiting = entries.some(
          (entry) => entry.status === 'waiting',
        )
        if (
          noticePolicyChanged &&
          hasActiveWaiting &&
          !window.confirm(
            'La política de avisos se actualizará para los turnos en espera. El plazo de llegada solo cambiará en futuras asignaciones. ¿Quieres continuar?',
          )
        )
          return
        await api(`/queues/${queue.id}`, 'PATCH', {
          ...config,
          version: queue.version,
          open: !!queue.open,
          applyApproachToActive: noticePolicyChanged && hasActiveWaiting,
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
  function selectCommand(entry: StaffEntry, action: EntryCommand['action']) {
    if (!queue || commandLock.current || selectedRef.current !== queue.id) return
    const trigger = document.activeElement as HTMLElement
    // Entry actions collapse their tray before opening confirmation. Return to
    // the persistent disclosure, not an inert or unmounted action button.
    commandTrigger.current =
      trigger
        .closest('li[data-entry-code]')
        ?.querySelector<HTMLElement>('[aria-controls^="actions-"]') ?? trigger
    if (action !== 'complete') commandRequest.current = null
    setCommandError('')
    setCommandStale(false)
    setOverrideReason('')
    setArrivalMode('notify')
    if (action === 'complete') {
      void directCommand({
        action,
        entryId: entry.id,
        version: entry.version,
      })
      return
    }
    setPending({
      queueId: queue.id,
      entryId: entry.id,
      action,
      key: crypto.randomUUID(),
    })
  }
  async function directCommand(input: QueueCommand) {
    if (!queue || commandLock.current) return
    commandLock.current = true
    setBusy(true)
    setError('')
    const body = JSON.stringify({ queueId: queue.id, input })
    if (commandRequest.current?.body !== body)
      commandRequest.current = { body, key: crypto.randomUUID() }
    try {
      await api(
        `/queues/${queue.id}/commands`,
        'POST',
        input,
        commandRequest.current.key,
      )
      commandRequest.current = null
      await refresh()
    } catch (e) {
      setError(errorMessage(e))
      if (e instanceof ApiError && e.status === 409)
        commandRequest.current = null
      await refresh().catch(() => undefined)
    } finally {
      commandLock.current = false
      setBusy(false)
      requestAnimationFrame(() =>
        (commandTrigger.current?.isConnected
          ? commandTrigger.current
          : menuTrigger.current
        )?.focus(),
      )
    }
  }
  async function command() {
    if (!pending || commandLock.current || commandStale) return
    const snapshot = pending
    const currentEntry = entriesRef.current.find(
      (entry) => entry.id === snapshot.entryId,
    )
    if (
      selectedRef.current !== snapshot.queueId ||
      !currentEntry ||
      !allowsEntryAction(currentEntry, snapshot.queueId, snapshot.action)
    ) {
      setCommandStale(true)
      setCommandError(
        'El turno ya no permite esta acción. Cierra esta ventana y revisa la lista.',
      )
      return
    }
    if (
      snapshot.action === 'call' &&
      currentEntry.assignment?.available === false
    ) {
      setCommandError('No hay una mesa compatible disponible.')
      return
    }
    commandLock.current = true
    setBusy(true)
    setCommandError('')
    const reason = overrideReason.trim()
    const input = {
      entryId: currentEntry.id,
      version: currentEntry.version,
      action: snapshot.action,
      ...(snapshot.action === 'call'
        ? { arrivalMode, assignmentToken: currentEntry.assignment?.token }
        : {}),
      ...(['call', 'restore'].includes(snapshot.action) && reason
        ? { overrideReason: reason }
        : {}),
    }
    const body = JSON.stringify(input)
    const intent = JSON.stringify({
      queueId: snapshot.queueId,
      entryId: currentEntry.id,
      action: snapshot.action,
      ...(snapshot.action === 'call' ? { arrivalMode } : {}),
      ...(['call', 'restore'].includes(snapshot.action) && reason
        ? { overrideReason: reason }
        : {}),
    })
    if (commandRequest.current?.intent !== intent)
      commandRequest.current = {
        body,
        key: commandRequest.current ? crypto.randomUUID() : snapshot.key,
        intent,
      }
    const request = commandRequest.current!
    const requestInput = JSON.parse(request.body) as typeof input
    try {
      await api(
        `/queues/${snapshot.queueId}/commands`,
        'POST',
        requestInput,
        request.key,
      )
      setPending(null)
      setOverrideReason('')
      await refresh().catch((error) =>
        setError(`Acción guardada. ${errorMessage(error)}`),
      )
    } catch (e) {
      if (selectedRef.current === snapshot.queueId)
        setCommandError(errorMessage(e))
      if (e instanceof ApiError && e.status === 409) {
        setCommandStale(true)
        commandRequest.current = null
        try {
          await refresh()
          if (selectedRef.current !== snapshot.queueId) return
          const entry = entriesRef.current.find(
            (row) => row.id === snapshot.entryId,
          )
          if (
            entry &&
            allowsEntryAction(entry, snapshot.queueId, snapshot.action)
          ) {
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
          if (selectedRef.current === snapshot.queueId)
            setCommandError(
              'No se pudo actualizar el turno. Cierra esta ventana y actualiza la lista antes de continuar.',
            )
        }
      } else await refresh().catch(() => undefined)
    } finally {
      commandLock.current = false
      setBusy(false)
    }
  }
  const nextEntry = entries.find((entry) => entry.status === 'waiting')
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
              Selecciona un servicio para gestionar su lista.
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
                    <ServiceCard
                      key={service.id}
                      service={service}
                      permissions={permissions}
                      waitingCount={waitingCounts[service.id]}
                      disabled={
                        busy ||
                        saving ||
                        !!lifecycle ||
                        !!advanced ||
                        !!pending ||
                        !!adding ||
                        !!drawer
                      }
                      onBusyChange={cardBusy}
                      onSaved={refresh}
                      onView={(trigger) => {
                        selectQueue(service.id)
                        openDrawer('queue', trigger)
                      }}
                      onConfigure={(trigger) => {
                        selectQueue(service.id)
                        openDrawer('edit', trigger)
                      }}
                      onAdvanced={(trigger) =>
                        setAdvanced({ queueId: service.id, trigger })
                      }
                      onFree={(trigger) =>
                        setLifecycle({
                          queueId: service.id,
                          action: 'release_unit',
                          trigger,
                        })
                      }
                    />
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
      {advanced &&
        !advanced.insideDrawer &&
        queues.find((q) => q.id === advanced.queueId) && (
          <QueueAdvancedDrawer
            queue={queues.find((q) => q.id === advanced.queueId)!}
            activeWaitingCount={waitingCounts[advanced.queueId] ?? 0}
            canOperate={permissions.includes('queue.operate')}
            canConfigure={permissions.includes('queue.configure')}
            returnFocus={advanced.trigger}
            onClose={() => setAdvanced(null)}
            onSaved={refresh}
          />
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
          {advanced?.insideDrawer && queue && (
            <QueueAdvancedDrawer
              queue={queue}
              activeWaitingCount={waitingCounts[queue.id] ?? 0}
              canOperate={permissions.includes('queue.operate')}
              canConfigure={permissions.includes('queue.configure')}
              returnFocus={advanced.trigger}
              onClose={() => setAdvanced(null)}
              onSaved={refresh}
            />
          )}
          <DrawerHeader className="border-b p-6">
            <div className="flex items-center gap-3">
              {drawer === 'queue' && (
                <DrawerClose
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Volver"
                      disabled={saving || busy || !!lifecycle || !!advanced}
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
                          aria-label="Opciones de la lista"
                          disabled={saving || busy || !!lifecycle || !!advanced}
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
                      <DropdownMenuItem
                        onClick={() =>
                          setAdvanced({
                            queueId: queue.id,
                            trigger: menuTrigger.current,
                            insideDrawer: true,
                          })
                        }
                      >
                        Configuración avanzada
                      </DropdownMenuItem>
                      {queue.config.type === 'restaurant' &&
                        queue.inventoryConfirmed && (
                          <DropdownMenuItem
                            onClick={() => openQueueOperation('release_unit')}
                          >
                            Mesa libre
                          </DropdownMenuItem>
                        )}
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
            queue?.config.type !== 'restaurant' &&
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
                        commandTrigger.current =
                          document.activeElement as HTMLElement
                        if (nextEntry)
                          void directCommand({ action: 'assign_next' })
                      }}
                    >
                      Asignar próximo turno <MoveRight aria-hidden="true" />
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
                    ? 'El turno se moverá al final de la lista.'
                    : ''}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-2 pb-12">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xl">
                    {pendingEntry?.displayName ||
                      (pendingEntry ? `Turno ${pendingEntry.code}` : 'Turno')}
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Turno: </span>
                    {pendingEntry?.code}
                  </p>
                </div>
                {pendingQueue?.config.type === 'restaurant' && pendingEntry && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <UsersIcon className="size-4" aria-hidden="true" />
                    {pendingEntry.partySize} personas
                    {pendingEntry.space
                      ? ` · ${pendingEntry.space.name}`
                      : ''}
                  </p>
                )}
                {pendingQueue?.config.type === 'reception' &&
                  pendingEntry?.receptionService && (
                    <p className="text-xs text-muted-foreground">
                      {receptionLabels[pendingEntry.receptionService]}
                    </p>
                  )}
              </div>
              {(commandError || pendingActionUnavailable) && (
                <p role="alert" className="text-destructive">
                  {commandError ||
                    'El turno ya no permite esta acción. Cierra esta ventana y revisa la lista.'}
                </p>
              )}
              {pending?.action === 'call' && (
                <div className="space-y-4">
                  <p>
                    {!pendingEntry
                      ? 'El turno ya no permite esta acción.'
                      : pendingEntry.assignment?.available === false
                      ? 'No hay una mesa compatible disponible.'
                      : `Disponibilidad compatible${
                          pendingEntry.assignment?.spaceName
                            ? ` · ${pendingEntry.assignment.spaceName}`
                            : ''
                        }. El sistema asignará la mesa.`}
                  </p>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="assignment-present"
                      checked={arrivalMode === 'present'}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        setArrivalMode(checked ? 'present' : 'notify')
                      }
                    />
                    <label htmlFor="assignment-present">
                      Cliente ya presente
                    </label>
                  </div>
                  {pendingEntry?.assignment?.priorityRequired && (
                    <label className="space-y-2 text-sm">
                      Motivo de prioridad (obligatorio)
                      <input
                        className="w-full rounded border p-2"
                        value={overrideReason}
                        minLength={3}
                        maxLength={300}
                        disabled={busy}
                        onChange={(event) =>
                          setOverrideReason(event.target.value)
                        }
                      />
                    </label>
                  )}
                </div>
              )}
              <SheetFooter className="gap-3 px-0">
                <Button
                  className={`h-12 w-full ${
                    pending?.action === 'cancel'
                      ? 'border-destructive text-destructive hover:text-destructive'
                      : ''
                  }`}
                  variant={pending?.action === 'cancel' ? 'outline' : 'default'}
                  disabled={
                    busy ||
                    commandStale ||
                    pendingActionUnavailable ||
                    (pending?.action === 'call' &&
                      (pendingEntry?.assignment?.available === false ||
                        (!!pendingEntry?.assignment?.priorityRequired &&
                          overrideReason.trim().length < 3)))
                  }
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
