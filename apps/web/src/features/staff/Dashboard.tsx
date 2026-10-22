import { ReplacementDecisions } from './ReplacementDecisions'
import { AssignmentOptions } from './AssignmentOptions'
import { QueueAdvancedDrawer } from './QueueAdvancedDrawer'
import { ServiceCard } from './ServiceCard'
import { VenueLocationEditor } from './VenueLocationEditor'
import { VenueLogoEditor } from './VenueLogoEditor'
import { AddQueueEntryDrawer } from './AddQueueEntryDrawer'
import { entryActions, receptionLabels } from './queue-labels'
import { QueueLifecycleSheet } from './QueueLifecycleSheet'
import { useEffect, useState, useRef, useCallback } from 'react'
import type {
  Capability,
  QueueSummary,
  QueueConfigurationContext,
  StaffEntry,
  VenueSummary,
  QueueCommand,
  EntryCommand,
  ServiceInput,
  AssignmentSeating,
  VenueLogoState,
} from '@noqueue/contracts/staff'
import {
  roleCapabilities,
  assignmentTableOptions,
  defaultAssignmentSeating,
} from '@noqueue/contracts/staff'
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

type DashboardVenue = Omit<VenueSummary, 'logo' | 'logoVersion' | 'canEditLogo'> &
  Partial<VenueLogoState>

type DashboardProps =
  | {
      venue: DashboardVenue
      mode?: 'membership'
      onVenueLogoStateChange?: (state: VenueLogoState) => void
    }
  | {
      venue: Omit<DashboardVenue, 'role'>
      mode: 'commercial'
      onVenueLogoStateChange?: (state: VenueLogoState) => void
    }

