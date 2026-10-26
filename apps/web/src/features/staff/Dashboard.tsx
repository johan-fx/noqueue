import { QueueAdvancedDrawer } from './QueueAdvancedDrawer'
import { ServiceCard } from './ServiceCard'
import { VenueLocationEditor } from './VenueLocationEditor'
import { VenueLogoEditor } from './VenueLogoEditor'
import { AddQueueEntryDrawer } from './AddQueueEntryDrawer'
import { entryActions } from './queue-labels'
import { QueueLifecycleSheet } from './QueueLifecycleSheet'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Toast } from '@base-ui/react/toast'
import type {
  Capability,
  QueueSummary,
  QueueConfigurationContext,
  StaffEntry,
  VenueSummary,
  QueueCommand,
  EntryCommand,
  ServiceInput,
  QueueAutomation,
  QueueAutomationEvent,
  AssignmentSeating,
  QueueCommandResult,
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
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer'
import { Plus, UsersIcon, ChevronLeft, SettingsIcon } from 'lucide-react'
import { ServiceConfigDrawer } from './ServiceConfigDrawer'
import { api, ApiError, errorMessage } from './api'
import { MembersDrawer } from './MembersDrawer'
import { QueueView } from './QueueView'
import { QueueAutomationFooter } from './QueueAutomationFooter'
import { QueueToastViewport } from './QueueToasts'
import type { QueueToastData } from './QueueToasts'
import { QueueTurnSheets } from './QueueTurnSheets'

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

function olderCompatibleRestaurantEntries(
  queue: QueueSummary,
  rows: StaffEntry[],
  selected: StaffEntry,
  seating: AssignmentSeating | null,
) {
  const selectedSpaceId =
    (seating?.mode === 'confirmed' ? seating.spaceId : null) ??
    selected.assignedSeating?.spaceId ??
    (selected.preferredSpaceId && selected.preferredSpaceId !== 'fastest'
      ? selected.preferredSpaceId
      : null) ??
    selected.space?.id ??
    null
  const selectedSeats =
    seating?.mode === 'confirmed'
      ? seating.seats
      : selected.assignedSeating?.seats ?? null
  const availableSeats = selectedSpaceId
    ? assignmentTableOptions(queue.config, selected.partySize)
        .filter((option) => option.spaceId === selectedSpaceId)
        .flatMap((option) => option.seats)
    : []
  return rows
    .filter((candidate) => {
      const predatesSelected =
        candidate.waitingSince != null && selected.waitingSince != null
          ? candidate.waitingSince < selected.waitingSince
          : candidate.sequence < selected.sequence
      if (
        candidate.id === selected.id ||
        candidate.status !== 'waiting' ||
        candidate.manualOnly ||
        candidate.callable === false ||
        !predatesSelected ||
        candidate.partySize > selected.partySize ||
        candidate.assignment?.available === false
      )
        return false
      const candidatePreference =
        candidate.preferredSpaceId && candidate.preferredSpaceId !== 'fastest'
          ? candidate.preferredSpaceId
          : candidate.space?.source === 'preferred'
            ? candidate.space.id
            : null
      if (selectedSpaceId && candidatePreference && candidatePreference !== selectedSpaceId)
        return false
      if (selectedSeats != null && candidate.partySize > selectedSeats)
        return false
      if (
        availableSeats.length &&
        !availableSeats.some((seats) => seats >= candidate.partySize)
      )
        return false
      return true
    })
    .sort((a, b) => {
      if (a.waitingSince != null && b.waitingSince != null)
        return a.waitingSince - b.waitingSince || a.sequence - b.sequence
      return a.sequence - b.sequence
    })
}

function DashboardContent(props: DashboardProps) {
  const { add: addToast, close: closeToasts } =
    Toast.useToastManager<QueueToastData>()
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
  const [queueToastSessionId, setQueueToastSessionId] = useState<string | null>(
    null,
  )
  const queueToastSession = useRef<{
    queueId: string
    id: string
  } | null>(null)
  const queueToastSessionSequence = useRef(0)
  const queueDrawerVisible = useRef(false)
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
    if (mode === 'queue') {
      const queueId = selectedRef.current
      const sessionId = `${queueId}:${++queueToastSessionSequence.current}`
      closeToasts()
      automationCursor.current = null
      seenAutomationEventIds.current.clear()
      automationCursorGeneration.current++
      queueToastSession.current = queueId ? { queueId, id: sessionId } : null
      queueDrawerVisible.current = !!queueId
      setQueueToastSessionId(queueId ? sessionId : null)
      setTab('active')
    } else {
      endQueueToastSession()
    }
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
    ) {
      endQueueToastSession()
      setDrawer(null)
    }
  }
  const [waitingCounts, setWaitingCounts] = useState<Record<string, number>>({})
  const [automationSnapshot, setAutomationSnapshot] = useState<
    (QueueAutomation & { observedAt: number }) | null
  >(null)
  const automationCursor = useRef<{ queueId: string; cursor: number } | null>(null)
  const seenAutomationEventIds = useRef(new Set<number>())
  const automationCursorGeneration = useRef(0)
  const endQueueToastSession = useCallback(() => {
    queueDrawerVisible.current = false
    queueToastSession.current = null
    setQueueToastSessionId(null)
    automationCursor.current = null
    seenAutomationEventIds.current.clear()
    automationCursorGeneration.current++
    closeToasts()
  }, [closeToasts])
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
  const [managedEntryId, setManagedEntryId] = useState<string | null>(null)
  const [olderAssignmentWarning, setOlderAssignmentWarning] = useState(false)
  const [automaticConflict, setAutomaticConflict] = useState<
    'processed' | 'assigned' | null
  >(null)
  const announcedOperationIds = useRef(new Set<string>())
  const [pending, setPending] = useState<{
    queueId: string
    entryId: string
    action: EntryCommand['action']
    key: string
  } | null>(null)
  const queuesRef = useRef<QueueSummary[]>([])
  const entriesRef = useRef<StaffEntry[]>([])
  const selectedRef = useRef('')
  // A stale catalogue must not immediately reselect a queue whose entries
  // denied access. Retry on the next polling interval or explicit refresh.
  const deniedSelections = useRef(new Set<string>())
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
  const managedEntry = managedEntryId
    ? entries.find((entry) => entry.id === managedEntryId)
    : undefined
  const managedActions = managedEntry && permissions.includes('queue.operate')
    ? managedEntry.allowedActions ?? entryActions(managedEntry.status, queue?.config.type)
    : []
  const managedIsNext =
    !!managedEntry && automationSnapshot?.nextEntry?.id === managedEntry.id
  const restaurantAssignment =
    pending?.action === 'call' && pendingQueue?.config.type === 'restaurant'
  const seatingOptions =
    restaurantAssignment && pendingEntry && pendingQueue
      ? assignmentTableOptions(pendingQueue.config, pendingEntry.partySize)
      : []
  const olderCompatibleCandidates =
    pending?.action === 'call' &&
    pendingQueue?.config.type === 'restaurant' &&
    pendingEntry
      ? olderCompatibleRestaurantEntries(
          pendingQueue,
          entries,
          pendingEntry,
          seating,
        )
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
        endQueueToastSession()
        refreshSequence.current++
        queueRefreshSequence.current++
        commitEntries([])
        setAutomationSnapshot(null)
        setLastSync('')
      }
      setPending(null)
      setOverrideReason('')
      setArrivalMode('notify')
      setCommandUncertain(false)
      setSeating(null)
      setCommandError('')
      setCommandStale(false)
      setAutomaticConflict(null)
      setManagedEntryId(null)
      setOlderAssignmentWarning(false)
      commandRequest.current = null
      setSelected(queueId)
    },
    [
      commitEntries,
      endQueueToastSession,
      setPending,
      setOverrideReason,
      setArrivalMode,
      setCommandUncertain,
      setSeating,
      setCommandError,
      setCommandStale,
      setAutomaticConflict,
      setManagedEntryId,
      setOlderAssignmentWarning,
      setAutomationSnapshot,
      setLastSync,
      setSelected,
    ],
  )
  const announceAutomationEvent = useCallback((
    event: QueueAutomationEvent,
    queueId: string,
    sessionId: string,
  ) => {
    const session = queueToastSession.current
    if (
      !session ||
      !queueDrawerVisible.current ||
      selectedRef.current !== queueId ||
      session.queueId !== queueId ||
      session.id !== sessionId
    )
      return
    if (event.cause !== 'arrival_expiry') return
    const title = `El turno de ${event.entry.displayName || event.entry.code} ha expirado. Se ha avisado a ${event.successor.displayName || event.successor.code}.`
    addToast({
      id: `queue-event:${event.id}`,
      title,
      type: 'expiry',
      priority: 'low',
      data: { queueSessionId: sessionId },
    })
  }, [addToast])
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
        selectQueue(rows.find((row) => !deniedSelections.current.has(row.id))?.id ?? '')
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
    async function poll(forced = false, rebaseline = false) {
      clearTimeout(timer)
      controller?.abort()
      const request = new AbortController()
      controller = request
      const sequence = ++refreshSequence.current
      const catalogSequence = ++queueRefreshSequence.current
      const queueId = selectedRef.current
      const sessionAtStart = queueToastSession.current
      const automationSessionId =
        queueDrawerVisible.current && sessionAtStart?.queueId === queueId
          ? sessionAtStart.id
          : null
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
        if (!live || controller !== request || request.signal.aborted ||
          sequence !== refreshSequence.current || selectedRef.current !== queueId) return
        // Publish authoritative rows immediately. Optional cycle/event reads
        // must not keep a successful staff action looking uncommitted.
        clearTimeout(deadline)
        setWaitingCounts(waitingCountsFor(summaries, queueId, rows))
        commitEntries(rows)
        setLastSync(new Date().toLocaleTimeString())
        setError('')
        setLoading(false)
        const automationTimeout = new Promise<never>((_, reject) => {
          deadline = setTimeout(() => {
            reject(new Error('automation_read_timeout'))
            request.abort()
          }, 5_000)
        })
        // Cycle count is authoritative server state, distinct from the legacy
        // runtime kill switch on the queue summary. Failure here must not hide
        // an otherwise readable queue; fail closed for the footer instead.
        let automation: QueueAutomation | null = null
        const sessionIsVisible = () => {
          const current = queueToastSession.current
          return !!(
            automationSessionId &&
            queueDrawerVisible.current &&
            current?.queueId === queueId &&
            current.id === automationSessionId
          )
        }
        const cursorState =
          automationSessionId &&
          !rebaseline &&
          automationCursor.current?.queueId === queueId
            ? automationCursor.current.cursor
            : null
        const cursorGenerationAtRead = automationCursorGeneration.current
        let after = cursorState
        let committedCursor = cursorState
        const pendingSeenEventIds = new Set(
          cursorState == null || automationCursor.current?.queueId !== queueId
            ? []
            : seenAutomationEventIds.current,
        )
        const automationEvents: QueueAutomationEvent[] = []
        let automationFeedSucceeded = false
        try {
          // Cursor-less reads are baselines: keep cycle status current even while
          // the drawer is closed, but never replay that history as a toast.
          for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
            const query = after == null ? '' : `?after=${after}`
            const page = await Promise.race([api<QueueAutomation>(
              `/queues/${queueId}/automation${query}`,
              'GET',
              undefined,
              undefined,
              request.signal,
            ), automationTimeout])
            automation = page
            automationFeedSucceeded = true
            if (cursorState == null) {
              for (const event of page.events ?? [])
                pendingSeenEventIds.add(event.id)
              committedCursor = page.cursor ?? 0
              break
            }
            const freshEvents = (page.events ?? []).filter((event) => {
              if (pendingSeenEventIds.has(event.id)) return false
              pendingSeenEventIds.add(event.id)
              return true
            })
            automationEvents.push(...freshEvents)
            const nextCursor = page.cursor ?? after
            committedCursor = nextCursor
            if (!page.hasMore || nextCursor === after) break
            after = nextCursor
          }
        } catch {
          automation = null
          automationFeedSucceeded = false
        }
        if (
          live &&
          sequence === refreshSequence.current &&
          selectedRef.current === queueId
        ) {
          const validAutomation =
            automation &&
            typeof automation.configured === 'boolean' &&
            typeof automation.effective === 'boolean' &&
            Number.isFinite(automation.activeCycles) &&
            Number.isFinite(automation.serverNow)
          const currentSession = queueToastSession.current
          const anotherVisibleSession =
            queueDrawerVisible.current &&
            currentSession?.queueId === queueId &&
            currentSession.id !== automationSessionId
          const canCommitAutomation =
            !anotherVisibleSession &&
            cursorGenerationAtRead === automationCursorGeneration.current
          if (canCommitAutomation) {
            const currentSessionVisible = sessionIsVisible()
            setAutomationSnapshot(
              validAutomation && automation
                ? { ...automation, observedAt: Date.now() }
                : null,
            )
            // Cursor and dedupe state are committed only with the matching live
            // queue snapshot; stale/aborted requests must not consume events.
            if (
              automationFeedSucceeded &&
              validAutomation &&
              automation
            ) {
              automationCursor.current = {
                queueId,
                cursor: committedCursor ?? automation.cursor ?? 0,
              }
              seenAutomationEventIds.current = pendingSeenEventIds
              automationCursorGeneration.current++
            } else if (!currentSessionVisible) {
              automationCursor.current = null
              seenAutomationEventIds.current.clear()
              automationCursorGeneration.current++
            } else {
              automationCursor.current = null
              seenAutomationEventIds.current.clear()
              automationCursorGeneration.current++
            }
          }
          // Forced refreshes after a staff command still consume and announce
          // automatic events from other cycles. Only a cursor-less baseline
          // (initial open/reconnect/focus) suppresses historical feedback.
          if (
            sessionIsVisible() &&
            cursorState != null &&
            automationFeedSucceeded &&
            automationSessionId
          )
            automationEvents.forEach((event) =>
              announceAutomationEvent(event, queueId, automationSessionId),
            )
        }
      } catch (error) {
        if (
          live &&
          controller === request &&
          sequence === refreshSequence.current
        ) {
          automationCursor.current = null
          seenAutomationEventIds.current.clear()
          if (selectedRef.current === queueId) setAutomationSnapshot(null)
          if (
            error instanceof ApiError &&
            [401, 403, 404].includes(error.status)
          ) {
            if (readingEntries && queueId) deniedSelections.current.add(queueId)
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
          timer = setTimeout(() => {
            deniedSelections.current.clear()
            void poll().catch(() => undefined)
          }, 5000)
        }
      }
    }
    immediateRefresh.current = () => {
      deniedSelections.current.clear()
      return poll(true)
    }
    const onFocus = () => {
      deniedSelections.current.clear()
      if (document.visibilityState !== 'hidden')
        void poll(true, true).catch(() => undefined)
    }
    const onOnline = () => {
      deniedSelections.current.clear()
      void poll(true, true).catch(() => undefined)
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onFocus)
    void poll().catch(() => undefined)
    return () => {
      live = false
      controller?.abort()
      clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onFocus)
      immediateRefresh.current = null
    }
  }, [
    selected,
    venue.id,
    commitQueues,
    commitEntries,
    announceAutomationEvent,
  ])
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
      await refresh().catch(() => undefined)
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
    // Commands launched from the management sheet should return to the card
    // button that opened it, not to a sheet button that is about to unmount.
    // Swipe/reveal actions use the same persistent card trigger.
    const launchedFromManagedSheet = managedEntryId === entry.id
    if (!launchedFromManagedSheet) {
      const card = Array.from(
        document.querySelectorAll<HTMLElement>('[data-entry-id]'),
      ).find((row) => row.dataset.entryId === entry.id)
      commandTrigger.current =
        card?.querySelector<HTMLElement>('[data-manage-entry]') ?? trigger
    }
    if (action !== 'complete') commandRequest.current = null
    setCommandError('')
    setCommandStale(false)
    setAutomaticConflict(null)
    setOverrideReason('')
    setArrivalMode('notify')
    setCommandUncertain(false)
    setSeating(
      action === 'call' && queue.config.type === 'restaurant'
        ? defaultAssignmentSeating(queue.config, entry)
        : null,
    )
    const selectedSeating: AssignmentSeating | null =
      action === 'call' && queue.config.type === 'restaurant'
        ? defaultAssignmentSeating(queue.config, entry)
        : null
    const olderCompatible =
      action === 'call' && queue.config.type === 'restaurant'
        ? olderCompatibleRestaurantEntries(
            queue,
            entries,
            entry,
            selectedSeating,
          )
        : []
    setOlderAssignmentWarning(olderCompatible.length > 0)
    const immediateCall = action === 'call' && queue.config.type !== 'restaurant'
    if (!immediateCall) setManagedEntryId(null)
    const snapshot = {
      queueId: queue.id,
      entryId: entry.id,
      action,
      key: crypto.randomUUID(),
    }
    if (immediateCall) {
      // Quick services have no assignment choices. Send the selected entry's
      // call (not assign_next), retaining the confirmed-command safety path.
      setPending(null)
      void command(snapshot)
    } else setPending(snapshot)
  }
  function handleEntryAction(entry: StaffEntry, action: EntryCommand['action']) {
    if (action !== 'complete') {
      selectCommand(entry, action)
      return
    }
    if (!queue || commandLock.current || selectedRef.current !== queue.id) return
    const currentEntry = entriesRef.current.find((row) => row.id === entry.id)
    if (
      !currentEntry ||
      !allowsEntryAction(currentEntry, queue.id, 'complete')
    ) {
      setError('El turno ya no permite esta acción. Actualiza la lista.')
      return
    }
    if (managedEntryId !== entry.id) {
      const card = Array.from(
        document.querySelectorAll<HTMLElement>('[data-entry-id]'),
      ).find((row) => row.dataset.entryId === entry.id)
      commandTrigger.current =
        card?.querySelector<HTMLElement>('[data-manage-entry]') ??
        (document.activeElement as HTMLElement)
    }
    setManagedEntryId(null)
    void directCommand({
      action: 'complete',
      entryId: currentEntry.id,
      version: currentEntry.version,
    })
  }
  function restoreCommandFocus() {
    const target = commandTrigger.current
    // The queue drawer is a still-open parent dialog. Let the child sheet
    // finish restoring its focus first, then put focus back on the originating
    // card rather than the parent's close button.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (target?.isConnected) target.focus()
      }),
    )
  }
  function announceCommandResult(result: QueueCommandResult) {
    const session = queueToastSession.current
    if (
      !session ||
      !queueDrawerVisible.current ||
      selectedRef.current !== session.queueId
    )
      return
    const outcome = result.outcome
    // Replayed operations retain their operationId; keep feedback idempotent.
    if (!outcome) return
    const customer = outcome.entry.displayName || outcome.entry.code
    const successor = outcome.successor?.displayName || outcome.successor?.code
    let title: string | null = null
    if (outcome.action === 'call')
      title =
        outcome.mode === 'called' && outcome.automatic && arrivalMode === 'notify'
          ? 'Turno asignado. Seguimiento automático activo.'
          : 'Turno asignado.'
    else if (outcome.action === 'pass')
      title = outcome.mode === 'called_handoff' && successor
        ? `Turno pasado. Hemos avisado a ${successor}.`
        : 'Turno pasado. La lista se ha actualizado.'
    else if (outcome.action === 'prioritize')
      title = `${customer} tendrá prioridad en la siguiente asignación disponible.`
    else if (outcome.action === 'cancel')
      title = outcome.cycleEnded
        ? 'Turno cancelado. El ciclo ha finalizado.'
        : 'Turno cancelado.'
    else if (outcome.action === 'complete')
      title = outcome.cycleEnded
        ? 'Llegada confirmada. El ciclo ha finalizado.'
        : 'Llegada confirmada.'
    if (title && !announcedOperationIds.current.has(outcome.operationId)) {
      announcedOperationIds.current.add(outcome.operationId)
      addToast({
        id: `queue-command:${outcome.operationId}`,
        title,
        type:
          outcome.action === 'call'
            ? 'call'
            : outcome.action === 'pass'
            ? 'pass'
            : outcome.action === 'prioritize'
            ? 'priority'
            : outcome.action === 'cancel'
            ? 'cancel'
            : 'arrived',
        priority: 'low',
        data: { queueSessionId: session.id },
      })
    }
  }
  async function directCommand(input: QueueCommand) {
    if (!queue || commandLock.current) return
    const queueId = queue.id
    commandLock.current = true
    setBusy(true)
    setError('')
    let showingAutomaticConflict = false
    const body = JSON.stringify({ queueId: queue.id, input })
    if (commandRequest.current?.body !== body)
      commandRequest.current = { body, key: crypto.randomUUID() }
    try {
      const result = await api<QueueCommandResult>(
        `/queues/${queue.id}/commands`,
        'POST',
        input,
        commandRequest.current.key,
      )
      if (selectedRef.current === queueId) announceCommandResult(result)
      commandRequest.current = null
      await refresh()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        commandRequest.current = null
      await refresh().catch(() => undefined)
      // Direct arrival actions (including swipe) use the same authoritative
      // automatic-conflict sheet as confirmed commands, never undo a successor.
      if (
        selectedRef.current === queueId &&
        e instanceof ApiError && e.status === 409 &&
        (e.code === 'turn_automatically_processed' || e.code === 'turn_automatically_assigned') &&
        input.action === 'complete'
      ) {
        showingAutomaticConflict = true
        setPending({ queueId, entryId: input.entryId, action: input.action, key: crypto.randomUUID() })
        setAutomaticConflict(e.code === 'turn_automatically_processed' ? 'processed' : 'assigned')
        setCommandError('')
        setCommandStale(true)
      } else {
        // refresh clears read errors: retain other command failures afterwards.
        setError(errorMessage(e))
      }
    } finally {
      commandLock.current = false
      setBusy(false)
      if (!showingAutomaticConflict) requestAnimationFrame(() =>
        (commandTrigger.current?.isConnected
          ? commandTrigger.current
          : menuTrigger.current
        )?.focus(),
      )
    }
  }
  async function command(initialSnapshot?: NonNullable<typeof pending>) {
    // React state resets from selectCommand are not visible in this closure.
    // An immediate call is a new intent, never a retry of the previous sheet.
    const retryRequest = !initialSnapshot && commandUncertain ? commandRequest.current : null
    const snapshot = initialSnapshot ?? pending
    if (!snapshot || commandLock.current || (!initialSnapshot && commandStale && !retryRequest))
      return
    const showRecovery = () => {
      if (initialSnapshot && selectedRef.current === snapshot.queueId) {
        setManagedEntryId(null)
        setPending(snapshot)
      }
    }
    const currentEntry = entriesRef.current.find(
      (entry) => entry.id === snapshot.entryId,
    )
    if (
      !retryRequest &&
      (selectedRef.current !== snapshot.queueId ||
        !currentEntry ||
        !allowsEntryAction(currentEntry, snapshot.queueId, snapshot.action))
    ) {
      showRecovery()
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
      showRecovery()
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
    const reason = initialSnapshot ? '' : overrideReason.trim()
    const callArrivalMode = initialSnapshot ? 'notify' : arrivalMode
    const input = {
      entryId: currentEntry?.id ?? snapshot.entryId,
      version: currentEntry?.version ?? 0,
      action: snapshot.action,
      ...(snapshot.action === 'call'
        ? {
            arrivalMode: callArrivalMode,
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
            arrivalMode: callArrivalMode,
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
      const result = await api<QueueCommandResult>(
        `/queues/${snapshot.queueId}/commands`,
        'POST',
        requestInput,
        request.key,
      )
      if (selectedRef.current === snapshot.queueId)
        announceCommandResult(result)
      if (initialSnapshot) setManagedEntryId(null)
      setPending(null)
      setCommandUncertain(false)
      setOlderAssignmentWarning(false)
      setAutomaticConflict(null)
      commandRequest.current = null
      setOverrideReason('')
      await refresh().catch((error) =>
        setError(`Acción guardada. ${errorMessage(error)}`),
      )
      restoreCommandFocus()
    } catch (e) {
      showRecovery()
      const uncertain = !(e instanceof ApiError) || e.status >= 500
      setCommandUncertain(uncertain)
      if (!uncertain) {
        commandRequest.current = null
        // A definitive rejection ends this attempt. A user-confirmed retry
        // after refresh may carry a new version/token and needs a new key.
        setPending((current) => current?.key === snapshot.key
          ? { ...current, key: crypto.randomUUID() }
          : current)
      }
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
        const automaticResult =
          e.code === 'turn_automatically_processed' ||
          e.code === 'turn_automatically_assigned'
        if (e.code === 'turn_automatically_processed') {
          setAutomaticConflict('processed')
          setCommandError('')
        } else if (e.code === 'turn_automatically_assigned') {
          setAutomaticConflict('assigned')
          setCommandError('')
        }
        try {
          await refresh()
          if (selectedRef.current !== snapshot.queueId) return
          const entry = entriesRef.current.find(
            (row) => row.id === snapshot.entryId,
          )
          if (!automaticResult &&
            entry &&
            allowsEntryAction(entry, snapshot.queueId, snapshot.action)
          ) {
            setCommandStale(false)
            setCommandError(
              `${errorMessage(
                e,
              )} Datos actualizados; revisa el turno y confirma de nuevo.`,
            )
          } else if (!automaticResult)
            setCommandError(
              'El turno ya no permite esta acción. Cierra esta ventana y revisa la lista.',
            )
        } catch {
          if (selectedRef.current === snapshot.queueId && !automaticResult)
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
  // The quick-assignment command intentionally excludes retained manual-only
  // entries; those can still be called explicitly from their customer card.
  // The endpoint resolves this across the complete queue, not just the loaded
  // staff page. Do not re-derive it from filtered/paginated entries.
  const nextEntry = automationSnapshot?.nextEntry ?? null
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
      {error && drawer !== 'queue' && (
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
                      <SettingsIcon aria-hidden="true" />
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
                clockOffsetMs={
                  automationSnapshot
                    ? automationSnapshot.serverNow - automationSnapshot.observedAt
                    : 0
                }
                nextEntryId={
                  automationSnapshot
                    ? automationSnapshot.nextEntry?.id ?? null
                    : null
                }
                error={error}
                onRefresh={() =>
                  void refresh().catch((e) => setError(errorMessage(e)))
                }
                onAdd={(trigger) => setAdding({ queue, trigger })}
                onAction={handleEntryAction}
                onManage={(entry) => {
                  if (busy || commandLock.current) return
                  const card = Array.from(
                    document.querySelectorAll<HTMLElement>('[data-entry-id]'),
                  ).find((row) => row.dataset.entryId === entry.id)
                  commandTrigger.current =
                    card?.querySelector<HTMLElement>('[data-manage-entry]') ??
                    (document.activeElement as HTMLElement)
                  setManagedEntryId(entry.id)
                  setCommandError('')
                  setCommandStale(false)
                  setAutomaticConflict(null)
                }}
              />
            )}
          </div>
          {drawer === 'queue' && (
            <QueueToastViewport sessionId={queueToastSessionId} />
          )}
          {drawer === 'queue' &&
            tab === 'active' &&
            queue &&
            ((automationSnapshot?.configured ?? queue.config.automaticAssignmentEnabled === true) ||
              (queue.config.type !== 'restaurant' && permissions.includes('queue.operate'))) && (
              <DrawerFooter data-queue-automation-footer="" className="border-t bg-background p-4">
                <QueueAutomationFooter
                  type={queue.config.type}
                  configured={
                    automationSnapshot?.configured ??
                    queue.config.automaticAssignmentEnabled === true
                  }
                  automation={automationSnapshot}
                  canOperate={permissions.includes('queue.operate')}
                  busy={busy}
                  canAssignNext={!!nextEntry}
                  onAssignNext={() => {
                    commandTrigger.current = document.activeElement as HTMLElement
                    if (nextEntry)
                      void directCommand({
                        action: 'assign_next',
                        expectedEntryId: nextEntry.id,
                        expectedVersion: nextEntry.version,
                      })
                  }}
                />
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
          <QueueTurnSheets
            queue={queue}
            canOperate={permissions.includes('queue.operate')}
            automationSnapshot={automationSnapshot}
            managedOpen={!!managedEntry}
            managedEntry={managedEntry}
            managedActions={managedActions}
            managedIsNext={managedIsNext}
            pending={pending}
            pendingQueue={pendingQueue}
            pendingEntry={pendingEntry}
            busy={busy}
            commandUncertain={commandUncertain}
            commandStale={commandStale}
            pendingActionUnavailable={pendingActionUnavailable}
            validSeating={validSeating}
            olderAssignmentWarning={olderAssignmentWarning}
            olderCompatibleCandidates={olderCompatibleCandidates}
            automaticConflict={automaticConflict}
            commandError={commandError}
            restaurantAssignment={!!restaurantAssignment}
            seatingOptions={seatingOptions}
            seating={seating}
            returnFocus={() =>
              commandTrigger.current?.isConnected
                ? commandTrigger.current
                : menuTrigger.current
            }
            onManagedOpenChange={(open) => {
              if (!open && !busy) {
                setManagedEntryId(null)
                restoreCommandFocus()
              }
            }}
            onPendingOpenChange={(open) => {
              if (!open && !busy) {
                setPending(null)
                setOlderAssignmentWarning(false)
                setAutomaticConflict(null)
                restoreCommandFocus()
              }
            }}
            onAction={handleEntryAction}
            onConfirm={() => void command()}
            onDismissAutomaticConflict={() => {
              setPending(null)
              setAutomaticConflict(null)
              setOlderAssignmentWarning(false)
            }}
            onSelectCandidate={(candidate) => {
              if (!pending || !pendingQueue) return
              commandRequest.current = null
              const candidateCard = Array.from(
                document.querySelectorAll<HTMLElement>('[data-entry-id]'),
              ).find((row) => row.dataset.entryId === candidate.id)
              const candidateTrigger = candidateCard?.querySelector<HTMLElement>(
                '[data-manage-entry]',
              )
              if (candidateTrigger) commandTrigger.current = candidateTrigger
              const candidateSeating = defaultAssignmentSeating(
                pendingQueue.config,
                candidate,
              )
              setOlderAssignmentWarning(
                pendingQueue.config.type === 'restaurant' &&
                  olderCompatibleRestaurantEntries(
                    pendingQueue,
                    entries,
                    candidate,
                    candidateSeating,
                  ).length > 0,
              )
              setPending({
                ...pending,
                entryId: candidate.id,
                key: crypto.randomUUID(),
              })
              setSeating(candidateSeating)
              setCommandError('')
              setCommandStale(false)
              setCommandUncertain(false)
              setArrivalMode('notify')
            }}
            onSeatingChange={setSeating}
          />
        </DrawerContent>
      </Drawer>
      {!lifecycle?.insideDrawer && lifecycleSheet}
    </div>
  )
}

export function Dashboard(props: DashboardProps) {
  return (
    <Toast.Provider timeout={5000} limit={3}>
      <DashboardContent {...props} />
    </Toast.Provider>
  )
}
