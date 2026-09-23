import { useEffect, useRef, useState } from 'react'
import type { QueueSummary, ServiceInput } from '@noqueue/contracts/staff'
import { EllipsisVertical, Settings, Users } from 'lucide-react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  CreateEstablishmentDrawer,
  type ClientInput,
} from './CreateEstablishmentDrawer'
import { Members } from './Members'
import { ServiceConfigDrawer } from './ServiceConfigDrawer'
import { api, errorMessage } from './api'

type Customer = {
  id: string
  name: string
  slug: string
  status: string
  venueId: string
  venueName: string
}

export function Commercial() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [services, setServices] = useState<Record<string, QueueSummary[]>>({})
  const [selected, setSelected] = useState<Customer | null>(null)
  const [editing, setEditing] = useState<QueueSummary | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [configError, setConfigError] = useState('')
  const [configSaving, setConfigSaving] = useState(false)
  const pending = useRef(false)
  const requestKey = useRef(crypto.randomUUID())
  const fingerprint = useRef('')
  const accessTriggerRef = useRef<HTMLButtonElement | null>(null)
  const triggers = useRef(new Map<string, HTMLButtonElement>())

  async function loadServices(rows: Customer[]) {
    // The action menu lists one item per service, so the queues must be known
    // before the menu opens.
    const lists = await Promise.all(
      rows.map(async (customer) => {
        const queues = await api<QueueSummary[]>(
          `/venues/${customer.venueId}/queues`,
        )
        return [customer.venueId, queues] as const
      }),
    )
    return Object.fromEntries(lists)
  }

  useEffect(() => {
    let active = true
    api<Customer[]>('/commercial/organizations')
      .then(async (data) => {
        const queues = await loadServices(data)
        if (!active) return
        setCustomers(data)
        setServices(queues)
      })
      .catch((e) => {
        if (active) setError(errorMessage(e))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const data = await api<Customer[]>('/commercial/organizations')
      setCustomers(data)
      setServices(await loadServices(data))
    } catch (e) {
      setError(`No se pudo actualizar el listado. ${errorMessage(e)}`)
    } finally {
      setLoading(false)
    }
  }

  function rememberTrigger(customerId: string) {
    accessTriggerRef.current = triggers.current.get(customerId) ?? null
  }

  function openService(customerId: string, queue: QueueSummary) {
    if (configSaving) return
    rememberTrigger(customerId)
    setConfigError('')
    setEditing(queue)
  }

  async function saveService(config: ServiceInput) {
    if (!editing || pending.current) return
    pending.current = true
    setConfigSaving(true)
    setConfigError('')
    const venueId = editing.venueId
    try {
      await api(`/queues/${editing.id}`, 'PATCH', {
        ...config,
        version: editing.version,
        open: !!editing.open,
      })
      setEditing(null)
      const queues = await api<QueueSummary[]>(`/venues/${venueId}/queues`)
      setServices((current) => ({ ...current, [venueId]: queues }))
    } catch (e) {
      setConfigError(errorMessage(e))
    } finally {
      pending.current = false
      setConfigSaving(false)
    }
  }

  function changeOpen(next: boolean) {
    if (pending.current) return
    setOpen(next)
    if (next) setMessage('')
    setSaveError('')
    fingerprint.current = ''
    requestKey.current = crypto.randomUUID()
  }

  async function complete(client: ClientInput, service: ServiceInput) {
    if (pending.current) return
    pending.current = true
    setSaving(true)
    setSaveError('')
    const input = { ...client, services: [service] }
    const next = JSON.stringify(input)
    if (fingerprint.current !== next) {
      requestKey.current = crypto.randomUUID()
      fingerprint.current = next
    }
    try {
      await api('/commercial/organizations', 'POST', input, requestKey.current)
      setOpen(false)
      fingerprint.current = ''
      setMessage(
        'Establecimiento creado. Entrega las credenciales al administrador por un canal seguro. El servicio se ha creado cerrado.',
      )
      await refresh()
    } catch (e) {
      setSaveError(errorMessage(e))
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {message && <p role="status">{message}</p>}
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">Establecimientos</h1>
          </CardTitle>
          <CardDescription>
            Gestiona tus clientes y sus accesos a NoQueue.
          </CardDescription>
          <CardAction>
            <CreateEstablishmentDrawer
              open={open}
              saving={saving}
              error={saveError}
              onOpenChange={changeOpen}
              onComplete={complete}
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 space-y-2">
              <p role="alert" className="text-destructive">
                {error}
              </p>
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => void refresh()}
              >
                Actualizar listado
              </Button>
            </div>
          )}
          <Table aria-label="Listado de establecimientos" aria-busy={loading}>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Establecimiento</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!customers.length && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {loading
                      ? 'Cargando establecimientos…'
                      : error
                        ? 'Listado no disponible.'
                        : 'Todavía no hay establecimientos. Crea el primero para empezar.'}
                  </TableCell>
                </TableRow>
              )}
              {customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>{customer.name}</TableCell>
                  <TableCell>{customer.venueName}</TableCell>
                  <TableCell>
                    {customer.status === 'active' ? 'Activo' : 'Suspendido'}
                  </TableCell>
                  <TableCell>
                    <EstablishmentActions
                      customer={customer}
                      queues={services[customer.venueId] ?? []}
                      triggerRef={(node) => {
                        if (node) triggers.current.set(customer.id, node)
                        else triggers.current.delete(customer.id)
                      }}
                      onAccess={() => {
                        rememberTrigger(customer.id)
                        setSelected(customer)
                      }}
                      onConfigure={(queue) => openService(customer.id, queue)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Drawer
        open={selected !== null}
        onOpenChange={(next) => {
          if (!next) setSelected(null)
        }}
        swipeDirection="right"
      >
        <DrawerContent
          finalFocus={accessTriggerRef}
          className="w-full sm:w-md"
        >
          <DrawerHeader className="border-b p-6">
            <DrawerTitle className="text-xl">Gestionar accesos</DrawerTitle>
            <DrawerDescription>{selected?.venueName}</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
            {selected && (
              <Members
                key={selected.venueId}
                venueId={selected.venueId}
                name={selected.venueName}
                compact
              />
            )}
          </div>
          <DrawerFooter className="border-t bg-background p-6 sm:flex-row sm:justify-end">
            <DrawerClose render={<Button variant="outline" />}>
              Cerrar
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      <ServiceConfigDrawer
        open={editing !== null}
        mode="edit"
        resetKey={editing?.id ?? 'edit'}
        {...(editing ? { initial: editing.config } : {})}
        saving={configSaving}
        error={configError}
        finalFocus={accessTriggerRef}
        onClose={() => {
          if (!configSaving) setEditing(null)
        }}
        onSave={saveService}
      />
    </div>
  )
}

function EstablishmentActions({
  customer,
  queues,
  triggerRef,
  onAccess,
  onConfigure,
}: {
  customer: Customer
  queues: QueueSummary[]
  triggerRef: (node: HTMLButtonElement | null) => void
  onAccess: () => void
  onConfigure: (queue: QueueSummary) => void
}) {
  const label = `Acciones de ${customer.venueName}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            aria-label={label}
            ref={triggerRef}
          />
        }
      >
        <EllipsisVertical />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuItem onClick={onAccess}>
          <Users />
          Gestionar accesos
        </DropdownMenuItem>
        {queues.length === 1 && queues[0] && (
          <DropdownMenuItem onClick={() => onConfigure(queues[0]!)}>
            <Settings />
            Configuración
          </DropdownMenuItem>
        )}
        {queues.length > 1 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Configuración</DropdownMenuLabel>
            {queues.map((queue) => (
              <DropdownMenuItem
                key={queue.id}
                onClick={() => onConfigure(queue)}
              >
                <Settings />
                {queue.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