function waitingCountsFor(
  summaries: QueueSummary[],
  selectedId: string,
  rows: StaffEntry[],
) {
  return Object.fromEntries(
    summaries.flatMap((summary) => {
      const count =
        summary.waitingCount ??
        (summary.id === selectedId
          ? rows.filter((entry) => entry.status === 'waiting').length
          : undefined)
      return count === undefined ? [] : [[summary.id, count]]
    }),
  ) as Record<string, number>
}
export function Dashboard(props: DashboardProps) {
  const { venue } = props
  const logoState: VenueLogoState = {
    logo: venue.logo ?? null,
    logoVersion: venue.logoVersion ?? 0,
    canEditLogo: venue.canEditLogo ?? false,
  }
  const creationRequest = useRef<{ payload: string; key: string } | null>(null)
  const [drawer, setDrawer] = useState<
    'create' | 'edit' | 'members' | 'queue' | null
  >(null)
  const [drawerError, setDrawerError] = useState('')
  const [editBaseline, setEditBaseline] =
    useState<QueueConfigurationContext | null>(null)
  const [loadingConfiguration, setLoadingConfiguration] = useState(false)
  const configurationRequest = useRef(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const savingRef = useRef(false)
  const immediateRefresh = useRef<(() => Promise<void>) | null>(null)
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
    if (
      savingRef.current || configurationRequest.current ||
      commandLock.current || pending || adding
    ) return
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
  const commandRequest = useRef<{
    body: string
    key: string
    intent?: string
  } | null>(null)
  const [commandError, setCommandError] = useState('')
  const [commandStale, setCommandStale] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [seating, setSeating] = useState<AssignmentSeating | null>(null)
  const [commandUncertain, setCommandUncertain] = useState(false)
  function updateLogoState(next: VenueLogoState) {
    props.onVenueLogoStateChange?.(next)
  }
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
  const restaurantAssignment =
    pending?.action === 'call' && pendingQueue?.config.type === 'restaurant'
  const seatingOptions =
    restaurantAssignment && pendingEntry && pendingQueue
      ? assignmentTableOptions(pendingQueue.config, pendingEntry.partySize)
      : []
  const validSeating =
    !restaurantAssignment ||
    !seatingOptions.length ||
    (seating?.mode === 'confirmed' &&
      seatingOptions.some(
        (space) =>
          space.spaceId === seating.spaceId &&
          space.seats.includes(seating.seats),
      ))
  const pendingActionAllowed =
    !!pendingEntry &&
    !!pending &&
    (pendingEntry.allowedActions ??
      entryActions(pendingEntry.status, pendingQueue?.config.type)
    ).includes(pending.action)
  const pendingActionUnavailable =
    !!pending && (!pendingEntry || !pendingActionAllowed)
  const commitEntries = useCallback((rows: StaffEntry[]) => {
    entriesRef.current = rows
    setEntries(rows)
  }, [])
  const selectQueue = useCallback(
    (queueId: string) => {
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
      setCommandUncertain(false)
      setSeating(null)
      setCommandError('')
      setCommandStale(false)
      commandRequest.current = null
      setSelected(queueId)
    },
    [commitEntries, setPending, setArrivalMode, setSeating],
  )
  const commitQueues = useCallback(
    (rows: QueueSummary[]) => {
      queuesRef.current = rows
      setQueues(rows)
      const allowed = new Set(rows.map((row) => row.id))
      setWaitingCounts((counts) =>
        Object.fromEntries(
          Object.entries(counts).filter(([id]) => allowed.has(id)),
        ),
      )
      setAdvanced((current) =>
        current && !allowed.has(current.queueId) ? null : current,
      )
      setLifecycle((current) =>
        current && !allowed.has(current.queueId) ? null : current,
      )
      setAdding((current) =>
        current && !allowed.has(current.queue.id) ? null : current,
      )
      if (!allowed.has(selectedRef.current)) {
        if (selectedRef.current)
          setDrawer((current) =>
            current === 'queue' || current === 'edit' ? null : current,
          )
        selectQueue(rows[0]?.id ?? '')
      }
    },
    [selectQueue, setAdding],
  )
  function allowsEntryAction(
    entry: StaffEntry,
    queueId: string,
    action: EntryCommand['action'],
  ) {
    const targetQueue = queuesRef.current.find((item) => item.id === queueId)
    return (
      entry.allowedActions ??
      entryActions(entry.status, targetQueue?.config.type)
    ).includes(action)
  }
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    async function poll(forced = false) {
      clearTimeout(timer)
      controller?.abort()
      const request = new AbortController()
      controller = request
      const sequence = ++refreshSequence.current
      const catalogSequence = ++queueRefreshSequence.current
      const queueId = selectedRef.current
      let deadline: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          reject(
            new ApiError(
              503,
              'Servicio temporalmente no disponible. Inténtalo de nuevo.',
              0,
              'temporarily_unavailable',
            ),
          )
          request.abort()
        }, 15000)
      })
      let readingEntries = false
      try {
        // Commit the authorized catalogue independently: a revoked selected queue
        // returning 404 must never leave its old entries visible in the dashboard.
        const summaries = await Promise.race([
          api<QueueSummary[]>(
            `/venues/${venue.id}/queues`,
            'GET',
            undefined,
            undefined,
            request.signal,
          ),
          timeout,
        ])
        if (
          !live ||
          controller !== request ||
          catalogSequence !== queueRefreshSequence.current
        )
          return
        commitQueues(summaries)
        if (
          !queueId ||
          selectedRef.current !== queueId ||
          sequence !== refreshSequence.current
        )
          return
        if (refreshPaused.current && !forced) return
        readingEntries = true
        const rows = await Promise.race([
          api<StaffEntry[]>(
            `/queues/${queueId}/entries`,
            'GET',
            undefined,
            undefined,
            request.signal,
          ),
          timeout,
        ])
        if (
          live &&
          sequence === refreshSequence.current &&
          selectedRef.current === queueId
        ) {
          setWaitingCounts(waitingCountsFor(summaries, queueId, rows))
          commitEntries(rows)
          setLastSync(new Date().toLocaleTimeString())
          setError('')
        }
      } catch (error) {
        if (
          live &&
          controller === request &&
          sequence === refreshSequence.current
        ) {
          if (
            error instanceof ApiError &&
            [401, 403, 404].includes(error.status)
          ) {
            commitQueues(
              error.status === 401 || !readingEntries
                ? []
                : queuesRef.current.filter((row) => row.id !== queueId),
            )
            commitEntries([])
          }
          setError(errorMessage(error))
          throw error
        }
      } finally {
        clearTimeout(deadline)
        if (live && controller === request) {
          setLoading(false)
          timer = setTimeout(() => void poll().catch(() => undefined), 5000)
        }
      }
    }
    immediateRefresh.current = () => poll(true)
    const onFocus = () => {
      if (document.visibilityState !== 'hidden')
        void poll(true).catch(() => undefined)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    void poll().catch(() => undefined)
    return () => {
      live = false
      controller?.abort()
      clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      immediateRefresh.current = null
    }
  }, [selected, venue.id, commitQueues, commitEntries])
  async function refresh() {
    await immediateRefresh.current?.()
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
      setWaitingCounts(waitingCountsFor(summaries, queueId, entriesRef.current))
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
      } else if (
        drawer === 'edit' && editBaseline && queue?.id === editBaseline.id
      ) {
        // Polling must never upgrade the version of an older draft. A concurrent
        // change is a real 409, not permission to overwrite it with this form.
        const queue = editBaseline
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
      setDrawerError(
        e instanceof ApiError && e.code === 'version_conflict'
          ? 'Otra persona ha modificado la lista. Cierra y vuelve a abrir la configuración para revisar los cambios antes de guardar.'
          : errorMessage(e),
      )
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  async function editService(service: QueueSummary, trigger: HTMLButtonElement) {
    if (
      configurationRequest.current || savingRef.current ||
      commandLock.current || pending || adding
    ) return
    configurationRequest.current = true
    setLoadingConfiguration(true)
    setError('')
    selectQueue(service.id)
    try {
      const baseline = await api<QueueConfigurationContext>(
        `/queues/${service.id}/configuration-context`,
      )
      if (
        selectedRef.current !== service.id ||
        !queuesRef.current.some((row) => row.id === service.id)
      ) return
      setEditBaseline(baseline)
      configurationRequest.current = false
      openDrawer('edit', trigger)
    } catch (e) {
      setError(`No se pudo cargar la configuración. ${errorMessage(e)}`)
    } finally {
      configurationRequest.current = false
      setLoadingConfiguration(false)
    }
  }
  function selectCommand(entry: StaffEntry, action: EntryCommand['action']) {
    if (!queue || commandLock.current || selectedRef.current !== queue.id)
      return
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
    setCommandUncertain(false)
    setSeating(
      action === 'call' && queue.config.type === 'restaurant'
        ? defaultAssignmentSeating(queue.config, entry)
        : null,
    )
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
      if (e instanceof ApiError && e.status === 409)
        commandRequest.current = null
      await refresh().catch(() => undefined)
      // refresh clears read errors. Keep the command conflict visible after the
      // new head is rendered, rather than briefly flashing it before refresh.
      setError(errorMessage(e))
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
    const retryRequest = commandUncertain ? commandRequest.current : null
    if (!pending || commandLock.current || (commandStale && !retryRequest))
      return
    const snapshot = pending
    const currentEntry = entriesRef.current.find(
      (entry) => entry.id === snapshot.entryId,
    )
    if (
      !retryRequest &&
      (selectedRef.current !== snapshot.queueId ||
        !currentEntry ||
        !allowsEntryAction(currentEntry, snapshot.queueId, snapshot.action))
    ) {
      setCommandStale(true)
      setCommandError(
        'El turno ya no permite esta acción. Cierra esta ventana y revisa la lista.',
      )
      return
    }
    if (
      !retryRequest &&
      snapshot.action === 'call' &&
      currentEntry?.assignment?.available === false
    ) {
      setCommandError('El turno ya no permite esta acción. Actualiza la lista.')
      return
    }
    const currentQueue = queuesRef.current.find(
      (row) => row.id === snapshot.queueId,
    )
    const options =
      snapshot.action === 'call' &&
      currentQueue?.config.type === 'restaurant' &&
      currentEntry
        ? assignmentTableOptions(currentQueue.config, currentEntry.partySize)
        : []
    const selectedSeating =
      snapshot.action === 'call' && currentQueue?.config.type === 'restaurant'
        ? options.length
          ? seating
          : { mode: 'unspecified' as const }
        : undefined
    if (
      !retryRequest &&
      snapshot.action === 'call' &&
      currentQueue?.config.type === 'restaurant' &&
      (!selectedSeating ||
        (selectedSeating.mode === 'confirmed' &&
          !options.some(
            (space) =>
              space.spaceId === selectedSeating.spaceId &&
              space.seats.includes(selectedSeating.seats),
          )) ||
        (selectedSeating.mode === 'unspecified' && options.length > 0))
    ) {
      setCommandError('Revisa el espacio y la capacidad antes de asignar.')
      return
    }
    commandLock.current = true
    setBusy(true)
    setCommandError('')
    const reason = overrideReason.trim()
    const input = {
      entryId: currentEntry?.id ?? snapshot.entryId,
      version: currentEntry?.version ?? 0,
      action: snapshot.action,
      ...(snapshot.action === 'call'
        ? {
            arrivalMode,
            assignmentToken: currentEntry?.assignment?.token,
            ...(selectedSeating ? { seating: selectedSeating } : {}),
          }
        : {}),
      ...(['call', 'restore'].includes(snapshot.action) && reason
        ? { overrideReason: reason }
        : {}),
    }
    const body = JSON.stringify(input)
    const intent = JSON.stringify({
      queueId: snapshot.queueId,
      entryId: currentEntry?.id ?? snapshot.entryId,
      action: snapshot.action,
      ...(snapshot.action === 'call'
        ? {
            arrivalMode,
            ...(selectedSeating ? { seating: selectedSeating } : {}),
          }
        : {}),
      ...(['call', 'restore'].includes(snapshot.action) && reason
        ? { overrideReason: reason }
        : {}),
    })
    if (!retryRequest && commandRequest.current?.intent !== intent)
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
      setCommandUncertain(false)
      commandRequest.current = null
      setOverrideReason('')
      await refresh().catch((error) =>
        setError(`Acción guardada. ${errorMessage(error)}`),
      )
    } catch (e) {
      const uncertain = !(e instanceof ApiError) || e.status >= 500
      setCommandUncertain(uncertain)
      if (!uncertain) commandRequest.current = null
      if (selectedRef.current === snapshot.queueId)
        setCommandError(
          uncertain
            ? `${errorMessage(
                e,
              )} Reintenta la misma acción para comprobar si se guardó; conservamos tu selección.`
            : errorMessage(e),
        )
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
        <div className="flex min-w-0 items-center gap-3">
          <VenueLogoEditor
            venueId={venue.id}
            venueName={venue.name}
            state={logoState}
            onStateChange={updateLogoState}
          />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">{venue.name}</h1>
            <p className="text-sm text-muted-foreground">
              {venue.organizationName} ·{' '}
              {props.mode === 'commercial'
                ? 'Administración comercial'
                : props.venue.role}
            </p>
          </div>
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
                        loadingConfiguration ||
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
                        void editService(service, trigger)
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
                {loading
                  ? 'Cargando servicios…'
                  : props.mode !== 'commercial' &&
                    props.venue.role === 'queue_staff'
                  ? 'No tienes servicios asignados'
                  : 'Todavía no hay servicios.'}
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
        resetKey={drawer === 'edit' ? editBaseline?.id ?? 'edit' : 'create'}
        open={drawer === 'create' || drawer === 'edit'}
        mode={drawer === 'edit' ? 'edit' : 'create'}
        {...(drawer === 'edit' && editBaseline ? { initial: editBaseline.config } : {})}
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
            {drawer === 'queue' && queue?.config.type === 'restaurant' && permissions.includes('queue.operate') && (
              <ReplacementDecisions key={`replacement-${queue.id}`} queueId={queue.id}
                blocked={busy || saving || !!pending || !!adding || !!advanced || !!lifecycle}
                onBusy={setBusy} onResolved={refresh} returnFocus={() => menuTrigger.current} />
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
              <DrawerFooter className="border-t bg-background p-6">
                {queue?.autoReplacementEnabled && (
                  <p className="text-sm text-muted-foreground">
                    Si no llega, llamaremos al siguiente. Confirma su llegada.
                  </p>
                )}
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
                          void directCommand({ action: 'assign_next', expectedEntryId: nextEntry.id, expectedVersion: nextEntry.version })
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
              <div className="space-y-2 pb-4">
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
                    Grupo de {pendingEntry.partySize}{' '}
                    {pendingEntry.partySize === 1 ? 'persona' : 'personas'}
                    {pendingEntry.space ? ` · ${pendingEntry.space.name}` : ''}
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
                  {pendingQueue?.autoReplacementEnabled && arrivalMode === 'notify' ? (
                    <p className="text-sm text-muted-foreground">
                      {restaurantAssignment
                        ? seating?.mode === 'confirmed'
                          ? 'Si no llega, llamaremos a otro grupo del mismo tamaño compatible con esta mesa. Si no hay, te avisaremos aquí para que elijas. Confirma su llegada.'
                          : 'Sin espacio y capacidad confirmados, tendrás que asignar el siguiente turno manualmente.'
                        : 'Si no llega, llamaremos al siguiente. Confirma su llegada.'}
                    </p>
                  ) : (
                    <p>Al asignar confirmas que puedes atender este turno.{arrivalMode === 'notify' && ' El cliente tendrá el plazo configurado para presentarse.'}</p>
                  )}
                  {restaurantAssignment && pendingQueue && pendingEntry && (
                    <AssignmentOptions
                      config={pendingQueue.config}
                      party={pendingEntry}
                      seating={seating}
                      onChange={setSeating}
                      disabled={busy || commandUncertain}
                    />
                  )}
                  <div role="group" aria-label="Cliente" className="space-y-1">
                    <p className="text-sm font-medium">Cliente</p>
                    <div className="flex flex-wrap gap-1">
                      {(['notify', 'present'] as const).map((mode) => (
                        <Button
                          key={mode}
                          type="button"
                          className="min-h-11 min-w-11 rounded-full"
                          variant={arrivalMode === mode ? 'default' : 'ghost'}
                          aria-pressed={arrivalMode === mode}
                          disabled={busy || commandUncertain}
                          onClick={() => setArrivalMode(mode)}
                        >
                          {mode === 'notify'
                            ? 'Avisar al cliente'
                            : 'Ya está presente'}
                        </Button>
                      ))}
                    </div>
                  </div>
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
                    (!commandUncertain &&
                      (commandStale ||
                        pendingActionUnavailable ||
                        !validSeating ||
                        (pending?.action === 'call' &&
                          pendingEntry?.assignment?.available === false)))
                  }
                  onClick={() => void command()}
                >
                  {busy
                    ? 'Guardando…'
                    : pending?.action === 'cancel'
                    ? 'Cancelar turno'
                    : pending?.action === 'call'
                    ? restaurantAssignment &&
                      !seatingOptions.length &&
                      !commandUncertain
                      ? 'Asignar sin especificar mesa'
                      : 'Asignar turno'
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
